import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { inboxRequestJson } from "@/http/serializers-sim-inbox";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const resolved = await ports.rejectInboxRequest({
      tenantId: actor.tenantId,
      requestId: id,
      actor: { actorSubject: actor.subject, actorRole: actor.role, requestId },
    });
    return { status: 200, body: inboxRequestJson(resolved) };
  })(request);
