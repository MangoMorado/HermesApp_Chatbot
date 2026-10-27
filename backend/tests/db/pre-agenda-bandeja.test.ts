import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/sim/v1/inbox/[id]/approve/route";
import { POST as reject } from "@/app/api/sim/v1/inbox/[id]/reject/route";
import { GET as listInbox } from "@/app/api/sim/v1/inbox/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/idp";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  inboxPost,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

/** Cupos futuros: la bandeja corre con el reloj del sistema. */
function futureStart(): Date {
  const start = new Date(Date.now() + 48 * HOUR_MS);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("pre-agenda: bandeja del simulador", () => {
  let world: World;
  let token: string;
  const clock = clockAt(new Date());

  const book = (slotIndex: number) =>
    createRequest(prisma, clock, {
      kind: "book",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      slotId: slotAt(world, slotIndex),
      actor: ACTOR,
    });
  const simSlot = (value: string) =>
    prisma.simSlot.findFirstOrThrow({
      where: { tenantId: world.tenantId, identifierValue: value },
    });
  const slot = (id: string) => prisma.slot.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    clock.set(new Date());
    world = await seedWorld(prisma, "a", futureStart());
    token = await signToken({ role: "admin", tenantId: world.tenantId, subject: "admin-a" });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("lista solo las pendientes vivas, con identificadores de Hermes", async () => {
    const live = await book(0);
    const stale = await book(1);
    await prisma.appointmentRequest.update({
      where: { id: stale.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await listInbox(authedRequest("http://localhost/api/sim/v1/inbox", token));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([live.id]);
    expect(body.data[0]).toMatchObject({
      kind: "book",
      patient: { identifier: { value: "MR-a" }, document_number: "1000a" },
      slot: { identifier: { value: "SL-a-0" } },
    });
    expect(
      (await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: stale.id } })).status,
    ).toBe("expired");
    expect((await slot(slotAt(world, 1))).status).toBe("free");
  });

  it("aprobar book deja cita y cupo coherentes en ambos lados", async () => {
    const request = await book(0);
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("approved");
    const identifier = body.resulting_appointment.identifier.value as string;
    expect((await slot(slotAt(world, 0))).status).toBe("busy");
    expect((await simSlot("SL-a-0")).status).toBe("busy");
    const chatbotAppt = await prisma.appointment.findFirstOrThrow({
      where: { identifierValue: identifier },
    });
    const hermesAppt = await prisma.simAppointment.findFirstOrThrow({
      where: { identifierValue: identifier },
    });
    expect(chatbotAppt.status).toBe("booked");
    expect(hermesAppt.status).toBe("booked");
    expect(chatbotAppt.startAt).toEqual(hermesAppt.startAt);
  });

  it("cupo ocupado en Hermes: 200 rechazada por slot_unavailable y cupo liberado", async () => {
    const request = await book(0);
    await prisma.simSlot.updateMany({
      where: { identifierValue: "SL-a-0" },
      data: { status: "busy" },
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "rejected",
      resolution_reason: "slot_unavailable",
    });
    expect((await slot(slotAt(world, 0))).status).toBe("free");
    expect(await prisma.simAppointment.count()).toBe(1);
  });

  it("aprobar reschedule mueve la cita en ambos lados", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: slotAt(world, 1),
      actor: ACTOR,
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(200);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status,
    ).toBe("cancelled");
    expect(
      (await prisma.simAppointment.findFirstOrThrow({ where: { identifierValue: "AP-a" } })).status,
    ).toBe("cancelled");
    expect((await simSlot("SL-a-booked")).status).toBe("free");
    expect((await slot(world.bookedSlotId)).status).toBe("free");
    expect((await simSlot("SL-a-1")).status).toBe("busy");
    expect((await slot(slotAt(world, 1))).status).toBe("busy");
  });

  it("aprobar cancel cancela en ambos lados", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "cancel",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      actor: ACTOR,
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(200);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status,
    ).toBe("cancelled");
    expect(
      (await prisma.simAppointment.findFirstOrThrow({ where: { identifierValue: "AP-a" } })).status,
    ).toBe("cancelled");
    expect((await simSlot("SL-a-booked")).status).toBe("free");
  });

  it("rechazar libera el cupo y no toca Hermes", async () => {
    const request = await book(0);
    const response = await reject(inboxPost(`${request.id}/reject`, token), params(request.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "rejected",
      resolution_reason: "declined",
    });
    expect((await slot(slotAt(world, 0))).status).toBe("free");
    expect((await simSlot("SL-a-0")).status).toBe("free");
  });

  it("paciente desconocido para Hermes: 409 y nada escrito en ningun lado", async () => {
    const request = await book(0);
    await prisma.simPatient.updateMany({
      where: { identifierValue: "MR-a" },
      data: { identifierValue: "MR-otro" },
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toMatchObject({
      reason: "patient_not_in_hermes",
    });
    expect((await simSlot("SL-a-0")).status).toBe("free");
    expect(
      (await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("pending");
  });

  it("aprobar una vencida: 409 request_not_pending", async () => {
    const request = await book(0);
    await prisma.appointmentRequest.update({
      where: { id: request.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toMatchObject({ reason: "request_not_pending" });
    expect((await simSlot("SL-a-0")).status).toBe("free");
  });
});
