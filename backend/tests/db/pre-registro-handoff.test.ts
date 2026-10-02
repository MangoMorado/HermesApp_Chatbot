import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCreateHandoffTicket } from "@/modules/handoff/application/create-handoff-ticket";
import { createPrismaHandoffRepository } from "@/modules/handoff/infrastructure/prisma-handoff-repository";
import { createPreRegisterPatient } from "@/modules/patients/application/pre-register-patient";
import { createPrismaMedicalRecordRepository } from "@/modules/patients/infrastructure/prisma-medical-record-repository";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import { systemClock } from "@/modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ACTOR = { actorSubject: "widget:s1", actorRole: "widget", requestId: "r1" };
const DATA = {
  documentType: "CC" as const,
  documentNumber: "1020304050",
  givenNames: "Ana",
  familyNames: "Paz",
  birthDate: "1990-03-07",
  phone: "3001234567",
  email: null,
};

describe("pre-registro y handoff: persistencia", () => {
  let tenantId: ReturnType<typeof toTenantId>;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantId = toTenantId((await insertChatbotTenant(prisma, "p")).tenantId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const deps = () => ({
    repo: createPrismaMedicalRecordRepository(prisma),
    ids: uuidV7Generator,
    clock: systemClock,
    audit: createPrismaAuditLog(prisma, uuidV7Generator),
  });

  it("crea un expediente pre_registered con identificador propio y lo audita", async () => {
    const record = await createPreRegisterPatient(deps())({ ...ACTOR, tenantId, data: DATA });
    const row = await prisma.medicalRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row).toMatchObject({
      status: "pre_registered",
      identifierSystem: "urn:ingenius:pre-registration",
      identifierValue: record.id,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId } });
    expect(audit).toMatchObject({ action: "patient.pre_registered", resourceId: record.id });
  });

  it("un documento existente es document_taken", async () => {
    const register = createPreRegisterPatient(deps());
    await register({ ...ACTOR, tenantId, data: DATA });
    await expect(register({ ...ACTOR, tenantId, data: DATA })).rejects.toMatchObject({
      constructor: ConflictError,
      details: { reason: "document_taken" },
    });
  });

  it("el ticket de handoff nace abierto y se audita", async () => {
    const now = new Date();
    await prisma.widgetSession.create({
      data: {
        id: "ws",
        tenantId,
        origin: "https://c.test",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 3_600_000),
        lastSeenAt: now,
      },
    });
    await prisma.conversation.create({
      data: {
        id: "c1",
        tenantId,
        widgetSessionId: "ws",
        step: "main_menu",
        context: {},
        createdAt: now,
        updatedAt: now,
      },
    });
    const create = createCreateHandoffTicket({
      repo: createPrismaHandoffRepository(prisma),
      ids: uuidV7Generator,
      clock: systemClock,
      audit: createPrismaAuditLog(prisma, uuidV7Generator),
    });
    const ticket = await create({
      ...ACTOR,
      tenantId,
      conversationId: "c1",
      reason: "requested",
      medicalRecordId: null,
    });
    expect(
      await prisma.handoffTicket.findUniqueOrThrow({ where: { id: ticket.id } }),
    ).toMatchObject({
      status: "open",
      reason: "requested",
    });
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { tenantId } })).action).toBe(
      "handoff.created",
    );
  });
});
