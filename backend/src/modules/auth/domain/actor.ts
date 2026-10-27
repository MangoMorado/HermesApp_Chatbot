import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantRole } from "./role";

/**
 * Quien hace la peticion dentro de un tenant, ya autenticado.
 * `tenantId` sale unicamente del claim del token: nunca del body, query ni header libre.
 */
export type Actor = {
  readonly subject: string;
  readonly tenantId: TenantId;
  readonly role: TenantRole;
};

/** Operador de la plataforma: no lleva tenant y solo alcanza `/api/platform/v1`. */
export type PlatformActor = {
  readonly subject: string;
  readonly role: "platform";
};

export type AuthenticatedActor = Actor | PlatformActor;

export function isPlatformActor(actor: AuthenticatedActor): actor is PlatformActor {
  return actor.role === "platform";
}

/** El actor alcanza el recurso solo si pertenece a su mismo tenant. */
export function belongsToTenant(actor: Actor, resourceTenantId: string): boolean {
  return actor.tenantId === resourceTenantId;
}
