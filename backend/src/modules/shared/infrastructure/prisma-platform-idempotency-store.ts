import type { Prisma } from "@prisma/client";
import { IdempotencyKeyTakenError } from "../domain/idempotency";
import type { PlatformIdempotencyStore } from "../domain/ports/idempotency-store";
import type { PrismaExecutor } from "./prisma-client";
import { isUniqueViolation } from "./prisma-errors";

export function createPrismaPlatformIdempotencyStore(db: PrismaExecutor): PlatformIdempotencyStore {
  return {
    async find(key) {
      const row = await db.platformIdempotencyKey.findUnique({ where: { key } });
      return row
        ? {
            key: row.key,
            method: row.method,
            path: row.path,
            requestHash: row.requestHash,
            responseStatus: row.responseStatus,
            responseBody: row.responseBody,
            createdAt: row.createdAt,
          }
        : null;
    },
    async save(record) {
      try {
        await db.platformIdempotencyKey.create({
          data: { ...record, responseBody: record.responseBody as Prisma.InputJsonValue },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new IdempotencyKeyTakenError();
        }
        throw error;
      }
    },
    async complete(key, status, body) {
      await db.platformIdempotencyKey.update({
        where: { key },
        data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue },
      });
    },
  };
}
