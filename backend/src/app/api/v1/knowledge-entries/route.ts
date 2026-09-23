import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { pageJson } from "@/http/serializers";
import { knowledgeEntryJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const activeRaw = url.searchParams.get("active");
  const category = url.searchParams.get("category");
  const page = await getContainer().listKnowledgeEntries({
    tenantId: actor.tenantId,
    ...(category === null ? {} : { category }),
    ...(activeRaw === null ? {} : { active: activeRaw === "true" }),
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, knowledgeEntryJson);
});

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  const created = await ports.createKnowledgeEntry({
    tenantId: actor.tenantId,
    raw: body,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 201, body: knowledgeEntryJson(created) };
});
