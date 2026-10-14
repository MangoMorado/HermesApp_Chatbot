import type { OffsetPage, OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  AppointmentStatusCode,
  DocumentCode,
  ResolutionReasonCode,
  SlotStatusKey,
  TaskStatusCode,
} from "../profiles";
import type { FhirIdentifier } from "../resources/types";

/**
 * Lo que `fhir` necesita leer, con la forma minima de cada registro. El composition
 * root cumple estos puertos con `scheduling` y `patients`; `fhir` no los importa.
 */

export type PatientRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly documentType: DocumentCode;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly status: "active" | "pre_registered";
};

export type PractitionerRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type HealthcareServiceRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type ScheduleRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly active: boolean;
};

export type SlotRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: SlotStatusKey;
};

export type AppointmentRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly medicalRecordId: string;
  readonly slotId: string;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: AppointmentStatusCode;
  /** Cita que esta sustituye. Solo en un reschedule. */
  readonly replacesAppointmentId: string | null;
};

export type TaskRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly status: TaskStatusCode;
  readonly medicalRecordId: string;
  readonly focusAppointmentId: string;
  readonly statusReason: ResolutionReasonCode | null;
};

/** Cota sobre el inicio de un cupo o cita. Varias cotas se combinan con AND. */
export type DateBound = { readonly op: "ge" | "gt" | "le" | "lt"; readonly at: Date };

export type MasterQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly active: boolean | null;
};

export type ScheduleQuery = MasterQuery & {
  readonly practitionerId: string | null;
  readonly healthcareServiceId: string | null;
};

export type SlotQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly scheduleId: string | null;
  readonly status: SlotStatusKey | null;
  readonly start: readonly DateBound[];
};

export type AppointmentQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly medicalRecordId: string | null;
  readonly slotId: string | null;
  readonly status: AppointmentStatusCode | null;
  readonly start: readonly DateBound[];
};

export type TaskQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly status: TaskStatusCode | null;
  readonly focusAppointmentId: string | null;
  readonly medicalRecordId: string | null;
};

export type PatientQuery = OffsetWindow & {
  /** Identificador Hermes. Excluyente con `document`. */
  readonly identifier: FhirIdentifier | null;
  readonly document: { readonly type: DocumentCode; readonly number: string } | null;
  readonly preRegistered: boolean | null;
};

export type FhirSource<R, Q> = {
  /** `null` si no existe en el tenant. */
  read(tenantId: TenantId, id: string): Promise<R | null>;
  search(tenantId: TenantId, query: Q): Promise<OffsetPage<R>>;
};

export type FhirSources = {
  readonly Patient: FhirSource<PatientRecord, PatientQuery>;
  readonly Practitioner: FhirSource<PractitionerRecord, MasterQuery>;
  readonly HealthcareService: FhirSource<HealthcareServiceRecord, MasterQuery>;
  readonly Schedule: FhirSource<ScheduleRecord, ScheduleQuery>;
  readonly Slot: FhirSource<SlotRecord, SlotQuery>;
  readonly Appointment: FhirSource<AppointmentRecord, AppointmentQuery>;
  readonly Task: FhirSource<TaskRecord, TaskQuery>;
};
