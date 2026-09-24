import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import type { WidgetKeyRepository } from "../domain/ports/repositories";
import type { WidgetKey } from "../domain/widget-key";

type Row = {
  id: string;
  tenantId: string;
  key: string;
  createdAt: Date;
  retiredAt: Date | null;
  graceUntil: Date | null;
};

function mapKey(row: Row): WidgetKey {
  return { ...row, tenantId: toTenantId(row.tenantId) };
}

export function createPrismaWidgetKeyRepository(db: PrismaExecutor): WidgetKeyRepository {
  return {
    async listAccepted(tenantId, now) {
      const rows = await db.widgetKey.findMany({
        where: { tenantId, OR: [{ retiredAt: null }, { graceUntil: { gt: now } }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(mapKey);
    },
    async findByKey(key) {
      const row = await db.widgetKey.findUnique({ where: { key } });
      return row ? mapKey(row) : null;
    },
    async insert(key) {
      try {
        await db.widgetKey.create({ data: { ...key } });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("El tenant ya tiene una clave de widget vigente");
        }
        throw error;
      }
    },
    async retire(tenantId, retirement) {
      await db.widgetKey.updateMany({
        where: { tenantId, id: retirement.id },
        data: { retiredAt: retirement.retiredAt, graceUntil: retirement.graceUntil },
      });
    },
  };
}
