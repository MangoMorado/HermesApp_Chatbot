import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { REPLACES_APPOINTMENT } from "@/modules/fhir/domain/profiles";
import { fhirGet, fhirPut, fhirSend, serviceToken } from "../helpers/fhir";
import { signToken } from "../helpers/token";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { HERMES_SYSTEM, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const REQUEST_SYSTEM = "urn:ingenius:appointment-request";

function bookedBody(value: string) {
  return {
    resourceType: "Appointment",
    status: "booked",
    identifier: [{ system: HERMES_SYSTEM.appointment, value }],
  };
}

describe("fhir-conformance: pre-agenda por FHIR", () => {
  let world: World;
  let token: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    const start = new Date(Date.now() + 48 * HOUR_MS);
    start.setUTCMinutes(0, 0, 0);
    world = await seedWorld(prisma, "p", start);
    token = await serviceToken(world.tenantId);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  async function book() {
    return createRequest(prisma, clockAt(new Date()), {
      kind: "book",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      slotId: slotAt(world, 0),
      actor: ACTOR,
    });
  }

  it("lee un book como Appointment proposed y lo confirma con el id de la solicitud", async () => {
    const request = await book();
    const read = await fhirGet(`Appointment/${request.id}`, token);
    expect(read.response.status).toBe(200);
    expect(read.body.status).toBe("proposed");
    expect(read.body.identifier).toEqual([{ system: REQUEST_SYSTEM, value: request.id }]);
    expect(read.body.participant.map((item: { status: string }) => item.status)).toEqual([
      "accepted",
      "needs-action",
      "needs-action",
    ]);

    const key = "book-approve";
    const first = await fhirPut(`Appointment/${request.id}`, token, bookedBody("AP-nueva"), {
      "Idempotency-Key": key,
    });
    const second = await fhirPut(`Appointment/${request.id}`, token, bookedBody("AP-nueva"), {
      "Idempotency-Key": key,
    });

    expect(first.response.status).toBe(200);
    expect(first.body).toMatchObject({
      resourceType: "Appointment",
      id: request.id,
      status: "booked",
      identifier: [{ system: HERMES_SYSTEM.appointment, value: "AP-nueva" }],
    });
    expect(second.body).toEqual(first.body);
    expect(await prisma.appointment.count({ where: { id: request.id } })).toBe(1);
    expect(
      (await prisma.auditEvent.findMany({ where: { resourceId: request.id } })).map(
        (event) => event.action,
      ),
    ).toEqual(
      expect.arrayContaining(["appointment_request.approved", "appointment.written_by_hermes"]),
    );
  });

  it("rechazar el Appointment libera el cupo", async () => {
    const request = await book();
    const { response, body } = await fhirPut(`Appointment/${request.id}`, token, {
      resourceType: "Appointment",
      status: "cancelled",
    });
    expect(response.status).toBe(200);
    expect(body.status).toBe("cancelled");
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotAt(world, 0) } })).status).toBe(
      "free",
    );
    expect(
      (await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .resolutionReason,
    ).toBe("declined");
  });

  it("un reschedule proposed trae replaces y al aprobarlo conserva el id", async () => {
    const request = await createRequest(prisma, clockAt(new Date()), {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: slotAt(world, 1),
      actor: ACTOR,
    });
    const read = await fhirGet(`Appointment/${request.id}`, token);
    expect(read.body.extension).toEqual([
      {
        url: REPLACES_APPOINTMENT,
        valueReference: { reference: `Appointment/${world.appointmentId}` },
      },
    ]);

    const put = await fhirPut(`Appointment/${request.id}`, token, bookedBody("AP-reprog"));
    expect(put.response.status).toBe(200);
    expect(put.body.id).toBe(request.id);
    expect(put.body.extension).toEqual(read.body.extension);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status,
    ).toBe("cancelled");
  });

  it("completa un Task de cancelacion y rechaza otro", async () => {
    const cancel = await createRequest(prisma, clockAt(new Date()), {
      kind: "cancel",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      actor: ACTOR,
    });
    const read = await fhirGet(`Task/${cancel.id}`, token);
    expect(read.body).toMatchObject({
      resourceType: "Task",
      status: "requested",
      intent: "proposal",
      focus: { reference: `Appointment/${world.appointmentId}` },
      for: { reference: `Patient/${world.medicalRecordId}` },
    });

    const done = await fhirPut(`Task/${cancel.id}`, token, {
      resourceType: "Task",
      status: "completed",
    });
    expect(done.response.status).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status,
    ).toBe("cancelled");
    expect(
      (await prisma.auditEvent.findMany({ where: { resourceId: cancel.id } })).some(
        (event) => event.action === "task.written_by_hermes",
      ),
    ).toBe(true);
  });

  it("rechazar el Task deja la cita en firme", async () => {
    const cancel = await createRequest(prisma, clockAt(new Date()), {
      kind: "cancel",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      actor: ACTOR,
    });
    const rejected = await fhirPut(`Task/${cancel.id}`, token, {
      resourceType: "Task",
      status: "rejected",
      statusReason: { coding: [{ code: "slot_unavailable" }] },
    });
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.statusReason.coding[0].code).toBe("slot_unavailable");
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status,
    ).toBe("booked");
  });

  it("una cita en firme y un id desconocido no se resuelven", async () => {
    const firm = await fhirPut(`Appointment/${world.appointmentId}`, token, bookedBody("AP-x"));
    expect(firm.response.status).toBe(409);
    const missing = await fhirPut("Appointment/no-existe", token, bookedBody("AP-x"));
    expect(missing.response.status).toBe(404);
    const description = await fhirPut(`Appointment/${world.appointmentId}`, token, {
      ...bookedBody("AP-x"),
      description: "nota",
    });
    expect(description.response.status).toBe(422);
  });

  it("operator no resuelve y DELETE anuncia PUT", async () => {
    const operator = await signToken({ role: "operator", tenantId: world.tenantId });
    const denied = await fhirPut(
      `Appointment/${world.appointmentId}`,
      operator,
      bookedBody("AP-x"),
    );
    expect(denied.response.status).toBe(403);
    const deleted = await fhirSend("DELETE", `Task/${world.appointmentId}`, token);
    expect(deleted.response.status).toBe(405);
    expect(deleted.response.headers.get("Allow")).toBe("GET, PUT");
  });
});
