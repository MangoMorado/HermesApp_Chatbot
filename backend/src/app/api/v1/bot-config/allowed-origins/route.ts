import { idempotentRoute } from "@/http/idempotent-route";
import { botConfigJson } from "@/http/serializers-chatbot";
import { isRecord } from "@/modules/shared/domain/input";

export const dynamic = "force-dynamic";

/** Agrega un origen al widget sin reemplazar la lista. Si ya estaba, responde 200 igual. */
export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  const view = await ports.addAllowedOrigin({
    tenantId: actor.tenantId,
    origin: isRecord(body) ? body.origin : undefined,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: botConfigJson(view) };
});
