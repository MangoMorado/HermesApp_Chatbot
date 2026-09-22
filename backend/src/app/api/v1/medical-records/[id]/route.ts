import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { medicalRecordJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["operator", "admin"], async ({ actor }) => {
    const { id } = await context.params;
    const record = await getContainer().getMedicalRecord(actor.tenantId, id);
    return medicalRecordJson(record);
  })(request);
