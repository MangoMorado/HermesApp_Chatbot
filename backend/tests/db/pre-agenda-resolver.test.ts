import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getAvailability } from "@/app/api/v1/availability/route";
import { resetContainer } from "@/composition-root";
import {
  createExpireDueRequests,
  createListAppointmentRequests,
} from "@/modules/scheduling/application/appointment-request-queries";
import { createPrismaAppointmentRequestReader } from "@/modules/scheduling/infrastructure/prisma-appointment-request-reader";
import { createPrismaRequestExpirer } from "@/modules/scheduling/infrastructure/prisma-pre-agenda-store";
import { authedRequest, signToken } from "../helpers/token";
import {
  ACTOR,
  clockAt,
  createRequest,
  type MutableClock,
  resolveRequest,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { HERMES_SYSTEM, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const START = new Date("2026-06-15T14:00:00.000Z");
const T0 = new Date("2026-06-15T08:00:00.000Z");
const HERMES_APPT = { system: HERMES_SYSTEM.appointment, value: "AP-hermes-1" };
const APPROVE = { outcome: "approved", appointmentIdentifier: HERMES_APPT } as const;
const DECLINE = { outcome: "rejected", reason: "declined" } as const;

describe("pre-agenda: resolucion y vencimiento", () => {
  let world: World;
  let clock: MutableClock;

  const status = async (id: string) =>
    (await prisma.slot.findUniqueOrThrow({ where: { id } })).status;
  const appt = async (id: string) =>
    (await prisma.appointment.findUniqueOrThrow({ where: { id } })).status;
  const book = (slotId: string) =>
    createRequest(prisma, clock, {
      kind: "book",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      slotId,
      actor: ACTOR,
    });
  const reschedule = (slotId: string) =>
    createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId,
      actor: ACTOR,
    });
  const cancel = () =>
    createRequest(prisma, clock, {
      kind: "cancel",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      actor: ACTOR,
    });
  const resolve = (requestId: string, resolution: typeof APPROVE | typeof DECLINE) =>
    resolveRequest(prisma, clock, {
      tenantId: world.tenantId,
      requestId,
      resolution,
      actor: ACTOR,
    });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    world = await seedWorld(prisma, "a", START);
    clock = clockAt(T0);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("book aprobado: cupo busy y cita booked con el identificador de Hermes", async () => {
    const request = await book(slotAt(world, 0));
    const resolved = await resolve(request.id, APPROVE);
    expect(resolved.status).toBe("approved");
    expect(await status(slotAt(world, 0))).toBe("busy");
    const created = await prisma.appointment.findUniqueOrThrow({
      where: { id: resolved.resultingAppointmentId ?? "" },
    });
    expect(created).toMatchObject({
      status: "booked",
      slotId: slotAt(world, 0),
      identifierValue: "AP-hermes-1",
    });
  });

  it("book rechazado: cupo libre y motivo guardado", async () => {
    const request = await book(slotAt(world, 0));
    const resolved = await resolve(request.id, DECLINE);
    expect(resolved).toMatchObject({
      status: "rejected",
      resolutionReason: "declined",
      resultingAppointmentId: null,
    });
    expect(await status(slotAt(world, 0))).toBe("free");
  });

  it("reschedule aprobado: cita vieja cancelada y cita nueva en el cupo nuevo", async () => {
    const request = await reschedule(slotAt(world, 1));
    const resolved = await resolve(request.id, APPROVE);
    expect(await appt(world.appointmentId)).toBe("cancelled");
    expect(await status(world.bookedSlotId)).toBe("free");
    expect(await status(slotAt(world, 1))).toBe("busy");
    expect(await appt(resolved.resultingAppointmentId ?? "")).toBe("booked");
  });

  it("reschedule rechazado: cupo nuevo libre y cita vieja intacta", async () => {
    const request = await reschedule(slotAt(world, 1));
    await resolve(request.id, DECLINE);
    expect(await status(slotAt(world, 1))).toBe("free");
    expect(await appt(world.appointmentId)).toBe("booked");
    expect(await status(world.bookedSlotId)).toBe("busy");
  });

  it("cancel aprobado: cita cancelada y su cupo libre", async () => {
    const request = await cancel();
    const resolved = await resolve(request.id, APPROVE);
    expect(resolved.resultingAppointmentId).toBeNull();
    expect(await appt(world.appointmentId)).toBe("cancelled");
    expect(await status(world.bookedSlotId)).toBe("free");
  });

  it("cancel rechazado: nada cambia", async () => {
    const request = await cancel();
    await resolve(request.id, DECLINE);
    expect(await appt(world.appointmentId)).toBe("booked");
    expect(await status(world.bookedSlotId)).toBe("busy");
  });

  it("resolver una vencida es request_not_pending con status expired", async () => {
    const request = await book(slotAt(world, 0));
    clock.set(new Date("2026-06-15T12:00:00.000Z"));
    await expect(resolve(request.id, APPROVE)).rejects.toMatchObject({
      details: { reason: "request_not_pending", status: "expired" },
    });
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("resolver dos veces es request_not_pending", async () => {
    const request = await book(slotAt(world, 0));
    await resolve(request.id, APPROVE);
    await expect(resolve(request.id, DECLINE)).rejects.toMatchObject({
      details: { reason: "request_not_pending", status: "approved" },
    });
  });

  it("dos resoluciones simultaneas (aprobar y rechazar): gana una y el estado es coherente", async () => {
    const request = await book(slotAt(world, 0));
    const results = await Promise.allSettled([
      resolve(request.id, APPROVE),
      resolve(request.id, DECLINE),
    ]);
    type Fulfilled = Extract<(typeof results)[number], { status: "fulfilled" }>;
    const isRejected = (r: (typeof results)[number]): r is PromiseRejectedResult =>
      r.status === "rejected";
    const isFulfilled = (r: (typeof results)[number]): r is Fulfilled => r.status === "fulfilled";
    const fulfilled = results.filter(isFulfilled);
    const rejected = results.filter(isRejected);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ details: { reason: "request_not_pending" } });
    const winner = fulfilled[0]?.value;
    if (winner?.status === "approved") {
      expect(await status(slotAt(world, 0))).toBe("busy");
      expect(await prisma.appointment.count()).toBe(2);
    } else {
      expect(winner?.status).toBe("rejected");
      expect(await status(slotAt(world, 0))).toBe("free");
      expect(await prisma.appointment.count()).toBe(1);
    }
  });

  it("resolver una solicitud de otro tenant es 404", async () => {
    const other = await seedWorld(prisma, "b", START);
    const request = await book(slotAt(world, 0));
    await expect(
      resolveRequest(prisma, clock, {
        tenantId: other.tenantId,
        requestId: request.id,
        resolution: APPROVE,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("el vencimiento por conjunto marca expired y libera solo apartados", async () => {
    const request = await book(slotAt(world, 0));
    clock.set(new Date("2026-06-15T12:00:00.000Z"));
    await createExpireDueRequests({ expirer: createPrismaRequestExpirer(prisma), clock })(
      world.tenantId,
    );
    const row = await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ status: "expired" });
    expect(row.resolvedAt).toEqual(new Date("2026-06-15T12:00:00.000Z"));
    expect(await status(slotAt(world, 0))).toBe("free");
    expect(await status(world.bookedSlotId)).toBe("busy");
  });

  it("la lista devuelve vistas con identificadores y pagina por cursor", async () => {
    await book(slotAt(world, 0));
    await cancel();
    const list = createListAppointmentRequests({
      reader: createPrismaAppointmentRequestReader(prisma),
      expire: async () => {},
    });
    const first = await list({ tenantId: world.tenantId, status: "pending", limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({
      kind: "book",
      patient: { identifier: { value: "MR-a" }, documentNumber: "1000a" },
      slot: { identifier: { value: "SL-a-0" } },
      appointment: null,
    });
    const second = await list({
      tenantId: world.tenantId,
      status: "pending",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.data[0]).toMatchObject({
      kind: "cancel",
      appointment: { identifier: { value: "AP-a" } },
    });
    expect(second.nextCursor).toBeNull();
  });

  it("GET /availability vence apartados antes de responder", async () => {
    await book(slotAt(world, 0));
    const token = await signToken({ role: "operator", tenantId: world.tenantId });
    const response = await getAvailability(
      authedRequest("http://localhost/api/v1/availability?from=2026-06-15&to=2026-06-16", token),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((slot: { id: string }) => slot.id)).toContain(slotAt(world, 0));
    expect(await status(slotAt(world, 0))).toBe("free");
  });
});
