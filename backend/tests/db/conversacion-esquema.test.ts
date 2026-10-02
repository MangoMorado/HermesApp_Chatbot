import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

async function seedSession(slug: string) {
  const { tenantId } = await insertChatbotTenant(prisma, slug);
  const now = new Date();
  await prisma.widgetSession.create({
    data: {
      id: `${tenantId}-ws`,
      tenantId,
      origin: "https://clinica.test",
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      lastSeenAt: now,
    },
  });
  await prisma.medicalRecord.create({
    data: {
      id: `${tenantId}-mr`,
      tenantId,
      identifierSystem: "urn:hermes:patient",
      identifierValue: `MR-${slug}`,
      documentType: "CC",
      documentNumber: `900${slug}`,
      givenNames: "Ana",
      familyNames: "Paz",
      birthDate: new Date("1990-01-15"),
    },
  });
  return { tenantId, sessionId: `${tenantId}-ws`, recordId: `${tenantId}-mr` };
}

function conversationData(tenantId: string, sessionId: string, id: string) {
  const now = new Date();
  return {
    id,
    tenantId,
    widgetSessionId: sessionId,
    step: "main_menu",
    context: {},
    createdAt: now,
    updatedAt: now,
  };
}

describe("conversacion: esquema", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una sola conversacion por sesion de widget", async () => {
    const s = await seedSession("a");
    await prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c1") });
    await expect(
      prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c2") }),
    ).rejects.toThrow();
  });

  it("la sesion debe ser del mismo tenant", async () => {
    const a = await seedSession("a");
    const b = await seedSession("b");
    await expect(
      prisma.conversation.create({ data: conversationData(b.tenantId, a.sessionId, "c1") }),
    ).rejects.toThrow();
  });

  it("un mensaje redactado solo guarda el marcador", async () => {
    const s = await seedSession("a");
    await prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c1") });
    const base = {
      tenantId: s.tenantId,
      conversationId: "c1",
      author: "patient" as const,
      createdAt: new Date(),
    };
    await prisma.conversationMessage.create({
      data: { ...base, id: "m1", seq: 1, text: "[redactado]", redacted: true },
    });
    await expect(
      prisma.conversationMessage.create({
        data: { ...base, id: "m2", seq: 2, text: "15", redacted: true },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.conversationMessage.create({
        data: { ...base, id: "m3", seq: 1, text: "[redactado]", redacted: true },
      }),
    ).rejects.toThrow();
  });

  it("el desafio guarda exactamente dos preguntas y uno por expediente", async () => {
    const s = await seedSession("a");
    const base = {
      tenantId: s.tenantId,
      medicalRecordId: s.recordId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(
      prisma.verificationChallenge.create({
        data: { ...base, id: "v0", questionIds: ["birth_day"] },
      }),
    ).rejects.toThrow();
    await prisma.verificationChallenge.create({
      data: { ...base, id: "v1", questionIds: ["birth_day", "phone_last_4"] },
    });
    await expect(
      prisma.verificationChallenge.create({
        data: { ...base, id: "v2", questionIds: ["birth_year", "phone_last_4"] },
      }),
    ).rejects.toThrow();
  });

  it("el ticket de handoff nace abierto", async () => {
    const s = await seedSession("a");
    await prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c1") });
    const ticket = await prisma.handoffTicket.create({
      data: {
        id: "h1",
        tenantId: s.tenantId,
        conversationId: "c1",
        reason: "requested",
        createdAt: new Date(),
      },
    });
    expect(ticket.status).toBe("open");
    expect(ticket.medicalRecordId).toBeNull();
  });
});
