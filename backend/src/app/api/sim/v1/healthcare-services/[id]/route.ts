import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { simServiceJson } from "@/http/serializers";
import {
  assertSimDelete,
  booleanOr,
  recordSimAudit,
  requireObjectBody,
  stringOr,
} from "@/http/sim-mutation";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["admin"], async ({ actor }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const row = await getContainer().getSimService(actor.tenantId, id);
    if (!row) {
      throw new NotFoundError();
    }
    return simServiceJson(row);
  })(request);

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const existing = await ports.simServices.get(actor.tenantId, id);
    if (!existing) {
      throw new NotFoundError();
    }
    const data = requireObjectBody(body);
    const updated = await ports.simServices.update({
      ...existing,
      name: stringOr(data.name, existing.name),
      active: booleanOr(data.active, existing.active),
    });
    if (!updated) {
      throw new NotFoundError();
    }
    await recordSimAudit(
      ports,
      actor,
      requestId,
      "sim.healthcare_service.updated",
      "sim.healthcare_service",
      id,
    );
    return { status: 200, body: simServiceJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    assertSimDelete(
      await ports.simServices.delete(actor.tenantId, id),
      "El servicio tiene agendas asociadas",
    );
    await recordSimAudit(
      ports,
      actor,
      requestId,
      "sim.healthcare_service.deleted",
      "sim.healthcare_service",
      id,
    );
    return { status: 200, body: { deleted: true } };
  })(request);
