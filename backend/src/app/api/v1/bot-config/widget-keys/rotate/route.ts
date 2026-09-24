import { idempotentRoute } from "@/http/idempotent-route";
import { botConfigJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
  const view = await ports.rotateWidgetKey({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: botConfigJson(view) };
});
