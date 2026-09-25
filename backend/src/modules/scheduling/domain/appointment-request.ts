import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type {
  Appointment,
  AppointmentStatus,
  HermesIdentifier,
  Schedule,
  Slot,
  SlotStatus,
} from "./entities";

export type AppointmentRequestKind = "book" | "reschedule" | "cancel";
export type AppointmentRequestStatus = "pending" | "approved" | "rejected" | "expired";
export type ResolutionReason = "slot_unavailable" | "declined";

/** Motivos de `409 conflict` (`details.reason`). Estables: el motor conversacional los ramifica. */
export type PreAgendaConflictReason =
  | "slot_unavailable"
  | "pending_limit_reached"
  | "appointment_change_pending"
  | "request_not_pending";

/** Solicitud originada por el chatbot. Hermes la resuelve; el chatbot nunca confirma. */
export type AppointmentRequest = {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: AppointmentRequestKind;
  readonly status: AppointmentRequestStatus;
  readonly medicalRecordId: string;
  readonly slotId: string | null;
  readonly appointmentId: string | null;
  readonly expiresAt: Date;
  readonly resolutionReason: ResolutionReason | null;
  readonly resultingAppointmentId: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
};

/** Decision de Hermes. En `cancel` el identificador se ignora. */
export type Resolution =
  | { readonly outcome: "approved"; readonly appointmentIdentifier: HermesIdentifier }
  | { readonly outcome: "rejected"; readonly reason: ResolutionReason };

export type SlotChange = { readonly slotId: string; readonly status: SlotStatus };
export type AppointmentChange = {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
};

/** Cambios sobre cupos y citas al resolver; `bookedSlotId` es el cupo de la cita nueva. */
export type ResolutionEffects = {
  readonly slots: readonly SlotChange[];
  readonly appointments: readonly AppointmentChange[];
  readonly bookedSlotId: string | null;
};

const MINUTE_MS = 60_000;

export function preAgendaConflict(
  reason: PreAgendaConflictReason,
  message: string,
  extra: Record<string, unknown> = {},
): ConflictError {
  return new ConflictError(message, { reason, ...extra });
}

/** Plazo del tenant, recortado al inicio del cupo: un apartado nunca sobrevive a la cita. */
export function computeExpiresAt(now: Date, holdMinutes: number, slotStart: Date | null): Date {
  const byHold = new Date(now.getTime() + holdMinutes * MINUTE_MS);
  return slotStart !== null && slotStart < byHold ? slotStart : byHold;
}

/** Viva = pendiente y antes del vencimiento, este o no marcada ya como vencida. */
export function isLive(
  request: Pick<AppointmentRequest, "status" | "expiresAt">,
  now: Date,
): boolean {
  return request.status === "pending" && now < request.expiresAt;
}

export function assertSlotBookable(slot: Slot, schedule: Schedule, now: Date): void {
  if (!schedule.active) {
    throw new ValidationError("La agenda del cupo no esta activa", { field: "slot_id" });
  }
  if (slot.startAt <= now) {
    throw new ValidationError("El cupo ya empezo", { field: "slot_id" });
  }
  if (slot.status !== "free") {
    throw preAgendaConflict("slot_unavailable", "El cupo no esta libre");
  }
}

/** La cita de otro paciente se trata como inexistente: no se revela que existe. */
export function assertAppointmentChangeable(
  appointment: Appointment,
  medicalRecordId: string,
  now: Date,
): void {
  if (appointment.medicalRecordId !== medicalRecordId) {
    throw new NotFoundError();
  }
  if (appointment.status !== "booked") {
    throw new ValidationError("La cita no esta en firme", { field: "appointment_id" });
  }
  if (appointment.startAt <= now) {
    throw new ValidationError("La cita ya empezo", { field: "appointment_id" });
  }
}

export function assertBelowPendingCap(liveHolds: number, max: number): void {
  if (liveHolds >= max) {
    throw preAgendaConflict("pending_limit_reached", "Tope de solicitudes pendientes alcanzado", {
      max,
    });
  }
}

/** `released` cubre rechazo y vencimiento: los dos solo liberan el apartado. */
export function resolutionEffects(
  request: Pick<AppointmentRequest, "kind" | "slotId" | "appointmentId">,
  targetSlotId: string | null,
  outcome: "approved" | "released",
): ResolutionEffects {
  if (outcome === "released") {
    const slots = request.slotId ? [{ slotId: request.slotId, status: "free" as const }] : [];
    return { slots, appointments: [], bookedSlotId: null };
  }
  const freed = targetSlotId ? [{ slotId: targetSlotId, status: "free" as const }] : [];
  const held = request.slotId ? [{ slotId: request.slotId, status: "busy" as const }] : [];
  const cancelled = request.appointmentId
    ? [{ appointmentId: request.appointmentId, status: "cancelled" as const }]
    : [];
  return { slots: [...freed, ...held], appointments: cancelled, bookedSlotId: request.slotId };
}
