import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { pageJson, simServiceJson } from "@/http/serializers";
import { parseLimit } from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["admin"], async ({ actor, request }) => {
  requireSimulatorEnabled();
  const url = new URL(request.url);
  const page = await getContainer().listSimServices({
    tenantId: actor.tenantId,
    cursor: url.searchParams.get("cursor"),
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return pageJson(page, simServiceJson);
});

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  requireSimulatorEnabled();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  const data = body as Record<string, unknown>;
  const name = data.name;
  const identifierValue = data.identifier_value;
  if (typeof name !== "string" || !name.trim()) {
    throw new ValidationError("name es obligatorio", { field: "name" });
  }
  if (typeof identifierValue !== "string" || !identifierValue.trim()) {
    throw new ValidationError("identifier_value es obligatorio", { field: "identifier_value" });
  }
  const created = await ports.simServices.create({
    id: ports.ids.next(),
    tenantId: actor.tenantId,
    identifierSystem: "urn:hermes:healthcare-service",
    identifierValue: identifierValue.trim(),
    name: name.trim(),
    active: data.active !== false,
  });
  await ports.auditLog.record({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    action: "sim.healthcare_service.created",
    resourceType: "sim.healthcare_service",
    resourceId: created.id,
    requestId,
    occurredAt: ports.clock.now(),
  });
  return { status: 200, body: simServiceJson(created) };
});
