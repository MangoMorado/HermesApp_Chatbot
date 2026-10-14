import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import {
  type AppointmentRequest,
  type AppointmentRequestKind,
  isLive,
  preAgendaConflict,
  type Resolution,
} from "../domain/appointment-request";
import type { PreAgendaStore, RequestExpirer } from "../domain/ports/pre-agenda";
import type { ResolveAppointmentRequest } from "./resolve-appointment-request";

type KindGroup = "agenda" | "cancel";

export type ResolveFromFhirInput = {
  readonly tenantId: TenantId;
  readonly requestId: string;
  readonly actor: AuditActor;
  readonly kind: KindGroup;
  readonly resolution: Resolution;
};

type Deps = {
  readonly store: PreAgendaStore;
  readonly expirer: RequestExpirer;
  readonly resolve: ResolveAppointmentRequest;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

function kindMatches(kind: AppointmentRequestKind, group: KindGroup): boolean {
  return group === "cancel" ? kind === "cancel" : kind !== "cancel";
}

async function resolutionFor(
  store: PreAgendaStore,
  tenantId: TenantId,
  request: AppointmentRequest,
  resolution: Resolution,
): Promise<Resolution> {
  if (request.kind !== "cancel" || resolution.outcome !== "approved") {
    return resolution;
  }
  if (!request.appointmentId) {
    throw new NotFoundError();
  }
  const appointment = await store.getAppointment(tenantId, request.appointmentId);
  if (!appointment) {
    throw new NotFoundError();
  }
  return { outcome: "approved", appointmentIdentifier: appointment.identifier };
}

/**
 * Resuelve una pre-agenda leída por FHIR. La cita en firme de un book o reschedule
 * conserva el id de la solicitud; en una cancelación el identificador de Hermes no se usa.
 */
export function createResolveFromFhir(deps: Deps) {
  return async (input: ResolveFromFhirInput): Promise<void> => {
    const now = deps.clock.now();
    await deps.expirer.expireDue(input.tenantId, now);
    const request = await deps.store.getRequestForUpdate(input.tenantId, input.requestId);
    if (!request || !kindMatches(request.kind, input.kind)) {
      throw new NotFoundError();
    }
    if (!isLive(request, now)) {
      throw preAgendaConflict("request_not_pending", "La solicitud ya no esta pendiente");
    }
    await deps.resolve({
      tenantId: input.tenantId,
      requestId: input.requestId,
      actor: input.actor,
      resolution: await resolutionFor(deps.store, input.tenantId, request, input.resolution),
    });
    await deps.audit.record({
      tenantId: input.tenantId,
      ...input.actor,
      action: input.kind === "cancel" ? "task.written_by_hermes" : "appointment.written_by_hermes",
      resourceType: input.kind === "cancel" ? "task" : "appointment",
      resourceId: request.id,
      occurredAt: now,
    });
  };
}
