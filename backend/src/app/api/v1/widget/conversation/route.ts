import { getContainer } from "@/composition-root";
import { widgetPreflight, withWidgetCors } from "@/http/cors";
import { privateRoute } from "@/http/route";
import { conversationHistoryJson } from "@/http/serializers-conversation";
import { resolveWidgetConversation } from "@/http/widget-session-response";

export const dynamic = "force-dynamic";

/** Turno actual e historial redactado; crea la conversacion con la bienvenida si no existe. */
const getConversation = privateRoute(["widget"], async ({ actor, requestId, request }) => {
  const { session, actor: resolved } = await resolveWidgetConversation(actor, request);
  const view = await getContainer().withWriteTransaction((ports) =>
    ports.getConversation({
      tenantId: resolved.tenantId,
      sessionId: session.id,
      actorSubject: resolved.subject,
      actorRole: resolved.role,
      requestId,
    }),
  );
  return conversationHistoryJson(view);
});

export const GET = withWidgetCors(getConversation);
export const OPTIONS = widgetPreflight;
