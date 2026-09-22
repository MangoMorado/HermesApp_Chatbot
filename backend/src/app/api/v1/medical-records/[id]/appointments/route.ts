import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { historyAppointmentJson, pageJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["operator", "admin"], async ({ actor, request: req }) => {
    const { id } = await context.params;
    const url = new URL(req.url);
    const page = await getContainer().listMedicalRecordAppointments({
      tenantId: actor.tenantId,
      medicalRecordId: id,
      cursor: url.searchParams.get("cursor"),
      limitRaw: url.searchParams.get("limit"),
    });
    return pageJson(page, historyAppointmentJson);
  })(request);
