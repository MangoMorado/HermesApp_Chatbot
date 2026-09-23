import { getContainer } from "@/composition-root";
import { platformRoute } from "@/http/platform-route";
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
