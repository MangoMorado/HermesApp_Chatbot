import { describe, expect, it } from "vitest";
import { createGetCapabilityStatement } from "@/modules/fhir/application/get-capability-statement";
import { createReadResource } from "@/modules/fhir/application/read-resource";
import { createResourceHandlers } from "@/modules/fhir/application/resource-handlers";
import { createSearchResources } from "@/modules/fhir/application/search-resources";
import { searchBundle } from "@/modules/fhir/domain/bundle";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import type {
  AppointmentQuery,
  FhirSource,
  FhirSources,
  MasterQuery,
  PatientQuery,
  ScheduleQuery,
  SlotQuery,
  SlotRecord,
} from "@/modules/fhir/domain/ports/sources";
import { CONDITIONAL_ONLY, RESOURCE_TYPES } from "@/modules/fhir/domain/profiles";
import { DECLARED_RESOURCES } from "@/modules/fhir/domain/registry";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const TENANT = toTenantId("tenant-a");
const BASE = "https://api.test/fhir";

const slot: SlotRecord = {
  id: "sl-1",
  identifier: { system: "urn:hermes:slot", value: "SL-1" },
  scheduleId: "sch-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "free",
};

type Seen = {
  patient: PatientQuery[];
  master: MasterQuery[];
  schedule: ScheduleQuery[];
  slot: SlotQuery[];
  appointment: AppointmentQuery[];
};

function source<R extends { id: string }, Q>(
  rows: R[],
  seen: Q[],
  total = rows.length,
): FhirSource<R, Q> {
  return {
    read: async (_tenantId, id) => rows.find((row) => row.id === id) ?? null,
    search: async (_tenantId, query) => {
      seen.push(query);
      return { data: rows, total };
    },
  };
}

function world(slotTotal = 1) {
  const seen: Seen = { patient: [], master: [], schedule: [], slot: [], appointment: [] };
  const sources: FhirSources = {
    Patient: source([], seen.patient),
    Practitioner: source([], seen.master),
    HealthcareService: source([], seen.master),
    Schedule: source([], seen.schedule),
    Slot: source([slot], seen.slot, slotTotal),
    Appointment: source([], seen.appointment),
  };
  const handlers = createResourceHandlers(sources);
  return {
    seen,
    read: createReadResource(handlers),
    search: createSearchResources(handlers, "America/Bogota"),
  };
}

function entries(query: string): [string, string][] {
  return [...new URLSearchParams(query).entries()];
}

async function failure(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FhirError) {
      return { status: error.status, code: error.code };
    }
    throw error;
  }
  throw new Error("deberia haber fallado");
}

describe("fhir-conformance: read", () => {
  it("devuelve el recurso mapeado", async () => {
    const resource = await world().read(TENANT, "Slot", "sl-1");
    expect(resource).toMatchObject({ resourceType: "Slot", id: "sl-1", status: "free" });
  });

  it("id inexistente y tipo desconocido son not-found", async () => {
    const { read } = world();
    expect(await failure(() => read(TENANT, "Slot", "otro"))).toEqual({
      status: 404,
      code: "not-found",
    });
    expect(await failure(() => read(TENANT, "Task", "sl-1"))).toEqual({
      status: 404,
      code: "not-found",
    });
  });
});

describe("fhir-conformance: search arma la consulta del puerto", () => {
  it("Slot: referencia, estado, cotas y ventana", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Slot",
      entries: entries(
        "schedule=Schedule/sch-1&status=busy-tentative&start=ge2026-06-15&_count=10",
      ),
      baseUrl: BASE,
    });
    expect(seen.slot).toEqual([
      {
        identifier: null,
        scheduleId: "sch-1",
        status: "busy_tentative",
        start: [{ op: "ge", at: new Date("2026-06-15T05:00:00.000Z") }],
        offset: 0,
        limit: 10,
      },
    ]);
  });

  it("Patient: un system de documento busca por documento", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Patient",
      entries: entries(`identifier=${encodeURIComponent("urn:ingenius:document:CC|1000")}`),
      baseUrl: BASE,
    });
    await search({
      tenantId: TENANT,
      type: "Patient",
      entries: entries(
        `identifier=${encodeURIComponent("urn:hermes:patient|MR-1")}&_tag=${encodeURIComponent("urn:ingenius:patient-tag|pre-registered")}`,
      ),
      baseUrl: BASE,
    });
    expect(seen.patient).toEqual([
      {
        identifier: null,
        document: { type: "CC", number: "1000" },
        preRegistered: null,
        offset: 0,
        limit: 50,
      },
      {
        identifier: { system: "urn:hermes:patient", value: "MR-1" },
        document: null,
        preRegistered: true,
        offset: 0,
        limit: 50,
      },
    ]);
  });

  it("Schedule: actor acepta profesional o servicio", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Schedule",
      entries: entries("actor=Practitioner/p-1"),
      baseUrl: BASE,
    });
    await search({
      tenantId: TENANT,
      type: "Schedule",
      entries: entries("actor=HealthcareService/s-1&active=true"),
      baseUrl: BASE,
    });
    expect(
      seen.schedule.map((query) => [query.practitionerId, query.healthcareServiceId, query.active]),
    ).toEqual([
      ["p-1", null, null],
      [null, "s-1", true],
    ]);
  });

  it("Appointment: paciente, cupo, estado y fecha", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Appointment",
      entries: entries("patient=Patient/mr-1&slot=Slot/sl-1&status=booked&date=lt2026-06-16"),
      baseUrl: BASE,
    });
    expect(seen.appointment[0]).toMatchObject({
      medicalRecordId: "mr-1",
      slotId: "sl-1",
      status: "booked",
      start: [{ op: "lt", at: new Date("2026-06-16T05:00:00.000Z") }],
    });
  });

  it("rechaza parametros no declarados, tags desconocidos y tipos desconocidos", async () => {
    const { search } = world();
    const run = (type: string, query: string) => () =>
      search({ tenantId: TENANT, type, entries: entries(query), baseUrl: BASE });
    expect(await failure(run("Slot", "patient=Patient/x"))).toEqual({
      status: 400,
      code: "not-supported",
    });
    expect(await failure(run("Patient", `_tag=${encodeURIComponent("urn:x|otro")}`))).toEqual({
      status: 400,
      code: "invalid",
    });
    expect(await failure(run("Slot", "status=ocupado"))).toEqual({ status: 400, code: "invalid" });
    expect(await failure(run("Task", ""))).toEqual({ status: 404, code: "not-found" });
  });
});

describe("fhir-conformance: Bundle", () => {
  it("es un searchset con total, fullUrl y enlace self", async () => {
    const bundle = await world().search({
      tenantId: TENANT,
      type: "Slot",
      entries: [],
      baseUrl: BASE,
    });
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "searchset", total: 1 });
    expect(bundle.entry).toEqual([
      {
        fullUrl: `${BASE}/Slot/sl-1`,
        resource: expect.objectContaining({ id: "sl-1" }),
        search: { mode: "match" },
      },
    ]);
    expect(bundle.link).toEqual([{ relation: "self", url: `${BASE}/Slot?_count=50&_offset=0` }]);
  });

  it("una busqueda vacia no lleva la clave entry", () => {
    const bundle = searchBundle({
      baseUrl: BASE,
      type: "Slot",
      filters: [],
      resources: [],
      total: 0,
      offset: 0,
      limit: 50,
    });
    expect(bundle.total).toBe(0);
    expect(bundle.link).toEqual([{ relation: "self", url: `${BASE}/Slot?_count=50&_offset=0` }]);
    expect(bundle).not.toHaveProperty("entry");
    expect("entry" in bundle).toBe(false);
  });

  it("next y previous conservan los filtros y mueven el desplazamiento", () => {
    const bundle = searchBundle({
      baseUrl: BASE,
      type: "Slot",
      filters: [
        ["status", "free"],
        ["_count", "2"],
        ["_offset", "2"],
        ["start", "ge2026-06-15"],
      ],
      resources: [],
      total: 5,
      offset: 2,
      limit: 2,
    });
    expect(bundle.link).toEqual([
      { relation: "self", url: `${BASE}/Slot?status=free&start=ge2026-06-15&_count=2&_offset=2` },
      { relation: "next", url: `${BASE}/Slot?status=free&start=ge2026-06-15&_count=2&_offset=4` },
      {
        relation: "previous",
        url: `${BASE}/Slot?status=free&start=ge2026-06-15&_count=2&_offset=0`,
      },
    ]);
  });

  it("en la ultima pagina no hay next y previous no baja de cero", () => {
    const bundle = searchBundle({
      baseUrl: BASE,
      type: "Slot",
      filters: [],
      resources: [],
      total: 3,
      offset: 1,
      limit: 2,
    });
    expect(bundle.link.map((link) => link.relation)).toEqual(["self", "previous"]);
    expect(bundle.link[1]?.url).toBe(`${BASE}/Slot?_count=2&_offset=0`);
  });
});

describe("fhir-conformance: CapabilityStatement", () => {
  const statement = createGetCapabilityStatement()();

  it("declara R4, JSON y un servidor", () => {
    expect(statement).toMatchObject({
      resourceType: "CapabilityStatement",
      status: "active",
      kind: "instance",
      fhirVersion: "4.0.1",
      format: ["json"],
    });
    expect(statement.implementation.description).toEqual(expect.any(String));
    expect(statement.rest).toHaveLength(1);
    expect(statement.rest[0]?.mode).toBe("server");
  });

  it("declara exactamente los recursos y parametros del registro", () => {
    const declared = statement.rest[0]?.resource ?? [];
    expect(declared.map((resource) => resource.type)).toEqual([...RESOURCE_TYPES]);
    for (const resource of declared) {
      const definition = DECLARED_RESOURCES.find((entry) => entry.type === resource.type);
      expect(resource.searchParam).toEqual(definition?.searchParams);
      if (resource.type === "Appointment") {
        expect(resource.interaction).toEqual([{ code: "read" }, { code: "search-type" }]);
        expect(resource).not.toHaveProperty("conditionalUpdate");
        expect(resource).not.toHaveProperty("updateCreate");
      } else {
        expect(resource.interaction).toEqual([
          { code: "read" },
          { code: "search-type" },
          { code: "update", documentation: CONDITIONAL_ONLY },
        ]);
        expect(resource.conditionalUpdate).toBe(true);
        expect(resource.updateCreate).toBe(false);
      }
    }
  });

  it("documenta que Idempotency-Key es obligatoria", () => {
    expect(statement.rest[0]?.documentation).toContain("Idempotency-Key");
  });

  it("los parametros por recurso son los de la spec", () => {
    const names = Object.fromEntries(
      DECLARED_RESOURCES.map((entry) => [
        entry.type,
        entry.searchParams.map((param) => param.name),
      ]),
    );
    expect(names).toEqual({
      Patient: ["identifier", "_tag"],
      Practitioner: ["identifier", "active"],
      HealthcareService: ["identifier", "active"],
      Schedule: ["identifier", "actor", "active"],
      Slot: ["identifier", "schedule", "status", "start"],
      Appointment: ["identifier", "patient", "slot", "status", "date"],
    });
  });
});
