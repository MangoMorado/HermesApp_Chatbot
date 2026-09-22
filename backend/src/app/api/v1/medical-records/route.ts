import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { medicalRecordJson } from "@/http/serializers";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const record = await getContainer().findMedicalRecord({
    tenantId: actor.tenantId,
    documentTypeRaw: url.searchParams.get("document_type"),
    documentNumberRaw: url.searchParams.get("document_number"),
  });
  return medicalRecordJson(record);
});
