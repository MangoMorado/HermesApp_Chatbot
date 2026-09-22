import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { appointmentJson, pageJson } from "@/http/serializers";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const scheduleId = url.searchParams.get("schedule_id");
  if (!scheduleId) {
    throw new ValidationError("schedule_id es obligatorio", { field: "schedule_id" });
  }
  const page = await getContainer().listAppointments({
    tenantId: actor.tenantId,
    scheduleId,
    fromRaw: url.searchParams.get("from"),
    toRaw: url.searchParams.get("to"),
    timeZone: getContainer().config.appTimezone,
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, appointmentJson);
});
