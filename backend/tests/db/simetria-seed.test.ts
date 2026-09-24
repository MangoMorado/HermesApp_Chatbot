import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeed } from "../../prisma/seed/data";
import { writeChatbot } from "../../prisma/seed/write-chatbot";
import { writeSimulator } from "../../prisma/seed/write-simulator";
import { WIDGET_KEY_PATTERN } from "../../src/modules/bot-config/domain/widget-key";
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

  it("volver a sembrar con un ancla distinta no deja cupos huerfanos", async () => {
    const otherAnchor = "2026-03-09";
    const otherSeed = buildSeed(otherAnchor, "America/Bogota");

    // Linea base: sembrar solo el ancla nueva en una base limpia.
    await truncateAll(prisma);
    await writeChatbot(prisma, otherSeed);
    await writeSimulator(prisma, otherSeed);
    const freshCounts = {
      slot: await prisma.slot.count(),
      appointment: await prisma.appointment.count(),
      medicalRecord: await prisma.medicalRecord.count(),
      simSlot: await prisma.simSlot.count(),
      simAppointment: await prisma.simAppointment.count(),
    };

    // Repetir: sembrar el ancla original y luego re-sembrar con el ancla nueva.
    await truncateAll(prisma);
    await writeChatbot(prisma, seed);
    await writeSimulator(prisma, seed);
    await writeChatbot(prisma, otherSeed);
    await writeSimulator(prisma, otherSeed);

    // (a) los totales igualan a un seed nuevo del segundo ancla: no crece el dataset.
    expect(await prisma.slot.count()).toBe(freshCounts.slot);
    expect(await prisma.appointment.count()).toBe(freshCounts.appointment);
    expect(await prisma.medicalRecord.count()).toBe(freshCounts.medicalRecord);
    expect(await prisma.simSlot.count()).toBe(freshCounts.simSlot);
    expect(await prisma.simAppointment.count()).toBe(freshCounts.simAppointment);

    // (b) ningun cupo queda "busy" sin una cita que lo referencie.
    const orphanBusySlots = await prisma.slot.findMany({
      where: { status: "busy", appointments: { none: {} } },
    });
    expect(orphanBusySlots).toHaveLength(0);
    const orphanBusySimSlots = await prisma.simSlot.findMany({
      where: { status: "busy", appointments: { none: {} } },
    });
    expect(orphanBusySimSlots).toHaveLength(0);

    // (c) chatbot y simulador siguen siendo gemelos fila a fila.
    expect(byIdentifier(await prisma.simSlot.findMany())).toEqual(
      byIdentifier(await prisma.slot.findMany()),
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
});

describe("simetria-seed: cada tenant sale listo para chatear", () => {
  beforeAll(async () => {
    await truncateAll(prisma);
    await writeChatbot(prisma, seed);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cada tenant tiene bot_config, una clave vigente y 3 entradas de KB", async () => {
    for (const tenant of seed) {
      const botConfig = await prisma.botConfig.findUnique({ where: { tenantId: tenant.id } });
      expect(botConfig).not.toBeNull();
      expect(botConfig?.allowedOrigins).toEqual(["http://localhost:3000"]);

      const currentKeys = await prisma.widgetKey.findMany({
        where: { tenantId: tenant.id, retiredAt: null },
      });
      expect(currentKeys).toHaveLength(1);
      expect(currentKeys[0]?.key).toMatch(WIDGET_KEY_PATTERN);

      const entries = await prisma.knowledgeEntry.findMany({ where: { tenantId: tenant.id } });
      expect(entries).toHaveLength(3);
    }
  });

  it("la clave del widget es fija entre corridas (determinista por slug)", async () => {
    const [tenant] = seed;
    if (!tenant) throw new Error("seed vacio");
    const before = await prisma.widgetKey.findFirst({ where: { tenantId: tenant.id } });

    await writeChatbot(prisma, seed);

    const after = await prisma.widgetKey.findFirst({ where: { tenantId: tenant.id } });
    expect(after?.key).toBe(before?.key);
    expect(after?.id).toBe(before?.id);
  });

  it("volver a sembrar no duplica bot_config, clave ni entradas de KB", async () => {
    await writeChatbot(prisma, seed);
    await writeChatbot(prisma, seed);

    for (const tenant of seed) {
      expect(await prisma.botConfig.count({ where: { tenantId: tenant.id } })).toBe(1);
      expect(await prisma.widgetKey.count({ where: { tenantId: tenant.id } })).toBe(1);
      expect(await prisma.knowledgeEntry.count({ where: { tenantId: tenant.id } })).toBe(3);
    }
  });
});
