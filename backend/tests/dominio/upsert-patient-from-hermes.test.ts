import { describe, expect, it, vi } from "vitest";
import { createUpsertPatientFromHermes } from "@/modules/patients/application/upsert-patient-from-hermes";
import type { MedicalRecord } from "@/modules/patients/domain/entities";
import { ConflictError } from "@/modules/shared/domain/conflict-error";

function record(overrides: Partial<MedicalRecord> = {}): MedicalRecord {
  return {
    id: "mr-1",
    tenantId: "t1",
    identifier: { system: "urn:ingenius:pre-registration", value: "mr-1" },
    documentType: "CC",
    documentNumber: "123",
    givenNames: "Ana",
    familyNames: "Perez",
    birthDate: "1990-01-02",
    phone: null,
    email: null,
    status: "pre_registered",
    ...overrides,
  };
}

const input = {
  tenantId: "t1" as never,
  actor: { actorSubject: "hermes", actorRole: "service", requestId: "r1" },
  queryIdentifier: { system: "urn:hermes:patient", value: "MR-9" },
  businessIdentifier: { system: "urn:hermes:patient", value: "MR-9" },
  documentType: "CC" as const,
  documentNumber: "123",
  givenNames: "Ana",
  familyNames: "Perez",
  birthDate: "1990-01-02",
  phone: null,
  email: null,
};

function dependencies(
  overrides: { byDocument?: MedicalRecord | null; byIdentifier?: MedicalRecord | null } = {},
) {
  const repo = {
    findByDocument: vi.fn(async () => overrides.byDocument ?? null),
    findByIdentifier: vi.fn(async () => overrides.byIdentifier ?? null),
    get: vi.fn(),
    insertPreRegistered: vi.fn(),
    insertActive: vi.fn(),
    updateFromHermes: vi.fn(async (row: MedicalRecord) => row),
  };
  return {
    repo,
    audit: { record: vi.fn(async () => {}) },
    ids: { next: () => "new-id" },
    clock: { now: () => new Date("2026-06-15T12:00:00.000Z") },
  };
}

describe("dominio: upsert Patient desde Hermes", () => {
  it("crea un paciente activo cuando no hay coincidencias", async () => {
    const deps = dependencies();
    const result = await createUpsertPatientFromHermes(deps)(input);

    expect(result).toEqual({
      outcome: "created",
      record: record({
        id: "new-id",
        identifier: input.businessIdentifier,
        status: "active",
      }),
    });
    expect(deps.repo.insertActive).toHaveBeenCalledWith(result.record);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "patient.written_by_hermes",
        resourceType: "medical_record",
        resourceId: "new-id",
      }),
    );
  });

  it("actualiza el paciente encontrado por identificador", async () => {
    const existing = record({
      status: "active",
      givenNames: "Nombre anterior",
      documentNumber: "999",
    });
    const deps = dependencies({ byIdentifier: existing });
    const result = await createUpsertPatientFromHermes(deps)(input);

    expect(result.outcome).toBe("updated");
    expect(result.record).toEqual(
      record({ identifier: input.businessIdentifier, status: "active" }),
    );
    expect(deps.repo.updateFromHermes).toHaveBeenCalledWith(result.record);
  });

  it("confirma un pre-registro por documento y audita", async () => {
    const deps = dependencies({ byDocument: record() });
    const result = await createUpsertPatientFromHermes(deps)(input);

    expect(result.outcome).toBe("updated");
    expect(result.record.status).toBe("active");
    expect(result.record.id).toBe("mr-1");
    expect(result.record.identifier).toEqual(input.businessIdentifier);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "patient.written_by_hermes",
        resourceId: "mr-1",
      }),
    );
  });

  it("busca por documento cuando la query no es el identificador de negocio", async () => {
    const existing = record({ status: "active" });
    const deps = dependencies({ byDocument: existing });
    const result = await createUpsertPatientFromHermes(deps)({
      ...input,
      queryIdentifier: { system: "urn:ingenius:document:CC", value: "123" },
    });

    expect(result.outcome).toBe("updated");
    expect(deps.repo.findByIdentifier).not.toHaveBeenCalled();
    expect(deps.repo.findByDocument).toHaveBeenCalledWith("t1", "CC", "123");
  });

  it("falla si el documento es de un paciente activo distinto", async () => {
    const deps = dependencies({
      byDocument: record({ status: "active", id: "otro" }),
    });

    await expect(createUpsertPatientFromHermes(deps)(input)).rejects.toBeInstanceOf(ConflictError);
    expect(deps.repo.updateFromHermes).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });
});
