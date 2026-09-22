import type {
  SimHealthcareService,
  SimPatient,
  SimPractitioner,
  SimSchedule,
} from "@/modules/hermes-simulator/domain/entities";
import type { HistoryAppointment, MedicalRecord } from "@/modules/patients/domain/entities";
import type {
  Appointment,
  HealthcareService,
  Practitioner,
  Schedule,
  Slot,
} from "@/modules/scheduling/domain/entities";
import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantSettings } from "@/modules/tenancy/domain/tenant-settings";

export function pageJson<T>(page: Page<T>, mapItem: (item: T) => unknown) {
  return {
    data: page.data.map(mapItem),
    next_cursor: page.nextCursor,
  };
}

export function practitionerJson(row: Practitioner) {
  return {
    id: row.id,
    identifier_system: row.identifier.system,
    identifier_value: row.identifier.value,
    name: row.name,
    active: row.active,
  };
}

export function healthcareServiceJson(row: HealthcareService) {
  return {
    id: row.id,
    identifier_system: row.identifier.system,
    identifier_value: row.identifier.value,
    name: row.name,
    active: row.active,
  };
}

export function scheduleJson(row: Schedule) {
  return {
    id: row.id,
    identifier_system: row.identifier.system,
    identifier_value: row.identifier.value,
    practitioner_id: row.practitionerId,
    healthcare_service_id: row.healthcareServiceId,
    active: row.active,
  };
}

export function slotJson(row: Slot) {
  return {
    id: row.id,
    identifier_system: row.identifier.system,
    identifier_value: row.identifier.value,
    schedule_id: row.scheduleId,
    start_at: row.startAt.toISOString(),
    end_at: row.endAt.toISOString(),
    status: row.status,
  };
}

export function appointmentJson(row: Appointment) {
  return {
    id: row.id,
    identifier_system: row.identifier.system,
    identifier_value: row.identifier.value,
    medical_record_id: row.medicalRecordId,
    schedule_id: row.scheduleId,
    slot_id: row.slotId,
    start_at: row.startAt.toISOString(),
    end_at: row.endAt.toISOString(),
    status: row.status,
  };
}

export function medicalRecordJson(row: MedicalRecord) {
  return {
    id: row.id,
    identifier_system: row.identifier.system,
    identifier_value: row.identifier.value,
    document_type: row.documentType,
    document_number: row.documentNumber,
    given_names: row.givenNames,
    family_names: row.familyNames,
    birth_date: row.birthDate,
    phone: row.phone,
    email: row.email,
    status: row.status,
  };
}

export function historyAppointmentJson(row: HistoryAppointment) {
  return {
    id: row.id,
    schedule_id: row.scheduleId,
    slot_id: row.slotId,
    start_at: row.startAt.toISOString(),
    end_at: row.endAt.toISOString(),
    status: row.status,
  };
}

export function tenantSettingsJson(row: TenantSettings) {
  return { max_query_range_days: row.maxQueryRangeDays };
}

export function simPractitionerJson(row: SimPractitioner) {
  return {
    id: row.id,
    identifier_system: row.identifierSystem,
    identifier_value: row.identifierValue,
    name: row.name,
    active: row.active,
  };
}

export function simServiceJson(row: SimHealthcareService) {
  return {
    id: row.id,
    identifier_system: row.identifierSystem,
    identifier_value: row.identifierValue,
    name: row.name,
    active: row.active,
  };
}

export function simScheduleJson(row: SimSchedule) {
  return {
    id: row.id,
    identifier_system: row.identifierSystem,
    identifier_value: row.identifierValue,
    practitioner_id: row.practitionerId,
    healthcare_service_id: row.healthcareServiceId,
    active: row.active,
  };
}

export function simPatientJson(row: SimPatient) {
  return {
    id: row.id,
    identifier_system: row.identifierSystem,
    identifier_value: row.identifierValue,
    document_type: row.documentType,
    document_number: row.documentNumber,
    given_names: row.givenNames,
    family_names: row.familyNames,
    birth_date: row.birthDate,
    phone: row.phone,
    email: row.email,
    status: row.status,
  };
}
