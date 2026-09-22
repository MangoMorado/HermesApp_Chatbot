import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { simScheduleJson } from "@/http/serializers";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["admin"], async ({ actor }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const row = await getContainer().getSimSchedule(actor.tenantId, id);
    if (!row) {
      throw new NotFoundError();
    }
    return simScheduleJson(row);
  })(request);

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const existing = await ports.simSchedules.get(actor.tenantId, id);
    if (!existing) {
      throw new NotFoundError();
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("Cuerpo invalido");
    }
    const data = body as Record<string, unknown>;
    const updated = await ports.simSchedules.update({
      ...existing,
      active: typeof data.active === "boolean" ? data.active : existing.active,
    });
    if (!updated) {
      throw new NotFoundError();
    }
    await ports.auditLog.record({
      tenantId: actor.tenantId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      action: "sim.schedule.updated",
      resourceType: "sim.schedule",
      resourceId: id,
      requestId,
      occurredAt: ports.clock.now(),
    });
    return { status: 200, body: simScheduleJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const result = await ports.simSchedules.delete(actor.tenantId, id);
    if (result === "missing") {
      throw new NotFoundError();
    }
    if (result === "has_dependents") {
      throw new ConflictError("La agenda tiene cupos o citas asociadas");
    }
    await ports.auditLog.record({
      tenantId: actor.tenantId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      action: "sim.schedule.deleted",
      resourceType: "sim.schedule",
      resourceId: id,
      requestId,
      occurredAt: ports.clock.now(),
    });
    return { status: 200, body: { deleted: true } };
  })(request);
