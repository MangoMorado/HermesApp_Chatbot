import { withWidgetCors } from "@/http/cors";
import { idempotentRoute } from "@/http/idempotent-route";
import { conversationTurnJson, replayTurn, storedTurnJson } from "@/http/serializers-conversation";
import { conversationSessionId, resolveWidgetConversation } from "@/http/widget-session-response";
import { parseIncomingMessage } from "@/modules/conversation/domain/message-input";

export const dynamic = "force-dynamic";

/**
 * Un turno del chat. La conversacion sale de `X-Conversation-Secret` dentro del tenant del
 * token, nunca del cuerpo; el actor resuelto lleva `widget:<sessionId>`.
 */
const postMessage = idempotentRoute(
  ["widget"],
  async ({ actor, requestId, body, ports }) => {
    const sessionId = conversationSessionId(actor);
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
    resolveActor: async (actor, request) => (await resolveWidgetConversation(actor, request)).actor,
    rebuild: (stored, actor) => Promise.resolve(replayTurn(stored, conversationSessionId(actor))),
  },
);

export const POST = withWidgetCors(postMessage);
export { widgetPreflight as OPTIONS } from "@/http/cors";
