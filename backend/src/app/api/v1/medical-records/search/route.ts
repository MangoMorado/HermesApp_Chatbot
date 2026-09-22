import { getContainer } from "@/composition-root";
import { privateRoute } from "@/http/route";
import { medicalRecordJson } from "@/http/serializers";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

/**
 * Busqueda por documento. Es POST para que el documento viaje en el cuerpo y no en la
 * URL, que acaba en los logs de acceso del proxy (no divulgacion). No escribe nada, asi
 * que no exige `Idempotency-Key`.
 */
export const POST = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const body = await readJsonObject(request);
  const record = await getContainer().findMedicalRecord({
    tenantId: actor.tenantId,
    documentTypeRaw: typeof body.document_type === "string" ? body.document_type : null,
    documentNumberRaw: typeof body.document_number === "string" ? body.document_number : null,
  });
  return medicalRecordJson(record);
});

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Cuerpo JSON invalido");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  return body as Record<string, unknown>;
}
