import type { OffsetPage, OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Vista de lectura que el composition root entrega al puerto FHIR. Sin literales de perfil. */

export type AgendaIdentifier = { readonly system: string; readonly value: string };

export type AgendaTimeBound = { readonly op: "ge" | "gt" | "le" | "lt"; readonly at: Date };

export type AgendaAppointmentStatus = "proposed" | "booked" | "cancelled" | "fulfilled" | "noshow";

export type AgendaAppointment = {
  readonly id: string;
  readonly identifier: AgendaIdentifier;
  readonly medicalRecordId: string;
  readonly slotId: string;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: AgendaAppointmentStatus;
  readonly replacesAppointmentId: string | null;
};

export type AgendaTaskStatus = "requested" | "completed" | "rejected" | "cancelled";

export type AgendaTask = {
  readonly id: string;
  readonly identifier: AgendaIdentifier;
  readonly status: AgendaTaskStatus;
  readonly medicalRecordId: string;
  readonly focusAppointmentId: string;
  readonly statusReason: "slot_unavailable" | "declined" | null;
};

export type AgendaAppointmentSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: AgendaIdentifier | null;
  readonly medicalRecordId: string | null;
  readonly slotId: string | null;
  readonly status: AgendaAppointmentStatus | null;
  readonly start: readonly AgendaTimeBound[];
};

export type AgendaTaskSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: AgendaIdentifier | null;
  readonly status: AgendaTaskStatus | null;
  readonly focusAppointmentId: string | null;
  readonly medicalRecordId: string | null;
};

export type FhirAgenda = {
  readAppointment(tenantId: TenantId, id: string): Promise<AgendaAppointment | null>;
  searchAppointments(search: AgendaAppointmentSearch): Promise<OffsetPage<AgendaAppointment>>;
  readTask(tenantId: TenantId, id: string): Promise<AgendaTask | null>;
  searchTasks(search: AgendaTaskSearch): Promise<OffsetPage<AgendaTask>>;
};
