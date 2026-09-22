import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const SYSTEM = "urn:test";

async function practitioner(tenantId: string, value: string): Promise<string> {
  const row = await prisma.practitioner.create({
    data: {
      id: `${tenantId}-${value}`,
      tenantId,
      identifierSystem: SYSTEM,
      identifierValue: value,
      name: value,
    },
  });
  return row.id;
}

async function service(tenantId: string, value: string): Promise<string> {
  const row = await prisma.healthcareService.create({
    data: {
      id: `${tenantId}-${value}`,
      tenantId,
      identifierSystem: SYSTEM,
      identifierValue: value,
      name: value,
    },
  });
  return row.id;
}

describe("aislamiento-tenant: la base impide referencias entre tenants", () => {
  let tenantA: string;
  let tenantB: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantA = await insertTenant(prisma, "a");
    tenantB = await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una agenda no puede apuntar al profesional de otro tenant", async () => {
    const foreignPractitioner = await practitioner(tenantB, "P-1");
    const ownService = await service(tenantA, "S-1");

    await expect(
      prisma.schedule.create({
        data: {
          id: "sched-cross",
          tenantId: tenantA,
          identifierSystem: SYSTEM,
          identifierValue: "SCH-1",
          practitionerId: foreignPractitioner,
          healthcareServiceId: ownService,
        },
      }),
    ).rejects.toThrow();
  });

  it("el mismo identificador Hermes puede existir en dos tenants", async () => {
    await practitioner(tenantA, "P-1");
    await practitioner(tenantB, "P-1");

    expect(await prisma.practitioner.count()).toBe(2);
  });

  it("el tope de rango del tenant queda entre 1 y 366", async () => {
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { maxQueryRangeDays: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { maxQueryRangeDays: 367 } }),
    ).rejects.toThrow();
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantA } })).maxQueryRangeDays,
    ).toBe(31);
  });

  it("un cupo no puede terminar antes de empezar", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        id: "sched-a",
        tenantId: tenantA,
        identifierSystem: SYSTEM,
        identifierValue: "SCH-A",
        practitionerId: await practitioner(tenantA, "P-2"),
        healthcareServiceId: await service(tenantA, "S-2"),
      },
    });

    await expect(
      prisma.slot.create({
        data: {
          id: "slot-bad",
          tenantId: tenantA,
          identifierSystem: SYSTEM,
          identifierValue: "SL-1",
          scheduleId: schedule.id,
          startAt: new Date("2026-03-02T14:00:00Z"),
          endAt: new Date("2026-03-02T13:30:00Z"),
        },
      }),
    ).rejects.toThrow();
  });
});
