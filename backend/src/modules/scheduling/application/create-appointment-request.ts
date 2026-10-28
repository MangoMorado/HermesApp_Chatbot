import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import {
  type AppointmentRequest,
  assertAppointmentChangeable,
  assertBelowPendingCap,
  assertSlotBookable,
  computeExpiresAt,
  preAgendaConflict,
} from "../domain/appointment-request";
import type { Appointment, Slot } from "../domain/entities";
import type { PreAgendaPolicy, PreAgendaStore } from "../domain/ports/pre-agenda";

type CommandBase = {
  readonly tenantId: TenantId;
  readonly medicalRecordId: string;
  readonly actor: AuditActor;
};

/** Contrato estable para el motor conversacional (3.3). */
export type CreateAppointmentRequestCommand =
  | (CommandBase & { readonly kind: "book"; readonly slotId: string })
  | (CommandBase & {
      readonly kind: "reschedule";
      readonly appointmentId: string;
      readonly slotId: string;
    })
  | (CommandBase & { readonly kind: "cancel"; readonly appointmentId: string });

export type CreateAppointmentRequestDeps = {
  readonly store: PreAgendaStore;
  readonly policy: PreAgendaPolicy;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

export type CreateAppointmentRequest = (
  command: CreateAppointmentRequestCommand,
) => Promise<AppointmentRequest>;

async function changeableAppointment(
  store: PreAgendaStore,
  command: CommandBase & { readonly appointmentId: string },
  now: Date,
): Promise<Appointment> {
  await store.expireDue(command.tenantId, now, { appointmentId: command.appointmentId });
  const appointment = await store.getAppointment(command.tenantId, command.appointmentId);
  if (!appointment) {
    throw new NotFoundError();
  }
  assertAppointmentChangeable(appointment, command.medicalRecordId, now);
  return appointment;
}

async function bookableSlot(
  store: PreAgendaStore,
  tenantId: TenantId,
  slotId: string,
  target: Appointment | null,
  now: Date,
): Promise<Slot> {
  await store.expireDue(tenantId, now, { slotId });
  const slot = await store.getSlot(tenantId, slotId);
  if (!slot) {
    throw new NotFoundError();
  }
  if (target?.slotId === slot.id) {
    throw new ValidationError("El cupo nuevo es el de la cita actual", { field: "slot_id" });
  }
  const schedule = await store.getSchedule(tenantId, slot.scheduleId);
  if (!schedule) {
    throw new NotFoundError();
  }
  assertSlotBookable(slot, schedule, now);
  return slot;
}

async function holdWithinCap(
  store: PreAgendaStore,
  command: CommandBase,
  slotId: string,
  maxPendingHolds: number,
  now: Date,
): Promise<void> {
  const liveHolds = await store.countLiveHolds(command.tenantId, command.medicalRecordId, now);
  assertBelowPendingCap(liveHolds, maxPendingHolds);
  if (!(await store.holdSlot(command.tenantId, slotId))) {
    throw preAgendaConflict("slot_unavailable", "El cupo ya no esta libre");
  }
}

/**
 * Crea una solicitud y, si aparta cupo, lo pasa a `busy_tentative` en la misma transaccion.
 * El bloqueo de la historia clinica serializa las solicitudes de un paciente (tope exacto);
 * el UPDATE condicional del cupo resuelve la carrera entre pacientes.
 */
export function createCreateAppointmentRequest(
  deps: CreateAppointmentRequestDeps,
): CreateAppointmentRequest {
  return async (command) => {
    const now = deps.clock.now();
    if (!(await deps.store.lockMedicalRecord(command.tenantId, command.medicalRecordId))) {
      throw new NotFoundError();
    }
    const policy = await deps.policy.read(command.tenantId);
    const target =
      command.kind === "book" ? null : await changeableAppointment(deps.store, command, now);
    const slot =
      command.kind === "cancel"
        ? null
        : await bookableSlot(deps.store, command.tenantId, command.slotId, target, now);
    if (slot) {
      await holdWithinCap(deps.store, command, slot.id, policy.maxPendingHolds, now);
    }
    const request = await deps.store.insertRequest({
      id: deps.ids.next(),
      tenantId: command.tenantId,
      kind: command.kind,
      medicalRecordId: command.medicalRecordId,
      slotId: slot?.id ?? null,
      appointmentId: target?.id ?? null,
      expiresAt: computeExpiresAt(now, policy.holdMinutes, slot?.startAt ?? null),
      createdAt: now,
    });
    await deps.audit.record({
      tenantId: command.tenantId,
      ...command.actor,
      action: "appointment_request.created",
      resourceType: "appointment_request",
      resourceId: request.id,
      occurredAt: now,
    });
    return request;
  };
}
