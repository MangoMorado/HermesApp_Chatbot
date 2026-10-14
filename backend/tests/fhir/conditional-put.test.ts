import { describe, expect, it, vi } from "vitest";
import { createConditionalPut } from "@/modules/fhir/application/conditional-put";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import type { PractitionerRecord } from "@/modules/fhir/domain/ports/sources";
import type { FhirWriters } from "@/modules/fhir/domain/ports/writers";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const TENANT = toTenantId("tenant-a");
const ACTOR = {
  actorSubject: "hermes",
  actorRole: "service",
  requestId: "req-1",
} as const;
const IDENTIFIER = { system: "urn:hermes:practitioner", value: "P-1" };
const RECORD: PractitionerRecord = {
  id: "pr-1",
  identifier: IDENTIFIER,
  name: "Ada Lovelace",
  active: true,
};

function body(id?: string): unknown {
  return {
    resourceType: "Practitioner",
    ...(id ? { id } : {}),
    identifier: [IDENTIFIER],
    active: true,
    name: [{ text: "Ada Lovelace" }],
  };
}

function writers(practitioner: FhirWriters["Practitioner"]): FhirWriters {
  const unused = async () => {
    throw new Error("writer inesperado");
  };
  return {
    Patient: unused,
    Practitioner: practitioner,
    HealthcareService: unused,
    Schedule: unused,
    Slot: unused,
  };
}

function input(resourceBody: unknown = body()) {
  return {
    tenantId: TENANT,
    actor: ACTOR,
    type: "Practitioner",
    entries: [["identifier", "urn:hermes:practitioner|P-1"]] as const,
    body: resourceBody,
  };
}

async function fhirFailure(run: () => Promise<unknown>): Promise<FhirError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FhirError) {
      return error;
    }
    throw error;
  }
  throw new Error("deberia haber fallado");
}

describe("fhir-conformance: conditional PUT", () => {
  it("devuelve 201 y el recurso mapeado cuando crea", async () => {
    const writer = vi.fn(async () => ({ outcome: "created" as const, record: RECORD }));
    const result = await createConditionalPut(writers(writer))(input());

    expect(result).toEqual({
      status: 201,
      resource: expect.objectContaining({
        resourceType: "Practitioner",
        id: "pr-1",
        active: true,
      }),
    });
    expect(writer).toHaveBeenCalledWith({
      tenantId: TENANT,
      actor: ACTOR,
      identifier: IDENTIFIER,
      name: "Ada Lovelace",
      active: true,
    });
  });

  it("devuelve 200 cuando actualiza y acepta el mismo id en el cuerpo", async () => {
    const writer = vi.fn(async () => ({ outcome: "updated" as const, record: RECORD }));
    const result = await createConditionalPut(writers(writer))(input(body("pr-1")));
    expect(result.status).toBe(200);
    expect(result.resource.id).toBe("pr-1");
  });

  it("traduce una coincidencia ambigua a 412 multiple-matches", async () => {
    const writer = vi.fn(async () => ({ outcome: "ambiguous" as const }));
    const error = await fhirFailure(() => createConditionalPut(writers(writer))(input()));
    expect({ status: error.status, code: error.code }).toEqual({
      status: 412,
      code: "multiple-matches",
    });
  });

  it("rechaza despues de escribir un id distinto en una actualizacion", async () => {
    const writer = vi.fn(async () => ({ outcome: "updated" as const, record: RECORD }));
    const error = await fhirFailure(() =>
      createConditionalPut(writers(writer))(input(body("otro-id"))),
    );
    expect(writer).toHaveBeenCalledOnce();
    expect({ status: error.status, code: error.code }).toEqual({ status: 400, code: "invalid" });
  });

  it("rechaza despues de escribir un id en un alta", async () => {
    const writer = vi.fn(async () => ({ outcome: "created" as const, record: RECORD }));
    const error = await fhirFailure(() =>
      createConditionalPut(writers(writer))(input(body("pr-1"))),
    );
    expect(writer).toHaveBeenCalledOnce();
    expect({ status: error.status, code: error.code }).toEqual({ status: 400, code: "invalid" });
  });

  it("solo admite un parametro identifier", async () => {
    const writer = vi.fn(async () => ({ outcome: "created" as const, record: RECORD }));
    const put = createConditionalPut(writers(writer));
    const error = await fhirFailure(() => put({ ...input(), entries: [["active", "true"]] }));
    expect({ status: error.status, code: error.code }).toEqual({
      status: 400,
      code: "not-supported",
    });
    expect(writer).not.toHaveBeenCalled();
  });
});
