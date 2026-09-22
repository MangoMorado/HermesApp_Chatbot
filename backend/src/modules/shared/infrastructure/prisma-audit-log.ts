import type { AuditLog } from "../domain/ports/audit-log";
import type { IdGenerator } from "../domain/ports/id-generator";
import type { PrismaExecutor } from "./prisma-client";

export function createPrismaAuditLog(db: PrismaExecutor, ids: IdGenerator): AuditLog {
  return {
    async record(event) {
      await db.auditEvent.create({
        data: {
          id: ids.next(),
          tenantId: event.tenantId,
          actorSubject: event.actorSubject,
          actorRole: event.actorRole,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          requestId: event.requestId,
          occurredAt: event.occurredAt,
        },
      });
    },
  };
}
