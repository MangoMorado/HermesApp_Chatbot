import { getContainer } from "@/composition-root";
import { withWidgetCors } from "@/http/cors";
import { errorResponse, toApiError } from "@/http/errors";
import {
  idempotentJson,
  readIdempotentRequest,
  runIdempotent,
  tenantScope,
} from "@/http/idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/http/request-id";
import {
  admitWidgetRequest,
  assertSessionOrigin,
  conversationSecretOf,
  rebuildRefreshedSession,
  refreshedSessionOutcome,
} from "@/http/widget-session-response";
import { ANONYMOUS_WIDGET_SUBJECT, sessionSubject } from "@/modules/widget/domain/widget-session";

export const dynamic = "force-dynamic";

/**
 * Renovacion publica (sin bearer): la autentican la clave del widget, el Origin de la sesion
 * y `X-Conversation-Secret`, con el mismo rate limit que la apertura. Devuelve un token nuevo
 * del proveedor y extiende la conversacion segun el TTL del tenant.
 */
async function refreshSession(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    const container = getContainer();
    const idempotent = await readIdempotentRequest(request, ANONYMOUS_WIDGET_SUBJECT);
    const { tenantId } = await admitWidgetRequest(request, idempotent.body);
    const secret = conversationSecretOf(request);
    const session = await container.findWidgetSessionBySecret(tenantId, secret);
    assertSessionOrigin(request, session);
    const token = await container.widgetTokenFor(tenantId);
    const result = await runIdempotent({
      request: { ...idempotent, actorSubject: sessionSubject(session.id) },
      outside: tenantScope(container.idempotencyStore, tenantId),
      inside: (ports) => tenantScope(ports.idempotencyStore, tenantId),
      execute: async (ports) =>
        refreshedSessionOutcome(
          await ports.refreshWidgetSession({ tenantId, sessionId: session.id }),
          token,
        ),
      rebuild: (stored) => rebuildRefreshedSession(stored, tenantId, session.id, token),
    });
    return idempotentJson(result, requestId);
  } catch (error) {
    return errorResponse(toApiError(error), requestId);
  }
}

export const POST = withWidgetCors(refreshSession);
export { widgetPreflight as OPTIONS } from "@/http/cors";
