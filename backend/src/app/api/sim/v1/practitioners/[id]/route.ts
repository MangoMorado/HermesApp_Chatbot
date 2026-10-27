import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { simPractitionerJson } from "@/http/serializers";
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
    const row = await getContainer().getSimPractitioner(actor.tenantId, id);
    if (!row) {
      throw new NotFoundError();
    }
    return simPractitionerJson(row);
  })(request);

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const existing = await ports.simPractitioners.get(actor.tenantId, id);
    if (!existing) {
      throw new NotFoundError();
    }
    const data = requireObjectBody(body);
    const updated = await ports.simPractitioners.update({
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
      "sim.practitioner.updated",
      "sim.practitioner",
      id,
    );
    return { status: 200, body: simPractitionerJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    assertSimDelete(
      await ports.simPractitioners.delete(actor.tenantId, id),
      "El profesional tiene agendas asociadas",
    );
    await recordSimAudit(
      ports,
      actor,
      requestId,
      "sim.practitioner.deleted",
      "sim.practitioner",
      id,
    );
    return { status: 200, body: { deleted: true } };
  })(request);
