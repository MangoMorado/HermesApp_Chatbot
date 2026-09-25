import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { InboxIdentifier, InboxRequest, InboxResolution } from "../domain/inbox";
import type { ChatbotRequestsGateway, SimInboxStore } from "../domain/ports/inbox";

export const SIM_APPOINTMENT_SYSTEM = "urn:hermes:appointment";

export type InboxCommand = {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actor: AuditActor;
};

type ApproveDeps = {
  readonly gateway: ChatbotRequestsGateway;
  readonly store: SimInboxStore;
  readonly ids: IdGenerator;
};

export function createListInbox(deps: { readonly gateway: ChatbotRequestsGateway }) {
  return (filter: { tenantId: string; cursor: string | null; limit: number }) =>
    deps.gateway.listPending(filter);
}

async function cancelInHermes(store: SimInboxStore, tenantId: string, identifier: InboxIdentifier) {
  const appointment = await store.findAppointment(tenantId, identifier);
  if (!appointment) {
    throw new ConflictError("Hermes no conoce la cita", { reason: "appointment_not_in_hermes" });
  }
  await store.cancelAppointment(tenantId, appointment.id);
  await store.setSlotStatus(tenantId, appointment.slotId, "free");
}

/** Hermes reserva si su cupo sigue libre; si no, decide rechazar por `slot_unavailable`. */
async function bookInHermes(
  deps: ApproveDeps,
  tenantId: string,
  request: InboxRequest,
  patientId: string,
): Promise<InboxResolution> {
  const slot = request.slot ? await deps.store.lockSlot(tenantId, request.slot.identifier) : null;
  if (slot?.status !== "free") {
    return { outcome: "rejected", reason: "slot_unavailable" };
  }
  if (request.appointment) {
    await cancelInHermes(deps.store, tenantId, request.appointment.identifier);
  }
  await deps.store.setSlotStatus(tenantId, slot.id, "busy");
  const identifier = { system: SIM_APPOINTMENT_SYSTEM, value: `AP-${deps.ids.next()}` };
  await deps.store.createAppointment({
    id: deps.ids.next(),
    tenantId,
    identifier,
    patientId,
    scheduleId: slot.scheduleId,
    slotId: slot.id,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
  return { outcome: "approved", appointmentIdentifier: identifier };
}

async function decide(
  deps: ApproveDeps,
  tenantId: string,
  request: InboxRequest,
  patientId: string,
) {
  if (request.kind !== "cancel") {
    return bookInHermes(deps, tenantId, request, patientId);
  }
  if (!request.appointment) {
    throw new ConflictError("Hermes no conoce la cita", { reason: "appointment_not_in_hermes" });
  }
  await cancelInHermes(deps.store, tenantId, request.appointment.identifier);
  const approved: InboxResolution = {
    outcome: "approved",
    appointmentIdentifier: request.appointment.identifier,
  };
  return approved;
}

/**
 * Primero escribe Hermes (fuente de verdad) y despues resuelve en el chatbot. En la 3.2 ambos
 * comparten transaccion: si el chatbot rechaza, la reversion deshace lo escrito en hermes_sim.
 */
export function createApproveInboxRequest(deps: ApproveDeps) {
  return async (command: InboxCommand): Promise<InboxRequest> => {
    const request = await deps.gateway.get(command.tenantId, command.requestId);
    if (request.status !== "pending") {
      throw new ConflictError("La solicitud ya no esta pendiente", {
        reason: "request_not_pending",
        status: request.status,
      });
    }
    const patientId = await deps.store.findPatientId(command.tenantId, request.patient.identifier);
    if (!patientId) {
      throw new ConflictError("Hermes no conoce al paciente", { reason: "patient_not_in_hermes" });
    }
    const resolution = await decide(deps, command.tenantId, request, patientId);
    return deps.gateway.resolve({ ...command, resolution });
  };
}

export function createRejectInboxRequest(deps: { readonly gateway: ChatbotRequestsGateway }) {
  return (command: InboxCommand): Promise<InboxRequest> =>
    deps.gateway.resolve({ ...command, resolution: { outcome: "rejected", reason: "declined" } });
}
