import type { Identity } from "@/api/models/identity";
import type { PlatformIdentity } from "@/platform/models/platformIdentity";

/** Quién es la sesión según el backend: alguien de una clínica o la plataforma (sin clínica). */
export type SessionIdentity =
  | {
      readonly kind: "tenant";
      readonly subject: string;
      readonly role: Identity["role"];
      readonly tenantId: string;
    }
  | { readonly kind: "platform"; readonly subject: string; readonly role: "platform" };

/**
 * Pregunta a los dos `/me` a la vez y se queda con el que responde. Así el frontend no
 * decodifica el token ni usa un `403` como pista: si ninguno responde, manda el error de clínica.
 */
export async function resolveIdentity(
  loadTenant: () => Promise<Identity>,
  loadPlatform: () => Promise<PlatformIdentity>,
): Promise<SessionIdentity> {
  const [tenant, platform] = await Promise.allSettled([loadTenant(), loadPlatform()]);
  if (tenant.status === "fulfilled") {
    const { subject, role, tenant_id } = tenant.value;
    return { kind: "tenant", subject, role, tenantId: tenant_id };
  }
  if (platform.status === "fulfilled") {
    return { kind: "platform", subject: platform.value.subject, role: "platform" };
  }
  throw tenant.reason;
}
