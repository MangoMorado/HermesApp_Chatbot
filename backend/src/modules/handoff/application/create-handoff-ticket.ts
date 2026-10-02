import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HandoffReason, HandoffTicket } from "../domain/handoff-ticket";
import type { HandoffRepository } from "../domain/ports";

export type CreateHandoffTicket = (
  input: AuditActor & {
    readonly tenantId: TenantId;
    readonly conversationId: string;
    readonly reason: HandoffReason;
    readonly medicalRecordId: string | null;
  },
) => Promise<HandoffTicket>;

export function createCreateHandoffTicket(deps: {
  repo: HandoffRepository;
  ids: IdGenerator;
  clock: Clock;
  audit: AuditLog;
}): CreateHandoffTicket {
  return async (input) => {
    const ticket: HandoffTicket = {
      id: deps.ids.next(),
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      reason: input.reason,
      medicalRecordId: input.medicalRecordId,
      createdAt: deps.clock.now(),
    };
    await deps.repo.insert(ticket);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "handoff.created",
      resourceType: "handoff_ticket",
      resourceId: ticket.id,
      requestId: input.requestId,
      occurredAt: ticket.createdAt,
    });
    return ticket;
  };
}
