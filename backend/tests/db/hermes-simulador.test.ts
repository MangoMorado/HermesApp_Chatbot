import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHandlerFhirHttp } from "@/composition/handler-fhir-http";
import { resetContainer } from "@/composition-root";
import { loadConfig } from "@/config/env";
import { createJoseTokenIssuer } from "@/modules/auth/infrastructure/jose-token-issuer";
import { createFhirChatbotGateway } from "@/modules/hermes-simulator/application/fhir-gateway";
import {
  createHermesSync,
  createSyncMasters,
} from "@/modules/hermes-simulator/application/hermes-sync";
import { createApproveInboxRequest } from "@/modules/hermes-simulator/application/inbox";
import { createServiceTokens } from "@/modules/hermes-simulator/application/service-tokens";
import { createPrismaSimCatalog } from "@/modules/hermes-simulator/infrastructure/prisma-catalog";
import { createPrismaHermesSession } from "@/modules/hermes-simulator/infrastructure/prisma-hermes-session";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
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
import { HERMES_SYSTEM, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

function futureStart(): Date {
  const start = new Date(Date.now() + 48 * HOUR_MS);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

function cycle(db: PrismaClient) {
  const http = createHandlerFhirHttp();
  const tokens = createServiceTokens(createJoseTokenIssuer(loadConfig().jwt));
  const gateway = createFhirChatbotGateway({ http, tokens });
  const catalog = createPrismaSimCatalog(db);
  return {
    sync: createHermesSync({
      catalog,
      http,
      tokens,
      gateway,
      approve: createApproveInboxRequest({
        gateway,
        session: createPrismaHermesSession(db),
        ids: uuidV7Generator,
      }),
    }),
    masters: createSyncMasters({ catalog, http, tokens }),
  };
}

async function extraPractitioner(world: World): Promise<void> {
  await prisma.simPractitioner.create({
    data: {
      id: `${world.tenantId}-extra`,
      tenantId: world.tenantId,
      identifierSystem: HERMES_SYSTEM.practitioner,
      identifierValue: `P-${world.slug}-extra`,
      name: `Extra ${world.slug}`,
      active: true,
    },
  });
}

describe("hermes-simulador", () => {
  let alpha: World;
  let beta: World;
  const clock = clockAt(new Date());

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    clock.set(new Date());
    const start = futureStart();
    alpha = await seedWorld(prisma, "a", start);
    beta = await seedWorld(prisma, "b", start);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("copia a public un maestro que solo estaba en hermes_sim, aislado por tenant", async () => {
    await extraPractitioner(alpha);
    await extraPractitioner(beta);
    const { sync } = cycle(prisma);
    await sync(alpha.tenantId);
    await sync(beta.tenantId);
    const query = (slug: string) =>
      `Practitioner?identifier=${encodeURIComponent(`${HERMES_SYSTEM.practitioner}|P-${slug}-extra`)}`;
    const own = await fhirGet(query("a"), await serviceToken(alpha.tenantId));
    const other = await fhirGet(query("a"), await serviceToken(beta.tenantId));
    expect(own.body.total).toBe(1);
    expect(other.body.total).toBe(0);
  });

  it("book con cupo libre queda booked y repetir no duplica", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "book",
      tenantId: alpha.tenantId,
      medicalRecordId: alpha.medicalRecordId,
      slotId: slotAt(alpha, 0),
      actor: ACTOR,
    });
    const { sync } = cycle(prisma);
    await sync(alpha.tenantId);
    await sync(alpha.tenantId);
    const row = await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe("approved");
    expect(await prisma.appointment.count({ where: { identifierValue: `AP-${request.id}` } })).toBe(
      1,
    );
  });

  it("book con el cupo ocupado en Hermes queda rejected por slot_unavailable", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "book",
      tenantId: alpha.tenantId,
      medicalRecordId: alpha.medicalRecordId,
      slotId: slotAt(alpha, 0),
      actor: ACTOR,
    });
    await prisma.simSlot.updateMany({
      where: { tenantId: alpha.tenantId, identifierValue: "SL-a-0" },
      data: { status: "busy" },
    });
    await cycle(prisma).sync(alpha.tenantId);
    expect(
      await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({ status: "rejected", resolutionReason: "slot_unavailable" });
  });

  it("cancel conocida deja la cita cancelled y el cupo free", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "cancel",
      tenantId: alpha.tenantId,
      medicalRecordId: alpha.medicalRecordId,
      appointmentId: alpha.appointmentId,
      actor: ACTOR,
    });
    await cycle(prisma).sync(alpha.tenantId);
    expect(request.id).toEqual(expect.any(String));
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: alpha.appointmentId } })).status,
    ).toBe("cancelled");
    expect(
      (await prisma.slot.findUniqueOrThrow({ where: { id: alpha.bookedSlotId } })).status,
    ).toBe("free");
  });

  it("confirma un pre-registro: active y sin el tag", async () => {
    const id = `${alpha.tenantId}-pre`;
    await prisma.medicalRecord.create({
      data: {
        id,
        tenantId: alpha.tenantId,
        identifierSystem: "urn:ingenius:pre-registration",
        identifierValue: id,
        documentType: "CC",
        documentNumber: "778899",
        givenNames: "Pre",
        familyNames: "Registro",
        birthDate: new Date("1990-01-15"),
        status: "pre_registered",
      },
    });
    await cycle(prisma).sync(alpha.tenantId);
    expect(await prisma.medicalRecord.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "active",
      identifierSystem: HERMES_SYSTEM.patient,
      identifierValue: "PR-CC-778899",
    });
    const tagged = await fhirGet(
      "Patient?_tag=urn%3Aingenius%3Apatient-tag%7Cpre-registered",
      await serviceToken(alpha.tenantId),
    );
    expect(tagged.body.total).toBe(0);
  });

  it("un Slot apartado con un cambio no permitido responde 409 y el cupo no cambia", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "book",
      tenantId: alpha.tenantId,
      medicalRecordId: alpha.medicalRecordId,
      slotId: slotAt(alpha, 0),
      actor: ACTOR,
    });
    const moved = new Date(alpha.start.getTime() + 5 * 60_000);
    await prisma.simSlot.updateMany({
      where: { tenantId: alpha.tenantId, identifierValue: "SL-a-0" },
      data: { startAt: moved },
    });
    const report = await cycle(prisma).masters(alpha.tenantId);
    expect(report.retryLater).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.slot.findUniqueOrThrow({ where: { id: slotAt(alpha, 0) } })).startAt,
    ).toEqual(alpha.start);
    expect(
      (await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("pending");
  });

  it("metadata no declara interacciones nuevas", async () => {
    const { body } = await fhirGet("metadata");
    const resources = body.rest[0].resource as { interaction: { code: string }[] }[];
    for (const resource of resources) {
      expect(resource.interaction.map((item) => item.code).sort()).toEqual(
        ["read", "search-type", "update"].sort(),
      );
    }
  });
});
