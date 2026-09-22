import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { pageJson, scheduleJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const activeRaw = url.searchParams.get("active");
  const page = await getContainer().listSchedules({
    tenantId: actor.tenantId,
    practitionerId: url.searchParams.get("practitioner_id") ?? undefined,
    healthcareServiceId: url.searchParams.get("healthcare_service_id") ?? undefined,
    active: activeRaw === null ? undefined : activeRaw === "true",
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, scheduleJson);
});
