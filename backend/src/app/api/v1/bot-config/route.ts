import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { botConfigJson } from "@/http/serializers-chatbot";
import { parseBotConfigPatch } from "@/modules/bot-config/domain/bot-config";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor }) =>
  botConfigJson(await getContainer().getBotConfig(actor.tenantId)),
);

export const PATCH = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  const view = await ports.updateBotConfig({
    tenantId: actor.tenantId,
    patch: parseBotConfigPatch(body),
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: botConfigJson(view) };
});
