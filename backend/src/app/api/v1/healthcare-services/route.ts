import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { healthcareServiceJson, pageJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const activeRaw = url.searchParams.get("active");
  const page = await getContainer().listHealthcareServices({
    tenantId: actor.tenantId,
    active: activeRaw === null ? undefined : activeRaw === "true",
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, healthcareServiceJson);
});
