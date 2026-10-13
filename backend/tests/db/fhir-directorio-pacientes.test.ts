import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MedicalRecordDirectory } from "@/modules/patients/domain/ports/repositories";
import { createPrismaMedicalRecordDirectory } from "@/modules/patients/infrastructure/prisma-medical-record-directory";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();

describe("fhir-conformance: busqueda de historias clinicas por desplazamiento", () => {
  let a: TenantDomainSeed;
  let b: TenantDomainSeed;
  let tenantA: TenantId;
  let directory: MedicalRecordDirectory;
  let preRegisteredId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    a = await seedTenantDomain(prisma, "a");
    b = await seedTenantDomain(prisma, "b");
    tenantA = toTenantId(a.tenantId);
    directory = createPrismaMedicalRecordDirectory(prisma);
    preRegisteredId = `${a.tenantId}-mr-pre`;
    await prisma.medicalRecord.create({
      data: {
        id: preRegisteredId,
        tenantId: a.tenantId,
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
    await prisma.$disconnect();
  });

  const base = () => ({
    tenantId: tenantA,
    identifier: null,
    document: null,
    preRegistered: null,
    offset: 0,
    limit: 50,
  });

  it("lista solo las del tenant, por id, con total", async () => {
    const page = await directory.search(base());
    expect(page.total).toBe(2);
    expect(page.data.map((row) => row.id)).toEqual([a.medicalRecordId, preRegisteredId].sort());
    expect(page.data.some((row) => row.id === b.medicalRecordId)).toBe(false);
  });

  it("pagina por desplazamiento", async () => {
    const second = await directory.search({ ...base(), offset: 1, limit: 1 });
    expect(second.total).toBe(2);
    expect(second.data).toHaveLength(1);
  });

  it("busca por identificador Hermes", async () => {
    const own = await directory.search({
      ...base(),
      identifier: { system: HERMES_SYSTEM.patient, value: "MR-a" },
    });
    expect(own.data.map((row) => row.id)).toEqual([a.medicalRecordId]);

    const foreign = await directory.search({
      ...base(),
      identifier: { system: HERMES_SYSTEM.patient, value: "MR-b" },
    });
    expect(foreign).toEqual({ data: [], total: 0 });
  });

  it("busca por documento", async () => {
    const own = await directory.search({ ...base(), document: { type: "TI", number: "555" } });
    expect(own.data.map((row) => row.id)).toEqual([preRegisteredId]);

    const wrongType = await directory.search({
      ...base(),
      document: { type: "CC", number: "555" },
    });
    expect(wrongType.total).toBe(0);

    const foreign = await directory.search({
      ...base(),
      document: { type: "CC", number: b.documentNumber },
    });
    expect(foreign.total).toBe(0);
  });

  it("filtra los pre-registros", async () => {
    const pre = await directory.search({ ...base(), preRegistered: true });
    expect(pre.data.map((row) => row.id)).toEqual([preRegisteredId]);
    expect(pre.data[0]?.birthDate).toBe("2010-03-04");

    const confirmed = await directory.search({ ...base(), preRegistered: false });
    expect(confirmed.data.map((row) => row.id)).toEqual([a.medicalRecordId]);
  });
});
