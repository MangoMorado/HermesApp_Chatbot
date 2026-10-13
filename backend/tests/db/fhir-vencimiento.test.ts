import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirGet, serviceToken } from "../helpers/fhir";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

describe("fhir-conformance: vencimiento al leer en Slot", () => {
  let world: World;
  let token: string;
  let expiredSlotId: string;
  let liveSlotId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    const start = new Date(Date.now() + 48 * HOUR_MS);
    start.setUTCMinutes(0, 0, 0);
    world = await seedWorld(prisma, "v", start);
    token = await serviceToken(world.tenantId);
    liveSlotId = slotAt(world, 1);
    expiredSlotId = slotAt(world, 0);
    const command = {
      kind: "book" as const,
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      actor: ACTOR,
    };
    // Primero la vigente; despues la vencida con el reloj cinco horas atras
    // (el apartado dura 240 minutos), para que crearla no venza nada.
    await createRequest(prisma, clockAt(new Date()), { ...command, slotId: liveSlotId });
    await createRequest(prisma, clockAt(new Date(Date.now() - 5 * HOUR_MS)), {
      ...command,
      slotId: expiredSlotId,
    });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("parte de dos cupos apartados en la base", async () => {
    const slots = await prisma.slot.findMany({
      where: { id: { in: [expiredSlotId, liveSlotId] } },
    });
    expect(slots.map((slot) => slot.status)).toEqual(["busy_tentative", "busy_tentative"]);
  });

  it("leer por id el cupo de un apartado vencido lo devuelve free", async () => {
    const expired = await fhirGet(`Slot/${expiredSlotId}`, token);
    expect(expired.body.status).toBe("free");

    const live = await fhirGet(`Slot/${liveSlotId}`, token);
    expect(live.body.status).toBe("busy-tentative");

    const request = await prisma.appointmentRequest.findFirstOrThrow({
      where: { slotId: expiredSlotId },
    });
    expect(request.status).toBe("expired");
  });

  it("buscar cupos tambien vence antes de responder", async () => {
    const tentative = await fhirGet("Slot?status=busy-tentative", token);
    expect(
      (tentative.body.entry ?? []).map((entry: { resource: { id: string } }) => entry.resource.id),
    ).toEqual([liveSlotId]);

    const free = await fhirGet(`Slot?status=free&schedule=Schedule/${world.scheduleId}`, token);
    expect(
      (free.body.entry ?? []).map((entry: { resource: { id: string } }) => entry.resource.id),
    ).toContain(expiredSlotId);
  });

  it("no hay ningun Appointment propuesto para la solicitud vencida", async () => {
    const { body } = await fhirGet(`Appointment?slot=Slot/${expiredSlotId}`, token);
    expect(body.total).toBe(0);
  });
});
