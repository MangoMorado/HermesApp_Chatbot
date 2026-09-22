import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Role } from "./role";

/**
 * Quien hace la peticion, ya autenticado.
 * `tenantId` sale unicamente del claim del token: nunca del body, query ni header libre.
 */
export type Actor = {
  readonly subject: string;
  readonly tenantId: TenantId;
  readonly role: Role;
  /** Solo para el rol `widget`: la sesion de chat que puede alcanzar. */
  readonly sessionId?: string;
};

/** El actor alcanza el recurso solo si pertenece a su mismo tenant. */
export function belongsToTenant(actor: Actor, resourceTenantId: string): boolean {
  return actor.tenantId === resourceTenantId;
}

/** El widget solo alcanza su propia sesion de chat. */
export function reachesSession(actor: Actor, sessionId: string): boolean {
  if (actor.role !== "widget") {
    return true;
  }
  return actor.sessionId === sessionId;
}
