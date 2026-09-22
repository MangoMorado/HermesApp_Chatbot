import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { pageJson, simPatientJson } from "@/http/serializers";
import { parseLimit } from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

const DOC_TYPES = new Set(["CC", "TI", "CE", "PA", "RC"]);

export const GET = privateRoute(["admin"], async ({ actor, request }) => {
  requireSimulatorEnabled();
  const url = new URL(request.url);
  const page = await getContainer().listSimPatients({
    tenantId: actor.tenantId,
    cursor: url.searchParams.get("cursor"),
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return pageJson(page, simPatientJson);
});

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  requireSimulatorEnabled();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  const data = body as Record<string, unknown>;
  const documentType = String(data.document_type ?? "");
  if (!DOC_TYPES.has(documentType)) {
    throw new ValidationError("document_type invalido", { field: "document_type" });
  }
  const created = await ports.simPatients.create({
    id: ports.ids.next(),
    tenantId: actor.tenantId,
    identifierSystem: "urn:hermes:patient",
    identifierValue: required(data, "identifier_value"),
    documentType: documentType as "CC" | "TI" | "CE" | "PA" | "RC",
    documentNumber: required(data, "document_number"),
    givenNames: required(data, "given_names"),
    familyNames: required(data, "family_names"),
    birthDate: required(data, "birth_date"),
    phone: typeof data.phone === "string" ? data.phone : null,
    email: typeof data.email === "string" ? data.email : null,
    status: data.status === "pre_registered" ? "pre_registered" : "active",
  });
  await ports.auditLog.record({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    action: "sim.patient.created",
    resourceType: "sim.patient",
    resourceId: created.id,
    requestId,
    occurredAt: ports.clock.now(),
  });
  return { status: 200, body: simPatientJson(created) };
});

function required(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} es obligatorio`, { field });
  }
  return value.trim();
}
