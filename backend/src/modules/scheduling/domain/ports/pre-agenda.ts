import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  AppointmentRequest,
  AppointmentRequestKind,
  AppointmentRequestStatus,
  ResolutionReason,
} from "../appointment-request";
import type {
  Appointment,
  AppointmentStatus,
  HermesIdentifier,
  Schedule,
  Slot,
  SlotStatus,
} from "../entities";

export type NewAppointmentRequest = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly kind: AppointmentRequestKind;
  readonly medicalRecordId: string;
  readonly slotId: string | null;
  readonly appointmentId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
};

export type NewAppointment = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier;
  readonly medicalRecordId: string;
  readonly scheduleId: string;
  readonly slotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type RequestResolutionPatch = {
  readonly status: Exclude<AppointmentRequestStatus, "pending">;
  readonly resolutionReason: ResolutionReason | null;
  readonly resultingAppointmentId: string | null;
  readonly resolvedAt: Date;
};

/** Alcance del vencimiento: todo el tenant o solo lo que toca un cupo o una cita. */
export type ExpiryScope = { readonly slotId: string } | { readonly appointmentId: string };

export type RequestExpirer = {
  /** Vence las pendientes con `expires_at <= now` y devuelve a `free` sus cupos apartados. */
  expireDue(tenantId: TenantId, now: Date, scope?: ExpiryScope): Promise<void>;
};

/**
 * Operaciones de la pre-agenda. Se construye sobre la transaccion del llamador
 * (`withWriteTransaction`): los bloqueos `FOR UPDATE` duran lo que ella.
 */
export type PreAgendaStore = RequestExpirer & {
  /** Bloquea la historia clinica; `false` si no existe en el tenant. */
  lockMedicalRecord(tenantId: TenantId, medicalRecordId: string): Promise<boolean>;
  getSlot(tenantId: TenantId, id: string): Promise<Slot | null>;
  getSchedule(tenantId: TenantId, id: string): Promise<Schedule | null>;
  getAppointment(tenantId: TenantId, id: string): Promise<Appointment | null>;
  /** Solicitudes `book`/`reschedule` vivas del paciente. */
  countLiveHolds(tenantId: TenantId, medicalRecordId: string, now: Date): Promise<number>;
  /** Bloquea y devuelve la solicitud pendiente viva que aparta el cupo. */
  findLiveHoldBySlot(
    tenantId: TenantId,
    slotId: string,
    now: Date,
  ): Promise<AppointmentRequest | null>;
  /** `free` -> `busy_tentative` solo si sigue libre. `false` si otro lo tomo antes. */
  holdSlot(tenantId: TenantId, slotId: string): Promise<boolean>;
  /** Traduce los indices unicos parciales a `appointment_change_pending` / `slot_unavailable`. */
  insertRequest(row: NewAppointmentRequest): Promise<AppointmentRequest>;
  /** Bloquea la solicitud; `null` si no existe en el tenant. */
  getRequestForUpdate(tenantId: TenantId, id: string): Promise<AppointmentRequest | null>;
  setSlotStatus(tenantId: TenantId, slotId: string, status: SlotStatus): Promise<void>;
  insertAppointment(row: NewAppointment): Promise<void>;
  setAppointmentStatus(tenantId: TenantId, id: string, status: AppointmentStatus): Promise<void>;
  markResolved(
    tenantId: TenantId,
    id: string,
    patch: RequestResolutionPatch,
  ): Promise<AppointmentRequest>;
};

export type PreAgendaPolicyValues = {
  readonly holdMinutes: number;
  readonly maxPendingHolds: number;
};

/** Lo cumple `bot-config` en el composition root; `scheduling` no lo importa. */
export type PreAgendaPolicy = {
  read(tenantId: TenantId): Promise<PreAgendaPolicyValues>;
};

export type RequestPartyRef = {
  readonly identifier: HermesIdentifier;
  readonly startAt: Date;
  readonly endAt: Date;
};

/** Datos de identificacion del paciente; ningun dato clinico. */
export type RequestPatient = {
  readonly identifier: HermesIdentifier;
  readonly documentType: string;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
};

export type AppointmentRequestView = AppointmentRequest & {
  readonly patient: RequestPatient;
  readonly slot: RequestPartyRef | null;
  readonly appointment: RequestPartyRef | null;
  readonly resultingAppointment: { readonly identifier: HermesIdentifier } | null;
};

export type AppointmentRequestFilter = {
  readonly tenantId: TenantId;
  readonly status?: AppointmentRequestStatus;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type AppointmentRequestReader = {
  list(filter: AppointmentRequestFilter): Promise<Page<AppointmentRequestView>>;
  get(tenantId: TenantId, id: string): Promise<AppointmentRequestView | null>;
};
