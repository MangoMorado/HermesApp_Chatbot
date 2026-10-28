import { getContainer } from "@/composition-root";
import { platformIdempotentRoute, platformRoute } from "@/http/platform-route";
import { pageJson } from "@/http/serializers";
import { tenantJson, widgetClientJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const GET = platformRoute(async ({ request }) => {
  const url = new URL(request.url);
  const page = await getContainer().listTenants({
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, tenantJson);
});

export const POST = platformIdempotentRoute(async ({ actor, requestId, body, ports }) => {
  const { tenant, widgetKey, widgetClientId } = await ports.registerTenant({
    raw: body,
    actor,
    requestId,
  });
  return {
    status: 201,
    body: {
      tenant: tenantJson(tenant),
      widget_key: widgetKey,
      widget_client: widgetClientJson(widgetClientId),
    },
  };
});
