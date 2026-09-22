import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

describe("esquema del simulador", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("vive en hermes_sim con las seis tablas", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'hermes_sim' ORDER BY tablename`;
    expect(rows.map((row) => row.tablename)).toEqual([
      "appointments",
      "healthcare_services",
      "patients",
      "practitioners",
      "schedules",
      "slots",
    ]);
  });

  it("ninguna FK cruza entre public y hermes_sim", async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT con.conname AS name
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_namespace srcns ON srcns.oid = src.relnamespace
      JOIN pg_class dst ON dst.oid = con.confrelid
      JOIN pg_namespace dstns ON dstns.oid = dst.relnamespace
      WHERE con.contype = 'f' AND srcns.nspname <> dstns.nspname`;
    expect(rows).toEqual([]);
  });

  it("acepta un tenant que no existe en public (sin FK al chatbot)", async () => {
    await prisma.simPractitioner.create({
      data: {
        id: "sim-p1",
        tenantId: "tenant-solo-en-hermes",
        identifierSystem: "urn:test",
        identifierValue: "P-1",
        name: "Ana",
      },
    });
    expect(await prisma.simPractitioner.count()).toBe(1);
  });
});
