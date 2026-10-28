import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { WidgetSessionRepository } from "../domain/ports/ports";
import type { WidgetSession } from "../domain/widget-session";

type Row = Omit<WidgetSession, "tenantId"> & { tenantId: string };

function toSession(row: Row | null): WidgetSession | null {
  return row ? { ...row, tenantId: toTenantId(row.tenantId) } : null;
}

export function createPrismaWidgetSessionRepository(db: PrismaExecutor): WidgetSessionRepository {
  return {
    async create(session) {
      await db.widgetSession.create({ data: { ...session } });
    },
    async get(tenantId, id) {
      return toSession(await db.widgetSession.findFirst({ where: { tenantId, id } }));
    },
    async getBySecretHash(tenantId, secretHash) {
      return toSession(await db.widgetSession.findFirst({ where: { tenantId, secretHash } }));
    },
    async extend(session) {
      await db.widgetSession.updateMany({
        where: { tenantId: session.tenantId, id: session.id },
        data: { lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt },
      });
    },
  };
}
