import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import {
  ACTOR,
  clockAt,
  createRequest,
  extraPatients,
  type MutableClock,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const START = new Date("2026-06-15T14:00:00.000Z");
const T0 = new Date("2026-06-15T08:00:00.000Z");

function book(world: World, slotId: string, medicalRecordId = world.medicalRecordId) {
  return { kind: "book", tenantId: world.tenantId, medicalRecordId, slotId, actor: ACTOR } as const;
}

async function slotStatus(id: string) {
  return (await prisma.slot.findUniqueOrThrow({ where: { id } })).status;
}

describe("pre-agenda: creacion de solicitudes", () => {
  let world: World;
  let clock: MutableClock;

  beforeEach(async () => {
    await truncateAll(prisma);
    world = await seedWorld(prisma, "a", START, { freeSlots: 5 });
    clock = clockAt(T0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("book aparta el cupo y vence con el plazo del tenant", async () => {
    const request = await createRequest(prisma, clock, book(world, slotAt(world, 0)));
    expect(request).toMatchObject({ kind: "book", status: "pending", appointmentId: null });
    expect(request.expiresAt).toEqual(new Date("2026-06-15T12:00:00.000Z"));
    expect(await slotStatus(slotAt(world, 0))).toBe("busy_tentative");
    expect(
      await prisma.auditEvent.count({ where: { action: "appointment_request.created" } }),
    ).toBe(1);
  });

  it("el vencimiento se recorta al inicio del cupo", async () => {
    const request = await createRequest(prisma, clock, book(world, slotAt(world, 0)), {
      holdMinutes: 480,
      maxPendingHolds: 2,
    });
    expect(request.expiresAt).toEqual(START);
  });

  it("10 pacientes sobre el mismo cupo: exactamente una solicitud", async () => {
    const patients = await extraPatients(prisma, world, 10);
    const results = await Promise.allSettled(
      patients.map((mr) => createRequest(prisma, clock, book(world, slotAt(world, 0), mr))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const failure of results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )) {
      expect(failure.reason).toMatchObject({ details: { reason: "slot_unavailable" } });
    }
    expect(await prisma.appointmentRequest.count()).toBe(1);
    expect(await slotStatus(slotAt(world, 0))).toBe("busy_tentative");
  });

  it("5 solicitudes del mismo paciente con tope 2: exactamente dos", async () => {
    const results = await Promise.allSettled(
      world.freeSlotIds.map((slotId) => createRequest(prisma, clock, book(world, slotId))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const failure of results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )) {
      expect(failure.reason).toMatchObject({ details: { reason: "pending_limit_reached" } });
    }
    expect(await prisma.slot.count({ where: { status: "busy_tentative" } })).toBe(2);
  });

  it("las cancelaciones no cuentan para el tope", async () => {
    const policy = { holdMinutes: 240, maxPendingHolds: 1 };
    await createRequest(prisma, clock, book(world, slotAt(world, 0)), policy);
    const cancel = await createRequest(
      prisma,
      clock,
      {
        kind: "cancel",
        tenantId: world.tenantId,
        medicalRecordId: world.medicalRecordId,
        appointmentId: world.appointmentId,
        actor: ACTOR,
      },
      policy,
    );
    expect(cancel).toMatchObject({ kind: "cancel", slotId: null });
  });

  it("un apartado vencido sin marcar no bloquea a otro paciente", async () => {
    const [other] = await extraPatients(prisma, world, 1);
    const first = await createRequest(prisma, clock, book(world, slotAt(world, 0)));
    clock.set(new Date("2026-06-15T12:30:00.000Z"));
    const second = await createRequest(prisma, clock, book(world, slotAt(world, 0), other));
    expect(second.status).toBe("pending");
    expect(
      (await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe("expired");
    expect(await slotStatus(slotAt(world, 0))).toBe("busy_tentative");
  });

  it("reprogramar aparta el cupo nuevo y referencia la cita", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: slotAt(world, 1),
      actor: ACTOR,
    });
    expect(request).toMatchObject({ appointmentId: world.appointmentId, slotId: slotAt(world, 1) });
    expect(await slotStatus(slotAt(world, 1))).toBe("busy_tentative");
  });

  it("reprogramar hacia un cupo ocupado es slot_unavailable y no deja rastro", async () => {
    await createRequest(prisma, clock, book(world, slotAt(world, 0)));
    const attempt = createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: slotAt(world, 0),
      actor: ACTOR,
    });
    await expect(attempt).rejects.toMatchObject({ details: { reason: "slot_unavailable" } });
    expect(
      await prisma.appointmentRequest.count({ where: { appointmentId: world.appointmentId } }),
    ).toBe(0);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status,
    ).toBe("booked");
  });

  it("reprogramar al mismo cupo de la cita es 422", async () => {
    const attempt = createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: world.bookedSlotId,
      actor: ACTOR,
    });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
  });

  it("un segundo cambio sobre la misma cita es appointment_change_pending", async () => {
    const cancel = {
      kind: "cancel",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      actor: ACTOR,
    } as const;
    await createRequest(prisma, clock, cancel);
    await expect(createRequest(prisma, clock, cancel)).rejects.toMatchObject({
      details: { reason: "appointment_change_pending" },
    });
  });

  it("cupo ya empezado es 422", async () => {
    clock.set(START);
    await expect(
      createRequest(prisma, clock, book(world, slotAt(world, 0))),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cupo, paciente o cita de otro tenant es 404", async () => {
    const other = await seedWorld(prisma, "b", START);
    await expect(
      createRequest(prisma, clock, book(world, slotAt(other, 0))),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createRequest(prisma, clock, book(world, slotAt(world, 0), other.medicalRecordId)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createRequest(prisma, clock, {
        kind: "cancel",
        tenantId: world.tenantId,
        medicalRecordId: world.medicalRecordId,
        appointmentId: other.appointmentId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la cita de otro paciente del mismo tenant es 404", async () => {
    const [other] = await extraPatients(prisma, world, 1);
    if (!other) throw new Error("extraPatients no devolvio historia clinica");
    await expect(
      createRequest(prisma, clock, {
        kind: "cancel",
        tenantId: world.tenantId,
        medicalRecordId: other,
        appointmentId: world.appointmentId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
