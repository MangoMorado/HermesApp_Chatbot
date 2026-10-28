import type { Actor, AuthenticatedActor, PlatformActor } from "../domain/actor";
import { belongsToTenant, isPlatformActor } from "../domain/actor";
import { forbidden, notFound } from "../domain/auth-error";
import type { TenantRole } from "../domain/role";

/** Exige un actor de tenant con uno de los roles admitidos por la ruta. */
export function requireTenantActor(
  actor: AuthenticatedActor,
  allowed: readonly TenantRole[],
): Actor {
  if (isPlatformActor(actor) || !allowed.includes(actor.role)) {
    throw forbidden(`El rol ${actor.role} no admite esta operacion`);
  }
  return actor;
}

/** Exige el actor de plataforma: ningun rol de tenant alcanza esa superficie. */
export function requirePlatformActor(actor: AuthenticatedActor): PlatformActor {
  if (!isPlatformActor(actor)) {
    throw forbidden(`El rol ${actor.role} no admite esta operacion`);
  }
  return actor;
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
