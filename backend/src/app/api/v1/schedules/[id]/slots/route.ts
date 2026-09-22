import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { pageJson, slotJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["operator", "admin"], async ({ actor, request: req }) => {
    const { id } = await context.params;
    const url = new URL(req.url);
    const page = await getContainer().listScheduleSlots({
      tenantId: actor.tenantId,
      scheduleId: id,
      fromRaw: url.searchParams.get("from"),
      toRaw: url.searchParams.get("to"),
      timeZone: getContainer().config.appTimezone,
      cursor: url.searchParams.get("cursor"),
      limitRaw: url.searchParams.get("limit"),
    });
    return pageJson(page, slotJson);
  })(request);
