import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { simScheduleJson } from "@/http/serializers";
import { assertSimDelete, booleanOr, recordSimAudit, requireObjectBody } from "@/http/sim-mutation";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";

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
    const data = requireObjectBody(body);
    const updated = await ports.simSchedules.update({
      ...existing,
      active: booleanOr(data.active, existing.active),
    });
    if (!updated) {
      throw new NotFoundError();
    }
    await recordSimAudit(ports, actor, requestId, "sim.schedule.updated", "sim.schedule", id);
    return { status: 200, body: simScheduleJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    assertSimDelete(
      await ports.simSchedules.delete(actor.tenantId, id),
      "La agenda tiene cupos o citas asociadas",
    );
    await recordSimAudit(ports, actor, requestId, "sim.schedule.deleted", "sim.schedule", id);
    return { status: 200, body: { deleted: true } };
  })(request);
