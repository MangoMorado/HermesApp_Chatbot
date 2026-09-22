import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { pageJson, simPractitionerJson } from "@/http/serializers";
import { parseLimit } from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["admin"], async ({ actor, request }) => {
  requireSimulatorEnabled();
  const url = new URL(request.url);
  const page = await getContainer().listSimPractitioners({
    tenantId: actor.tenantId,
    cursor: url.searchParams.get("cursor"),
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return pageJson(page, simPractitionerJson);
});

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  requireSimulatorEnabled();
  const data = asObject(body);
  const created = await ports.simPractitioners.create({
    id: ports.ids.next(),
    tenantId: actor.tenantId,
    identifierSystem: "urn:hermes:practitioner",
    identifierValue: requiredString(data, "identifier_value"),
    name: requiredString(data, "name"),
    active: data.active !== false,
  });
  await ports.auditLog.record({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    action: "sim.practitioner.created",
    resourceType: "sim.practitioner",
    resourceId: created.id,
    requestId,
    occurredAt: ports.clock.now(),
  });
  return { status: 200, body: simPractitionerJson(created) };
});

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  return body as Record<string, unknown>;
}

function requiredString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} es obligatorio`, { field });
  }
  return value.trim();
}
