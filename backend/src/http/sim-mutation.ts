import type { Actor } from "@/modules/auth/domain/actor";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { isRecord } from "@/modules/shared/domain/input";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { ValidationError } from "@/modules/shared/domain/validation-error";

type SimMutationPorts = {
  readonly auditLog: AuditLog;
  readonly clock: Clock;
};

export type SimDeleteResult = "ok" | "missing" | "has_dependents";

/** Cuerpo JSON objeto; falla con ValidationError si no lo es. */
export function requireObjectBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  return body;
}

export function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

export function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Auditoria de mutaciones del simulador (mismo shape en todos los recursos). */
export async function recordSimAudit(
  ports: SimMutationPorts,
  actor: Actor,
  requestId: string,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await ports.auditLog.record({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    action,
    resourceType,
    resourceId,
    requestId,
    occurredAt: ports.clock.now(),
  });
}

/** Traduce el resultado de un delete del store a errores HTTP del simulador. */
export function assertSimDelete(result: SimDeleteResult, conflictMessage: string): void {
  if (result === "missing") {
    throw new NotFoundError();
  }
  if (result === "has_dependents") {
    throw new ConflictError(conflictMessage);
  }
}
