import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeed } from "../../prisma/seed/data";
import { writeChatbot } from "../../prisma/seed/write-chatbot";
import { writeSimulator } from "../../prisma/seed/write-simulator";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const seed = buildSeed("2026-03-02", "America/Bogota");

const byIdentifier = <
  T extends { tenantId: string; identifierSystem: string; identifierValue: string },
>(
  rows: T[],
) =>
  rows
    .map((row) => ({ ...row, createdAt: undefined, updatedAt: undefined }))
    .sort((a, b) =>
      `${a.tenantId}|${a.identifierSystem}|${a.identifierValue}`.localeCompare(
        `${b.tenantId}|${b.identifierSystem}|${b.identifierValue}`,
      ),
    );

describe("simetria-seed: el simulador y el chatbot parten de los mismos datos", () => {
  beforeAll(async () => {
    await truncateAll(prisma);
    await writeChatbot(prisma, seed);
    await writeSimulator(prisma, seed);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("siembra dos tenants", async () => {
    expect(await prisma.tenant.count()).toBe(2);
  });

  it("profesionales, servicios y agendas son gemelos", async () => {
    expect(byIdentifier(await prisma.simPractitioner.findMany())).toEqual(
      byIdentifier(await prisma.practitioner.findMany()),
    );
    expect(byIdentifier(await prisma.simHealthcareService.findMany())).toEqual(
      byIdentifier(await prisma.healthcareService.findMany()),
    );
    expect(byIdentifier(await prisma.simSchedule.findMany())).toEqual(
      byIdentifier(await prisma.schedule.findMany()),
    );
  });

  it("cupos, pacientes y citas son gemelos", async () => {
    expect(byIdentifier(await prisma.simSlot.findMany())).toEqual(
      byIdentifier(await prisma.slot.findMany()),
    );
    expect(byIdentifier(await prisma.simPatient.findMany())).toEqual(
      byIdentifier(await prisma.medicalRecord.findMany()),
    );
    const simAppointments = (await prisma.simAppointment.findMany()).map(
      ({ patientId, ...row }) => ({
        ...row,
        medicalRecordId: patientId,
      }),
    );
    expect(byIdentifier(simAppointments)).toEqual(
      byIdentifier(await prisma.appointment.findMany()),
    );
  });

  it("volver a sembrar con el mismo ancla no duplica nada", async () => {
    const before = await prisma.slot.count();
    await writeChatbot(prisma, seed);
    await writeSimulator(prisma, seed);
    expect(await prisma.slot.count()).toBe(before);
    expect(await prisma.simSlot.count()).toBe(before);
  });
});
