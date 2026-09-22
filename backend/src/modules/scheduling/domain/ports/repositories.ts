import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Appointment, HealthcareService, Practitioner, Schedule, Slot } from "../entities";

export type ListFilter = {
  readonly tenantId: TenantId;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type ScheduleListFilter = ListFilter & {
  readonly practitionerId?: string;
  readonly healthcareServiceId?: string;
};

export type AvailabilityFilter = {
  readonly tenantId: TenantId;
  readonly from: Date;
  readonly to: Date;
  readonly healthcareServiceId?: string;
  readonly practitionerId?: string;
  readonly scheduleId?: string;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type ScheduleSlotsFilter = {
  readonly tenantId: TenantId;
  readonly scheduleId: string;
  readonly from: Date;
  readonly to: Date;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type AppointmentListFilter = {
  readonly tenantId: TenantId;
  readonly scheduleId: string;
  readonly from: Date;
  readonly to: Date;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type PractitionerRepository = {
  list(filter: ListFilter): Promise<Page<Practitioner>>;
};

export type HealthcareServiceRepository = {
  list(filter: ListFilter): Promise<Page<HealthcareService>>;
};

export type ScheduleRepository = {
  list(filter: ScheduleListFilter): Promise<Page<Schedule>>;
  get(tenantId: TenantId, id: string): Promise<Schedule | null>;
};

export type SlotRepository = {
  listAvailability(filter: AvailabilityFilter): Promise<Page<Slot>>;
  listBySchedule(filter: ScheduleSlotsFilter): Promise<Page<Slot>>;
};

export type AppointmentRepository = {
  listBySchedule(filter: AppointmentListFilter): Promise<Page<Appointment>>;
};
