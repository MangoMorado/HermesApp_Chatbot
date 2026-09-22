import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { simPatientJson } from "@/http/serializers";
import type { SimPatient } from "@/modules/hermes-simulator/domain/entities";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  return body as Record<string, unknown>;
}

function mergePatientPatch(existing: SimPatient, data: Record<string, unknown>): SimPatient {
  const status =
    data.status === "pre_registered" || data.status === "active" ? data.status : existing.status;
  return {
    ...existing,
    givenNames: typeof data.given_names === "string" ? data.given_names : existing.givenNames,
    familyNames: typeof data.family_names === "string" ? data.family_names : existing.familyNames,
    phone: typeof data.phone === "string" ? data.phone : existing.phone,
    email: typeof data.email === "string" ? data.email : existing.email,
    status,
  };
}

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["admin"], async ({ actor }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const row = await getContainer().getSimPatient(actor.tenantId, id);
    if (!row) {
      throw new NotFoundError();
    }
    return simPatientJson(row);
  })(request);

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const existing = await ports.simPatients.get(actor.tenantId, id);
    if (!existing) {
      throw new NotFoundError();
    }
    const updated = await ports.simPatients.update(mergePatientPatch(existing, asObject(body)));
    if (!updated) {
      throw new NotFoundError();
    }
    await ports.auditLog.record({
      tenantId: actor.tenantId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      action: "sim.patient.updated",
      resourceType: "sim.patient",
      resourceId: id,
      requestId,
      occurredAt: ports.clock.now(),
    });
    return { status: 200, body: simPatientJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const result = await ports.simPatients.delete(actor.tenantId, id);
    if (result === "missing") {
      throw new NotFoundError();
    }
    if (result === "has_dependents") {
      throw new ConflictError("El paciente tiene citas asociadas");
    }
    await ports.auditLog.record({
      tenantId: actor.tenantId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      action: "sim.patient.deleted",
      resourceType: "sim.patient",
      resourceId: id,
      requestId,
      occurredAt: ports.clock.now(),
    });
    return { status: 200, body: { deleted: true } };
  })(request);
