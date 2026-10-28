import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { simPatientJson } from "@/http/serializers";
import { assertSimDelete, recordSimAudit, requireObjectBody, stringOr } from "@/http/sim-mutation";
import type { SimPatient } from "@/modules/hermes-simulator/domain/entities";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function mergePatientPatch(existing: SimPatient, data: Record<string, unknown>): SimPatient {
  const status =
    data.status === "pre_registered" || data.status === "active" ? data.status : existing.status;
  return {
    ...existing,
    givenNames: stringOr(data.given_names, existing.givenNames),
    familyNames: stringOr(data.family_names, existing.familyNames),
    phone: stringOr(data.phone, existing.phone),
    email: stringOr(data.email, existing.email),
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
    const updated = await ports.simPatients.update(
      mergePatientPatch(existing, requireObjectBody(body)),
    );
    if (!updated) {
      throw new NotFoundError();
    }
    await recordSimAudit(ports, actor, requestId, "sim.patient.updated", "sim.patient", id);
    return { status: 200, body: simPatientJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    assertSimDelete(
      await ports.simPatients.delete(actor.tenantId, id),
      "El paciente tiene citas asociadas",
    );
    await recordSimAudit(ports, actor, requestId, "sim.patient.deleted", "sim.patient", id);
    return { status: 200, body: { deleted: true } };
  })(request);
