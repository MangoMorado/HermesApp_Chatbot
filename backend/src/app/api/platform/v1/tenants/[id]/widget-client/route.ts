import { platformIdempotentRoute } from "@/http/platform-route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Registra o rota las credenciales del cliente OIDC del widget de la clinica. */
export const PUT = (request: Request, context: RouteContext): Promise<Response> =>
  platformIdempotentRoute(async ({ actor, requestId, body, ports }) => {
    const { id } = await context.params;
    const result = await ports.setWidgetClient({ tenantId: id, raw: body, actor, requestId });
    return {
      status: 200,
      body: { client_id: result.clientId, updated_at: result.updatedAt.toISOString() },
    };
  })(request);
