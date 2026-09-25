import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedWorld, slotAt, type World } from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const START = new Date("2026-06-15T14:00:00.000Z");
const EXPIRES = new Date("2026-06-15T12:00:00.000Z");
const CREATED = new Date("2026-06-15T08:00:00.000Z");

function request(world: World, id: string, overrides: Record<string, unknown>) {
  return prisma.appointmentRequest.create({
    data: {
      id,
      tenantId: world.tenantId,
      kind: "book",
      medicalRecordId: world.medicalRecordId,
      slotId: slotAt(world, 0),
      expiresAt: EXPIRES,
      createdAt: CREATED,
      ...overrides,
    },
  });
}

describe("pre-agenda: esquema de appointment_requests", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll(prisma);
    world = await seedWorld(prisma, "a", START);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dos solicitudes pendientes no pueden apartar el mismo cupo", async () => {
    await request(world, "r1", {});
    await expect(request(world, "r2", {})).rejects.toThrow();
  });

  it("una resuelta no bloquea una nueva pendiente sobre el mismo cupo", async () => {
    await request(world, "r1", { status: "expired", resolvedAt: EXPIRES });
    await expect(request(world, "r2", {})).resolves.toMatchObject({ id: "r2" });
  });

  it("una cita admite una sola solicitud de cambio pendiente", async () => {
    const cancel = { kind: "cancel", slotId: null, appointmentId: world.appointmentId };
    await request(world, "r1", cancel);
    await expect(
      request(world, "r2", { kind: "reschedule", appointmentId: world.appointmentId }),
    ).rejects.toThrow();
  });

  it("rechaza formas invalidas por tipo", async () => {
    await expect(
      request(world, "r1", { kind: "cancel", appointmentId: world.appointmentId }),
    ).rejects.toThrow();
    await expect(
      request(world, "r2", { kind: "book", appointmentId: world.appointmentId }),
    ).rejects.toThrow();
    await expect(request(world, "r3", { kind: "reschedule" })).rejects.toThrow();
  });

  it("el motivo solo acompana al rechazo", async () => {
    await expect(request(world, "r1", { status: "rejected" })).rejects.toThrow();
    await expect(request(world, "r2", { resolutionReason: "declined" })).rejects.toThrow();
    await expect(
      request(world, "r3", {
        status: "rejected",
        resolutionReason: "declined",
        resolvedAt: EXPIRES,
      }),
    ).resolves.toMatchObject({ id: "r3" });
  });

  it("no referencia cupos de otro tenant", async () => {
    const other = await seedWorld(prisma, "b", START);
    await expect(request(world, "r1", { slotId: slotAt(other, 0) })).rejects.toThrow();
  });
});
