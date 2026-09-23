import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { WidgetSessionRepository } from "../domain/ports/ports";

export function createPrismaWidgetSessionRepository(db: PrismaExecutor): WidgetSessionRepository {
  return {
    async create(session) {
      await db.widgetSession.create({ data: { ...session } });
    },
    async get(tenantId, id) {
      const row = await db.widgetSession.findFirst({ where: { tenantId, id } });
      return row ? { ...row, tenantId: toTenantId(row.tenantId) } : null;
    },
    async extend(session) {
      await db.widgetSession.updateMany({
        where: { tenantId: session.tenantId, id: session.id },
        data: { lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt },
      });
    },
  };
}
