import type { Prisma } from "@prisma/client";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { type BotConfigOverrides, sanitizeOverrides } from "../domain/bot-config";
import type { BotConfigRepository } from "../domain/ports/repositories";

function toData(overrides: BotConfigOverrides) {
  return {
    texts: overrides.texts as Prisma.InputJsonObject,
    params: overrides.params as Prisma.InputJsonObject,
    allowedOrigins: [...overrides.allowedOrigins],
  };
}

export function createPrismaBotConfigRepository(db: PrismaExecutor): BotConfigRepository {
  return {
    async get(tenantId) {
      const row = await db.botConfig.findUnique({ where: { tenantId } });
      if (!row) {
        return null;
      }
      return sanitizeOverrides({
        texts: row.texts,
        params: row.params,
        allowedOrigins: row.allowedOrigins,
      });
    },
    async create(tenantId, overrides) {
      await db.botConfig.create({ data: { tenantId, ...toData(overrides) } });
    },
    async update(tenantId, overrides) {
      const result = await db.botConfig.updateMany({
        where: { tenantId },
        data: toData(overrides),
      });
      return result.count > 0;
    },
    async lock(tenantId) {
      const rows = await db.$queryRaw<{ tenant_id: string }[]>`
        SELECT "tenant_id" FROM "public"."bot_configs" WHERE "tenant_id" = ${tenantId} FOR UPDATE`;
      return rows.length === 1;
    },
  };
}
