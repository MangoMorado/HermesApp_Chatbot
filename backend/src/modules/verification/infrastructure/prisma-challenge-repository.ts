import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { Challenge } from "../domain/challenge";
import type { QuestionPair } from "../domain/draw";
import type { ChallengeRepository } from "../domain/ports";

function mapChallenge(row: {
  id: string;
  tenantId: string;
  medicalRecordId: string;
  questionIds: string[];
  failedAttempts: number;
  lockedUntil: Date | null;
}): Challenge {
  return {
    id: row.id,
    tenantId: row.tenantId,
    medicalRecordId: row.medicalRecordId,
    questionIds: [row.questionIds[0] ?? "", row.questionIds[1] ?? ""] as QuestionPair,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
  };
}

export function createPrismaChallengeRepository(db: PrismaExecutor): ChallengeRepository {
  const find: ChallengeRepository["find"] = async (tenantId, medicalRecordId) => {
    const row = await db.verificationChallenge.findUnique({
      where: { tenantId_medicalRecordId: { tenantId, medicalRecordId } },
    });
    return row ? mapChallenge(row) : null;
  };
  return {
    find,

    async insertIfAbsent(challenge, now) {
      await db.verificationChallenge.createMany({
        data: [
          {
            id: challenge.id,
            tenantId: challenge.tenantId,
            medicalRecordId: challenge.medicalRecordId,
            questionIds: [...challenge.questionIds],
            failedAttempts: challenge.failedAttempts,
            lockedUntil: challenge.lockedUntil,
            createdAt: now,
            updatedAt: now,
          },
        ],
        skipDuplicates: true,
      });
    },

    async findForUpdate(tenantId, medicalRecordId) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."verification_challenges"
        WHERE "tenant_id" = ${tenantId} AND "medical_record_id" = ${medicalRecordId} FOR UPDATE`;
      if (locked.length === 0) {
        return null;
      }
      return find(tenantId, medicalRecordId);
    },

    async update(challenge, now) {
      await db.verificationChallenge.update({
        where: { id: challenge.id },
        data: {
          questionIds: [...challenge.questionIds],
          failedAttempts: challenge.failedAttempts,
          lockedUntil: challenge.lockedUntil,
          updatedAt: now,
        },
      });
    },
  };
}
