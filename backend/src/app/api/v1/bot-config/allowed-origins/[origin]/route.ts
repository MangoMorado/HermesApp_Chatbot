import { idempotentRoute } from "@/http/idempotent-route";
import { botConfigJson } from "@/http/serializers-chatbot";
import { decodeOriginParam } from "@/modules/bot-config/domain/allowed-origins";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ origin: string }> };

/** El origen va codificado en la ruta (`https%3A%2F%2Fclinica.test`). */
export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    const { origin } = await context.params;
    const view = await ports.removeAllowedOrigin({
      tenantId: actor.tenantId,
      origin: decodeOriginParam(origin),
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: botConfigJson(view) };
  })(request);
