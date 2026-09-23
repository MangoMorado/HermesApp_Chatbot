import { getContainer } from "@/composition-root";
import { platformIdempotentRoute, platformRoute } from "@/http/platform-route";
import { pageJson } from "@/http/serializers";
import { tenantJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const GET = platformRoute(async ({ request }) => {
  const url = new URL(request.url);
  const page = await getContainer().listTenants({
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, tenantJson);
});

export const POST = platformIdempotentRoute(async ({ requestId, body, ports }) => {
  const { tenant, widgetKey } = await ports.registerTenant({ raw: body, requestId });
  return { status: 201, body: { tenant: tenantJson(tenant), widget_key: widgetKey } };
});
