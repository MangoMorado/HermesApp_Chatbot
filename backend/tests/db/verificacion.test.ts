import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { cryptoRandom } from "@/modules/shared/infrastructure/crypto-random";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
import {
  createOpenChallenge,
  createReadChallenge,
  createRecordVerificationAttempt,
} from "@/modules/verification/application/verification";
import { createPrismaChallengeRepository } from "@/modules/verification/infrastructure/prisma-challenge-repository";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ACTOR = { actorSubject: "widget:s1", actorRole: "widget", requestId: "r1" };
const RECORD = { id: "", birthDate: "1990-03-07", phone: "3001234567", email: null };

function deps(db: PrismaExecutor, now = new Date()) {
  const repo = createPrismaChallengeRepository(db);
  const clock = { now: () => now };
  return {
    open: createOpenChallenge({ repo, ids: uuidV7Generator, clock }),
    read: createReadChallenge({ repo, clock }),
    attempt: createRecordVerificationAttempt({
      repo,
      clock,
      random: cryptoRandom,
      audit: createPrismaAuditLog(db, uuidV7Generator),
      policy: async () => ({ maxAttempts: 3, lockMinutes: 30 }),
      records: async (_tenant, id) => ({ ...RECORD, id }),
    }),
  };
}

describe("verificacion: persistencia", () => {
  let tenantId: ReturnType<typeof toTenantId>;
  const recordId = "mr-v";

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantId = toTenantId(await insertTenant(prisma, "v"));
    await prisma.medicalRecord.create({
      data: {
        id: recordId,
        tenantId,
        identifierSystem: "urn:hermes:patient",
        identifierValue: "MR-v",
        documentType: "CC",
        documentNumber: "4455667788",
        givenNames: "Ana",
        familyNames: "Paz",
        birthDate: new Date("1990-03-07"),
        phone: "3001234567",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("el primer par guardado gana y se mantiene entre sesiones", async () => {
    const { open } = deps(prisma);
    const first = await open({
      tenantId,
      medicalRecordId: recordId,
      questionIds: ["birth_day", "phone_last_4"],
    });
    const second = await open({
      tenantId,
      medicalRecordId: recordId,
      questionIds: ["birth_year", "phone_first_3"],
    });
    expect(first).toEqual(["birth_day", "phone_last_4"]);
    expect(second).toEqual(first);
  });

  it("tres fallos bloquean y auditan sin guardar respuestas", async () => {
    const { open, attempt, read } = deps(prisma);
    await open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_day", "phone_last_4"] });
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        (await attempt({ ...ACTOR, tenantId, medicalRecordId: recordId, success: false })).result,
      );
    }
    expect(results).toEqual(["failed", "failed", "locked"]);
    expect((await read(tenantId, recordId))?.lockedUntil).not.toBeNull();
    const actions = await prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: { occurredAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "verification.failed",
      "verification.failed",
      "verification.locked",
    ]);
    expect(actions.every((a) => a.resourceId === recordId)).toBe(true);
  });

  it("dos intentos simultaneos no pierden incrementos", async () => {
    await deps(prisma).open({
      tenantId,
      medicalRecordId: recordId,
      questionIds: ["birth_day", "phone_last_4"],
    });
    const attemptInTx = () =>
      prisma.$transaction((tx) =>
        deps(tx).attempt({ ...ACTOR, tenantId, medicalRecordId: recordId, success: false }),
      );
    await Promise.all([attemptInTx(), attemptInTx()]);
    const row = await prisma.verificationChallenge.findFirstOrThrow({ where: { tenantId } });
    expect(row.failedAttempts).toBe(2);
  });

  it("un bloqueo vencido se lee con el contador en cero y el mismo par", async () => {
    const past = new Date(Date.now() - 2 * 3_600_000);
    const { open, attempt } = deps(prisma, past);
    await open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_day", "phone_last_4"] });
    for (let i = 0; i < 3; i++) {
      await attempt({ ...ACTOR, tenantId, medicalRecordId: recordId, success: false });
    }
    const challenge = await deps(prisma).read(tenantId, recordId);
    expect(challenge).toMatchObject({
      failedAttempts: 0,
      lockedUntil: null,
      questionIds: ["birth_day", "phone_last_4"],
    });
  });
});
