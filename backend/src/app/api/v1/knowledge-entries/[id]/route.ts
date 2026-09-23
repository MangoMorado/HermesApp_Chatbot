import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { knowledgeEntryJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["operator", "admin"], async ({ actor }) => {
    const { id } = await context.params;
    return knowledgeEntryJson(await getContainer().getKnowledgeEntry(actor.tenantId, id));
  })(request);

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    const { id } = await context.params;
    const updated = await ports.updateKnowledgeEntry({
      tenantId: actor.tenantId,
      id,
      raw: body,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: knowledgeEntryJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    const { id } = await context.params;
    await ports.deleteKnowledgeEntry({
      tenantId: actor.tenantId,
      id,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: { deleted: true } };
  })(request);
