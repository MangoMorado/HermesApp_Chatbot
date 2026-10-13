import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirGet, serviceToken } from "../helpers/fhir";
import { seedTenantDomain, type TenantDomainSeed, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const FHIR_MIME = "application/fhir+json";
const PRE_TAG = encodeURIComponent("urn:ingenius:patient-tag|pre-registered");

type Entry = { resource: { id: string; status?: string } };

function idsOf(body: { entry?: Entry[] }): string[] {
  return (body.entry ?? []).map((entry) => entry.resource.id);
}

describe("fhir-conformance: lectura por HTTP", () => {
  let seed: TenantDomainSeed;
  let token: string;
  let lateSlotId: string;
  let preRegisteredId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await seedTenantDomain(prisma, "a");
    token = await serviceToken(seed.tenantId);
    // 22:00 del 15 de junio en Bogota; ya es 16 de junio en UTC.
    lateSlotId = `${seed.tenantId}-slot-late`;
    await prisma.slot.create({
      data: {
        id: lateSlotId,
        tenantId: seed.tenantId,
        identifierSystem: "urn:hermes:slot",
        identifierValue: "SL-LATE-a",
        scheduleId: seed.scheduleId,
        startAt: new Date("2026-06-16T03:00:00.000Z"),
        endAt: new Date("2026-06-16T03:30:00.000Z"),
        status: "free",
      },
    });
    preRegisteredId = `${seed.tenantId}-mr-pre`;
    await prisma.medicalRecord.create({
      data: {
        id: preRegisteredId,
        tenantId: seed.tenantId,
        identifierSystem: "urn:ingenius:pre-registration",
        identifierValue: preRegisteredId,
        documentType: "TI",
        documentNumber: "555",
        givenNames: "Pre",
        familyNames: "Registro",
        birthDate: new Date("2010-03-04"),
        status: "pre_registered",
      },
    });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  function seedIds(): Record<string, string> {
    return {
      Patient: seed.medicalRecordId,
      Practitioner: seed.practitionerId,
      HealthcareService: seed.serviceId,
      Schedule: seed.scheduleId,
      Slot: seed.freeSlotId,
      Appointment: seed.appointmentId,
    };
  }

  /** Valor valido para cada parametro declarado. Falla si el registro crece sin actualizar la prueba. */
  function sampleValue(type: string, name: string): string {
    const samples: Record<string, string> = {
      identifier: "urn:hermes:x|no-existe",
      _tag: "urn:ingenius:patient-tag|pre-registered",
      active: "true",
      status: type === "Slot" ? "free" : "booked",
      start: "ge2026-06-15",
      date: "ge2026-06-15",
      schedule: `Schedule/${seed.scheduleId}`,
      patient: `Patient/${seed.medicalRecordId}`,
      slot: `Slot/${seed.busySlotId}`,
      actor: `Practitioner/${seed.practitionerId}`,
    };
    const value = samples[name];
    if (value === undefined) {
      throw new Error(`Sin valor de muestra para ${type}.${name}`);
    }
    return value;
  }

  it("lee cada recurso por id con application/fhir+json", async () => {
    for (const [type, id] of Object.entries(seedIds())) {
      const { response, body } = await fhirGet(`${type}/${id}`, token);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
      expect(response.headers.get("X-Request-Id")).toEqual(expect.any(String));
      expect(body).toMatchObject({ resourceType: type, id });
    }
  });

  it("el paciente no expone campos internos y el pre-registro va marcado", async () => {
    const confirmed = await fhirGet(`Patient/${seed.medicalRecordId}`, token);
    expect(confirmed.body.meta).toBeUndefined();
    expect(confirmed.body).not.toHaveProperty("tenantId");

    const pre = await fhirGet(`Patient/${preRegisteredId}`, token);
    expect(pre.body.meta.tag).toEqual([
      { system: "urn:ingenius:patient-tag", code: "pre-registered" },
    ]);
  });

  it("busca cada recurso y devuelve un Bundle searchset", async () => {
    for (const type of Object.keys(seedIds())) {
      const { response, body } = await fhirGet(type, token);
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ resourceType: "Bundle", type: "searchset" });
      expect(body.total).toBe((body.entry ?? []).length);
      expect(body.entry[0].fullUrl).toBe(
        `http://localhost/fhir/${type}/${body.entry[0].resource.id}`,
      );
    }
  });

  it("Patient: busca por identificador Hermes, por documento y por _tag", async () => {
    const hermes = await fhirGet(
      `Patient?identifier=${encodeURIComponent("urn:hermes:patient|MR-a")}`,
      token,
    );
    expect(idsOf(hermes.body)).toEqual([seed.medicalRecordId]);

    const document = await fhirGet(
      `Patient?identifier=${encodeURIComponent(`urn:ingenius:document:CC|${seed.documentNumber}`)}`,
      token,
    );
    expect(idsOf(document.body)).toEqual([seed.medicalRecordId]);

    const tagged = await fhirGet(`Patient?_tag=${PRE_TAG}`, token);
    expect(idsOf(tagged.body)).toEqual([preRegisteredId]);
  });

  it("Slot: filtra por agenda, estado y rango de inicio", async () => {
    const free = await fhirGet(`Slot?schedule=Schedule/${seed.scheduleId}&status=free`, token);
    expect(idsOf(free.body)).toEqual([seed.freeSlotId, lateSlotId]);

    const busy = await fhirGet("Slot?status=busy", token);
    expect(idsOf(busy.body)).toEqual([seed.busySlotId]);

    const range = await fhirGet(
      `Slot?start=${encodeURIComponent("ge2026-06-15T14:30:00Z")}&start=${encodeURIComponent("lt2026-06-15T16:00:00Z")}`,
      token,
    );
    expect(idsOf(range.body)).toEqual([seed.busySlotId]);
  });

  it("una fecha sin hora es el dia en APP_TIMEZONE", async () => {
    const june15 = await fhirGet("Slot?start=2026-06-15", token);
    expect(idsOf(june15.body)).toEqual([seed.freeSlotId, seed.busySlotId, lateSlotId]);

    const june16 = await fhirGet("Slot?start=eq2026-06-16", token);
    expect(june16.body.total).toBe(0);
  });

  it("Schedule y Appointment: filtran por referencias", async () => {
    const schedules = await fhirGet(`Schedule?actor=HealthcareService/${seed.serviceId}`, token);
    expect(idsOf(schedules.body)).toEqual([seed.scheduleId]);

    const appointments = await fhirGet(
      `Appointment?patient=Patient/${seed.medicalRecordId}&slot=Slot/${seed.busySlotId}&status=booked&date=2026-06-15`,
      token,
    );
    expect(idsOf(appointments.body)).toEqual([seed.appointmentId]);
    expect(appointments.body.entry[0].resource.participant).toHaveLength(3);
  });

  it("pagina con _count y _offset, total y enlaces", async () => {
    const first = await fhirGet("Slot?status=free&_count=1", token);
    expect(first.body.total).toBe(2);
    expect(idsOf(first.body)).toEqual([seed.freeSlotId]);
    expect(first.body.link).toEqual([
      { relation: "self", url: "http://localhost/fhir/Slot?status=free&_count=1&_offset=0" },
      { relation: "next", url: "http://localhost/fhir/Slot?status=free&_count=1&_offset=1" },
    ]);

    const second = await fhirGet("Slot?status=free&_count=1&_offset=1", token);
    expect(idsOf(second.body)).toEqual([lateSlotId]);
    expect(second.body.link.map((link: { relation: string }) => link.relation)).toEqual([
      "self",
      "previous",
    ]);

    const clamped = await fhirGet("Slot?_count=500", token);
    expect(clamped.body.link[0].url).toBe("http://localhost/fhir/Slot?_count=200&_offset=0");
  });

  it("con FHIR_BASE_URL los enlaces y fullUrl usan esa base y conservan los filtros", async () => {
    process.env.FHIR_BASE_URL = "https://api.clinica.test/fhir/";
    resetContainer();
    try {
      const { body } = await fhirGet("Slot?status=free&_count=1", token);
      expect(body.link[1]).toEqual({
        relation: "next",
        url: "https://api.clinica.test/fhir/Slot?status=free&_count=1&_offset=1",
      });
      expect(body.entry[0].fullUrl).toBe(`https://api.clinica.test/fhir/Slot/${seed.freeSlotId}`);
    } finally {
      delete process.env.FHIR_BASE_URL;
      resetContainer();
    }
  });

  it("los errores son OperationOutcome con application/fhir+json", async () => {
    const cases: Array<[string, number, string]> = [
      ["Patient/no-existe", 404, "not-found"],
      ["Task", 404, "not-found"],
      ["Slot?name=x", 400, "not-supported"],
      ["Slot?tenant_id=tenant-b", 400, "not-supported"],
      ["Patient?identifier=MR-a", 400, "invalid"],
      ["Slot?_count=0", 400, "invalid"],
      ["Slot?_offset=-1", 400, "invalid"],
      ["Slot?start=2026-02-31", 400, "invalid"],
      ["Slot?status=free&status=busy", 400, "invalid"],
      ["Slot?schedule=sin-tipo", 400, "invalid"],
      [`Patient?_tag=${encodeURIComponent("urn:x|otro")}`, 400, "invalid"],
    ];
    for (const [path, status, code] of cases) {
      const { response, body } = await fhirGet(path, token);
      expect([path, response.status]).toEqual([path, status]);
      expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue).toEqual([{ severity: "error", code, diagnostics: expect.any(String) }]);
      expect(body.error).toBeUndefined();
    }
  });

  it("metadata coincide con lo que existe", async () => {
    const { body: metadata } = await fhirGet("metadata");
    const declared: Array<{
      type: string;
      interaction: Array<{ code: string }>;
      searchParam: Array<{ name: string }>;
    }> = metadata.rest[0].resource;

    expect(declared.map((resource) => resource.type).sort()).toEqual(Object.keys(seedIds()).sort());

    for (const resource of declared) {
      expect(resource.interaction.map((interaction) => interaction.code)).toEqual([
        "read",
        "search-type",
      ]);
      const read = await fhirGet(`${resource.type}/${seedIds()[resource.type]}`, token);
      expect([resource.type, "read", read.response.status]).toEqual([resource.type, "read", 200]);

      for (const param of resource.searchParam) {
        const value = encodeURIComponent(sampleValue(resource.type, param.name));
        const search = await fhirGet(`${resource.type}?${param.name}=${value}`, token);
        expect([resource.type, param.name, search.response.status]).toEqual([
          resource.type,
          param.name,
          200,
        ]);
      }

      const undeclared = await fhirGet(`${resource.type}?no-declarado=x`, token);
      expect(undeclared.response.status).toBe(400);
    }

    // Un parametro declarado solo para otro recurso tampoco se acepta.
    expect((await fhirGet("Practitioner?schedule=Schedule/x", token)).response.status).toBe(400);
    expect((await fhirGet("Patient?active=true", token)).response.status).toBe(400);
  });
});
