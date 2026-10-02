import { getContainer } from "@/composition-root";
import { assertSessionOrigin, widgetPreflight, withWidgetCors } from "@/http/cors";
import { privateRoute } from "@/http/route";
import { conversationHistoryJson } from "@/http/serializers-conversation";
import { sessionIdOf } from "@/http/widget-session-response";

export const dynamic = "force-dynamic";

/** Turno actual e historial redactado; crea la conversacion con la bienvenida si no existe. */
const getConversation = privateRoute(["widget"], async ({ actor, requestId, request }) => {
  const container = getContainer();
  const sessionId = sessionIdOf(actor);
  assertSessionOrigin(request, await container.getActiveWidgetSession(actor.tenantId, sessionId));
  const view = await container.withWriteTransaction((ports) =>
    ports.getConversation({
      tenantId: actor.tenantId,
      sessionId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    }),
  );
  return conversationHistoryJson(view);
});

export const GET = withWidgetCors(getConversation);
export const OPTIONS = widgetPreflight;
