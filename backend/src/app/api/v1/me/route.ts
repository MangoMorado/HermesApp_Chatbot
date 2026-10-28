import { privateRoute } from "@/http/route";

export const dynamic = "force-dynamic";

/**
 * Identidad efectiva del token. No toca datos de dominio, asi que el rol `widget`
 * tambien la alcanza.
 */
export const GET = privateRoute(["widget", "operator", "admin", "service"], ({ actor }) => ({
  subject: actor.subject,
  tenant_id: actor.tenantId,
  role: actor.role,
}));
