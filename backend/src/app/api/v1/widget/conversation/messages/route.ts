import { getContainer } from "@/composition-root";
import { assertSessionOrigin, widgetPreflight, withWidgetCors } from "@/http/cors";
import { idempotentRoute } from "@/http/idempotent-route";
import { conversationTurnJson, replayTurn, storedTurnJson } from "@/http/serializers-conversation";
import { sessionIdOf } from "@/http/widget-session-response";
import { parseIncomingMessage } from "@/modules/conversation/domain/message-input";

export const dynamic = "force-dynamic";

/** Un turno del chat. La conversacion sale de la sesion del token, nunca del cuerpo. */
const postMessage = idempotentRoute(
  ["widget"],
  async ({ actor, requestId, body, ports }) => {
    const sessionId = sessionIdOf(actor);
    const turn = await ports.handleConversationMessage({
      tenantId: actor.tenantId,
      sessionId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
      message: parseIncomingMessage(body),
    });
    return {
      status: 200,
      body: conversationTurnJson(turn),
      stored: storedTurnJson(turn, sessionId),
    };
  },
  {
    sensitiveBody: true,
    guard: async ({ actor, request }) =>
      assertSessionOrigin(
        request,
        await getContainer().getActiveWidgetSession(actor.tenantId, sessionIdOf(actor)),
      ),
    rebuild: (stored, actor) => Promise.resolve(replayTurn(stored, sessionIdOf(actor))),
  },
);

export const POST = withWidgetCors(postMessage);
export const OPTIONS = widgetPreflight;
