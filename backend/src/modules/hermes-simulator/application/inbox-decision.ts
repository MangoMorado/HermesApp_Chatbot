import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import { SIM_APPOINTMENT_SYSTEM } from "../domain/fhir-contract";
import type { InboxIdentifier, InboxRequest, InboxResolution } from "../domain/inbox";
import type { SimInboxStore, SimSlotStatus } from "../domain/ports/inbox";

type SlotRestore = { readonly id: string; readonly status: SimSlotStatus };
type AppointmentRestore = { readonly id: string; readonly status: "booked" };

export type HermesWrite = {
  readonly resolution: InboxResolution;
  readonly restoreSlots: readonly SlotRestore[];
  readonly restoreAppointments: readonly AppointmentRestore[];
  readonly deleteAppointmentId: string | null;
};

function none(resolution: InboxResolution): HermesWrite {
  return { resolution, restoreSlots: [], restoreAppointments: [], deleteAppointmentId: null };
}

function ownIdentifier(request: InboxRequest): InboxIdentifier {
  return { system: SIM_APPOINTMENT_SYSTEM, value: `AP-${request.id}` };
}

async function release(
  store: SimInboxStore,
  tenantId: string,
  identifier: InboxIdentifier,
): Promise<{ slot: SlotRestore; appointment: AppointmentRestore }> {
  const appointment = await store.findAppointment(tenantId, identifier);
  if (!appointment) {
    throw new ConflictError("Hermes no conoce la cita", { reason: "appointment_not_in_hermes" });
  }
  await store.cancelAppointment(tenantId, appointment.id);
  await store.setSlotStatus(tenantId, appointment.slotId, "free");
  return {
    slot: { id: appointment.slotId, status: "busy" },
    appointment: { id: appointment.id, status: "booked" },
  };
}

async function book(
  ids: IdGenerator,
  store: SimInboxStore,
  tenantId: string,
  request: InboxRequest,
  patientId: string,
): Promise<HermesWrite> {
  const identifier = ownIdentifier(request);
  if (await store.findAppointment(tenantId, identifier)) {
    return none({ outcome: "approved", appointmentIdentifier: identifier });
  }
  const slot = request.slot ? await store.lockSlot(tenantId, request.slot.identifier) : null;
  if (slot === null) {
    return none({ outcome: "rejected", reason: "slot_unavailable" });
  }
  if (slot.status !== "free") {
    return none({ outcome: "rejected", reason: "slot_unavailable" });
  }
  const released = request.appointment
    ? await release(store, tenantId, request.appointment.identifier)
    : null;
  await store.setSlotStatus(tenantId, slot.id, "busy");
  const appointmentId = ids.next();
  await store.createAppointment({
    id: appointmentId,
    tenantId,
    identifier,
    patientId,
    scheduleId: slot.scheduleId,
    slotId: slot.id,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
  return {
    resolution: { outcome: "approved", appointmentIdentifier: identifier },
    restoreSlots: [...(released ? [released.slot] : []), { id: slot.id, status: slot.status }],
    restoreAppointments: released ? [released.appointment] : [],
    deleteAppointmentId: appointmentId,
  };
}

async function cancel(
  store: SimInboxStore,
  tenantId: string,
  request: InboxRequest,
): Promise<HermesWrite> {
  if (!request.appointment) {
    throw new ConflictError("Hermes no conoce la cita", { reason: "appointment_not_in_hermes" });
  }
  const released = await release(store, tenantId, request.appointment.identifier);
  return {
    resolution: { outcome: "approved", appointmentIdentifier: request.appointment.identifier },
    restoreSlots: [released.slot],
    restoreAppointments: [released.appointment],
    deleteAppointmentId: null,
  };
}

/** Reserva en Hermes o rechaza. No llama al chatbot: eso ocurre despues del commit. */
export function decide(
  ids: IdGenerator,
  store: SimInboxStore,
  tenantId: string,
  request: InboxRequest,
  patientId: string,
): Promise<HermesWrite> {
  if (request.kind === "cancel") {
    return cancel(store, tenantId, request);
  }
  return book(ids, store, tenantId, request, patientId);
}

/** Deshace una reserva ya confirmada en Hermes cuando el PUT al chatbot falla. */
export async function undo(
  store: SimInboxStore,
  tenantId: string,
  write: HermesWrite,
): Promise<void> {
  if (write.deleteAppointmentId) {
    await store.deleteAppointment(tenantId, write.deleteAppointmentId);
  }
  for (const appointment of write.restoreAppointments) {
    await store.setAppointmentStatus(tenantId, appointment.id, appointment.status);
  }
  for (const slot of write.restoreSlots) {
    await store.setSlotStatus(tenantId, slot.id, slot.status);
  }
}
