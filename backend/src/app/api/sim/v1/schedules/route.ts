import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { pageJson, simScheduleJson } from "@/http/serializers";
import { parseLimit } from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["admin"], async ({ actor, request }) => {
  requireSimulatorEnabled();
  const url = new URL(request.url);
  const page = await getContainer().listSimSchedules({
    tenantId: actor.tenantId,
    cursor: url.searchParams.get("cursor"),
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return pageJson(page, simScheduleJson);
});

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  requireSimulatorEnabled();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  const data = body as Record<string, unknown>;
  const practitionerId = data.practitioner_id;
  const healthcareServiceId = data.healthcare_service_id;
  const identifierValue = data.identifier_value;
  if (typeof practitionerId !== "string" || !practitionerId) {
    throw new ValidationError("practitioner_id es obligatorio", { field: "practitioner_id" });
  }
  if (typeof healthcareServiceId !== "string" || !healthcareServiceId) {
    throw new ValidationError("healthcare_service_id es obligatorio", {
      field: "healthcare_service_id",
    });
  }
  if (typeof identifierValue !== "string" || !identifierValue.trim()) {
    throw new ValidationError("identifier_value es obligatorio", { field: "identifier_value" });
  }
  const created = await ports.simSchedules.create({
    id: ports.ids.next(),
    tenantId: actor.tenantId,
    identifierSystem: "urn:hermes:schedule",
    identifierValue: identifierValue.trim(),
    practitionerId,
    healthcareServiceId,
    active: data.active !== false,
  });
  await ports.auditLog.record({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    action: "sim.schedule.created",
    resourceType: "sim.schedule",
    resourceId: created.id,
    requestId,
    occurredAt: ports.clock.now(),
  });
  return { status: 200, body: simScheduleJson(created) };
});
