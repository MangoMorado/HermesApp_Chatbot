import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { MedicalRecord } from "@/modules/patients/domain/entities";
import {
  createPrismaMedicalRecordRepository,
  mapRecord,
} from "@/modules/patients/infrastructure/prisma-medical-record-repository";
import { ConflictError } from "@/modules/shared/domain/conflict-error";

function record(overrides: Partial<MedicalRecord> = {}): MedicalRecord {
  return {
    id: "mr-1",
    tenantId: "t1",
    identifier: { system: "urn:hermes:patient", value: "MR-1" },
    documentType: "CC",
    documentNumber: "123",
    givenNames: "Ana",
    familyNames: "Perez",
    birthDate: "1990-01-02",
    phone: null,
    email: null,
    status: "active",
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("dominio: repositorio Prisma de historial clinico", () => {
  it("mapea una fila de Prisma a MedicalRecord", () => {
    expect(
      mapRecord({
        id: "mr-1",
        tenantId: "t1",
        identifierSystem: "urn:hermes:patient",
        identifierValue: "MR-1",
        documentType: "CC",
        documentNumber: "123",
        givenNames: "Ana",
        familyNames: "Perez",
        birthDate: new Date("1990-01-02T00:00:00.000Z"),
        phone: null,
        email: null,
        status: "active",
      }),
    ).toEqual(record());
  });

  it("inserta pre-registro y activo; traduce P2002 a ConflictError", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("db down"));
    const repo = createPrismaMedicalRecordRepository({
      medicalRecord: { create },
    } as never);

    await expect(
      repo.insertPreRegistered(record({ status: "pre_registered" })),
    ).resolves.toBeUndefined();
    await expect(
      repo.insertPreRegistered(record({ status: "pre_registered" })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.insertActive(record())).resolves.toBeUndefined();
    await expect(repo.insertActive(record())).rejects.toThrow("db down");
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("actualiza desde Hermes y traduce conflictos de unicidad", async () => {
    const updated = {
      id: "mr-1",
      tenantId: "t1",
      identifierSystem: "urn:hermes:patient",
      identifierValue: "MR-1",
      documentType: "CC" as const,
      documentNumber: "123",
      givenNames: "Ana",
      familyNames: "Perez",
      birthDate: new Date("1990-01-02T00:00:00.000Z"),
      phone: null,
      email: null,
      status: "active" as const,
    };
    const update = vi
      .fn()
      .mockResolvedValueOnce(updated)
      .mockRejectedValueOnce(uniqueViolation())
      .mockRejectedValueOnce(new Error("db down"));
    const repo = createPrismaMedicalRecordRepository({
      medicalRecord: { update },
    } as never);

    await expect(repo.updateFromHermes(record())).resolves.toEqual(record());
    await expect(repo.updateFromHermes(record())).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.updateFromHermes(record())).rejects.toThrow("db down");
  });
});
