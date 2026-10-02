import { getContainer } from "@/composition-root";
import { clientIp } from "@/http/client-ip";
import { widgetPreflight, withWidgetCors } from "@/http/cors";
import { errorResponse, toApiError } from "@/http/errors";
import {
  idempotentJson,
  readIdempotentRequest,
  runIdempotent,
  tenantScope,
} from "@/http/idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/http/request-id";
import { rebuildSessionResponse, sessionTokenJson } from "@/http/widget-session-response";
import {
  ANONYMOUS_WIDGET_SUBJECT,
  MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH,
} from "@/modules/widget/domain/widget-session";

export const dynamic = "force-dynamic";

function widgetKeyOf(body: unknown): unknown {
  return typeof body === "object" && body !== null
    ? (body as { widget_key?: unknown }).widget_key
    : undefined;
}

/** Apertura anonima: la clave publica resuelve el tenant; el cliente nunca lo elige. */
async function openSession(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    const container = getContainer();
    const idempotent = await readIdempotentRequest(
      request,
      ANONYMOUS_WIDGET_SUBJECT,
      MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH,
    );
    const origin = request.headers.get("Origin") ?? "";
    const access = await container.admitWidget({
      widgetKey: widgetKeyOf(idempotent.body),
      origin: origin === "" ? null : origin,
      clientIp: clientIp(request, container.config.trustProxy),
    });
    const result = await runIdempotent({
      request: idempotent,
      outside: tenantScope(container.idempotencyStore, access.tenantId),
      inside: (ports) => tenantScope(ports.idempotencyStore, access.tenantId),
      execute: async (ports) => {
        const session = await ports.startWidgetSession({ access, origin });
        const issued = await container.issueSessionToken(session);
        return {
          status: 201,
          body: sessionTokenJson(session, issued),
          stored: { session_id: session.id },
        };
      },
      rebuild: (stored) => rebuildSessionResponse(stored, access.tenantId),
    });
    return idempotentJson(result, requestId);
  } catch (error) {
    return errorResponse(toApiError(error), requestId);
  }
}

export const POST = withWidgetCors(openSession);
export const OPTIONS = widgetPreflight;
