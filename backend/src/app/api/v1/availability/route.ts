import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { pageJson, slotJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const page = await getContainer().listAvailability({
    tenantId: actor.tenantId,
    fromRaw: url.searchParams.get("from"),
    toRaw: url.searchParams.get("to"),
    timeZone: getContainer().config.appTimezone,
    healthcareServiceId: url.searchParams.get("healthcare_service_id") ?? undefined,
    practitionerId: url.searchParams.get("practitioner_id") ?? undefined,
    scheduleId: url.searchParams.get("schedule_id") ?? undefined,
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, slotJson);
});
