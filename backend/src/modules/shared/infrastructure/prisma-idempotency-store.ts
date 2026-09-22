import { Prisma } from "@prisma/client";
import { IdempotencyKeyTakenError } from "../domain/idempotency";
import type { IdempotencyStore } from "../domain/ports/idempotency-store";
import { toTenantId } from "../domain/tenant-id";
import type { PrismaExecutor } from "./prisma-client";

const UNIQUE_VIOLATION = "P2002";

export function createPrismaIdempotencyStore(db: PrismaExecutor): IdempotencyStore {
  return {
    async find(tenantId, key) {
      const row = await db.idempotencyKey.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
      if (!row) {
        return null;
      }
      return {
        tenantId: toTenantId(row.tenantId),
        key: row.key,
        actorSubject: row.actorSubject,
        method: row.method,
        path: row.path,
        requestHash: row.requestHash,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
        createdAt: row.createdAt,
      };
    },

    async save(record) {
      try {
        await db.idempotencyKey.create({
          data: {
            tenantId: record.tenantId,
            key: record.key,
            actorSubject: record.actorSubject,
            method: record.method,
            path: record.path,
            requestHash: record.requestHash,
            responseStatus: record.responseStatus,
            responseBody: record.responseBody as Prisma.InputJsonValue,
            createdAt: record.createdAt,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_VIOLATION
        ) {
          throw new IdempotencyKeyTakenError();
        }
        throw error;
      }
    },

    async complete(tenantId, key, status, body) {
      await db.idempotencyKey.update({
        where: { tenantId_key: { tenantId, key } },
        data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue },
      });
    },
  };
}
