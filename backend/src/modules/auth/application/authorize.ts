import type { Actor } from "../domain/actor";
import { belongsToTenant, reachesSession } from "../domain/actor";
import { forbidden, notFound } from "../domain/auth-error";
import type { Role } from "../domain/role";

/** Exige que el actor tenga uno de los roles admitidos por la ruta. */
export function requireRole(actor: Actor, allowed: readonly Role[]): void {
  if (!allowed.includes(actor.role)) {
    throw forbidden(`El rol ${actor.role} no admite esta operacion`);
  }
}

/**
 * Exige que el recurso sea del tenant del actor.
 * Falla como `not_found`, nunca como `forbidden`: un 403 confirmaria que existe.
 */
export function requireTenant(actor: Actor, resourceTenantId: string): void {
  if (!belongsToTenant(actor, resourceTenantId)) {
    throw notFound();
  }
}

/** Exige que un actor `widget` solo alcance su propia sesion de chat. */
export function requireSession(actor: Actor, sessionId: string): void {
  if (!reachesSession(actor, sessionId)) {
    throw notFound();
  }
}
