import type { OffsetPage, OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  Appointment,
  AppointmentStatus,
  HealthcareService,
  HermesIdentifier,
  Practitioner,
  Schedule,
  Slot,
  SlotStatus,
} from "../entities";

/**
 * Lecturas por id y por desplazamiento con total. Las usa la superficie FHIR;
 * REST sigue con los repositorios por cursor de `repositories.ts`.
 * Un filtro en `null` no restringe. Varias cotas de inicio se combinan con AND.
 */

export type TimeBound = { readonly op: "ge" | "gt" | "le" | "lt"; readonly at: Date };

export type MasterSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier | null;
  readonly active: boolean | null;
};

export type ScheduleSearch = MasterSearch & {
  readonly practitionerId: string | null;
  readonly healthcareServiceId: string | null;
};

export type SlotSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier | null;
  readonly scheduleId: string | null;
  readonly status: SlotStatus | null;
  readonly start: readonly TimeBound[];
};

export type AppointmentSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier | null;
  readonly medicalRecordId: string | null;
  readonly slotId: string | null;
  readonly status: AppointmentStatus | null;
  readonly start: readonly TimeBound[];
};

/** Cita en firme con el profesional y el servicio de su agenda. */
export type AppointmentWithActors = Appointment & {
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
};

export type SchedulingDirectory = {
  getPractitioner(tenantId: TenantId, id: string): Promise<Practitioner | null>;
  searchPractitioners(search: MasterSearch): Promise<OffsetPage<Practitioner>>;
  getHealthcareService(tenantId: TenantId, id: string): Promise<HealthcareService | null>;
  searchHealthcareServices(search: MasterSearch): Promise<OffsetPage<HealthcareService>>;
  getSchedule(tenantId: TenantId, id: string): Promise<Schedule | null>;
  searchSchedules(search: ScheduleSearch): Promise<OffsetPage<Schedule>>;
  getSlot(tenantId: TenantId, id: string): Promise<Slot | null>;
  /** Orden: inicio ascendente, luego id. */
  searchSlots(search: SlotSearch): Promise<OffsetPage<Slot>>;
  getAppointment(tenantId: TenantId, id: string): Promise<AppointmentWithActors | null>;
  /** Orden: inicio ascendente, luego id. */
  searchAppointments(search: AppointmentSearch): Promise<OffsetPage<AppointmentWithActors>>;
};
