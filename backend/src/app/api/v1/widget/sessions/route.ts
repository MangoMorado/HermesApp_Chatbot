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
  openedSessionOutcome,
  rebuildOpenedSession,
} from "@/http/widget-session-response";
import {
  ANONYMOUS_WIDGET_SUBJECT,
  MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH,
} from "@/modules/widget/domain/widget-session";

export const dynamic = "force-dynamic";

/**
 * Apertura anonima: la clave publica resuelve el tenant; el cliente nunca lo elige. El token
 * del proveedor se pide antes de la transaccion, asi un fallo del proveedor no deja estado.
 */
async function openSession(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    const container = getContainer();
    const idempotent = await readIdempotentRequest(
      request,
      ANONYMOUS_WIDGET_SUBJECT,
      MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH,
    );
    const access = await admitWidgetRequest(request, idempotent.body);
    const origin = request.headers.get("Origin") ?? "";
    const token = await container.widgetTokenFor(access.tenantId);
    const result = await runIdempotent({
      request: idempotent,
      outside: tenantScope(container.idempotencyStore, access.tenantId),
      inside: (ports) => tenantScope(ports.idempotencyStore, access.tenantId),
      execute: async (ports) =>
        openedSessionOutcome(await ports.startWidgetSession({ access, origin }), token),
      rebuild: (stored) => rebuildOpenedSession(stored, access.tenantId, token),
    });
    return idempotentJson(result, requestId);
  } catch (error) {
    return errorResponse(toApiError(error), requestId);
  }
}

export const POST = withWidgetCors(openSession);
export { widgetPreflight as OPTIONS } from "@/http/cors";
