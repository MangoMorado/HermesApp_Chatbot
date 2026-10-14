import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import {
  type AppointmentRequest,
  isLive,
  preAgendaConflict,
  type Resolution,
  type ResolutionEffects,
  resolutionEffects,
} from "../domain/appointment-request";
import type { HermesIdentifier } from "../domain/entities";
import type { PreAgendaStore } from "../domain/ports/pre-agenda";

export type ResolveAppointmentRequestInput = {
  readonly tenantId: TenantId;
  readonly requestId: string;
  readonly resolution: Resolution;
  readonly actor: AuditActor;
};

export type ResolveAppointmentRequestDeps = {
  readonly store: PreAgendaStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

export type ResolveAppointmentRequest = (
  input: ResolveAppointmentRequestInput,
) => Promise<AppointmentRequest>;

async function applyEffects(store: PreAgendaStore, tenantId: TenantId, effects: ResolutionEffects) {
  for (const change of effects.slots) {
    await store.setSlotStatus(tenantId, change.slotId, change.status);
  }
  for (const change of effects.appointments) {
    await store.setAppointmentStatus(tenantId, change.appointmentId, change.status);
  }
}

async function bookAppointment(
  deps: ResolveAppointmentRequestDeps,
  request: AppointmentRequest,
  tenantId: TenantId,
  slotId: string,
  identifier: HermesIdentifier,
): Promise<string> {
  const slot = await deps.store.getSlot(tenantId, slotId);
  if (!slot) {
    throw new NotFoundError();
  }
  const id = request.id;
  await deps.store.insertAppointment({
    id,
    tenantId,
    identifier,
    medicalRecordId: request.medicalRecordId,
    scheduleId: slot.scheduleId,
    slotId,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
  return id;
}

/** Bloque compartido entre `book`, `reschedule` y `cancel`: aplica efectos y crea la cita si aprueba. */
async function applyResolution(
  deps: ResolveAppointmentRequestDeps,
  input: ResolveAppointmentRequestInput,
  request: AppointmentRequest,
): Promise<string | null> {
  const { resolution } = input;
  const target = request.appointmentId
    ? await deps.store.getAppointment(input.tenantId, request.appointmentId)
    : null;
  const approved = resolution.outcome === "approved";
  const effects = resolutionEffects(
    request,
    target?.slotId ?? null,
    approved ? "approved" : "released",
  );
  await applyEffects(deps.store, input.tenantId, effects);
  return resolution.outcome === "approved" && effects.bookedSlotId
    ? bookAppointment(
        deps,
        request,
        input.tenantId,
        effects.bookedSlotId,
        resolution.appointmentIdentifier,
      )
    : null;
}

/**
 * Hermes resuelve la solicitud. Hoy lo invoca la bandeja del simulador; en la Fase 4,
 * el `PUT` FHIR. Vencida o ya resuelta -> `request_not_pending`.
 */
export function createResolveAppointmentRequest(
  deps: ResolveAppointmentRequestDeps,
): ResolveAppointmentRequest {
  return async (input) => {
    const now = deps.clock.now();
    const request = await deps.store.getRequestForUpdate(input.tenantId, input.requestId);
    if (!request) {
      throw new NotFoundError();
    }
    if (!isLive(request, now)) {
      const status = request.status === "pending" ? "expired" : request.status;
      throw preAgendaConflict("request_not_pending", "La solicitud ya no esta pendiente", {
        status,
      });
    }
    const resultingAppointmentId = await applyResolution(deps, input, request);
    const resolved = await deps.store.markResolved(input.tenantId, request.id, {
      status: input.resolution.outcome === "approved" ? "approved" : "rejected",
      resolutionReason: input.resolution.outcome === "rejected" ? input.resolution.reason : null,
      resultingAppointmentId,
      resolvedAt: now,
    });
    await deps.audit.record({
      tenantId: input.tenantId,
      ...input.actor,
      action: `appointment_request.${resolved.status}`,
      resourceType: "appointment_request",
      resourceId: request.id,
      occurredAt: now,
    });
    return resolved;
  };
}
