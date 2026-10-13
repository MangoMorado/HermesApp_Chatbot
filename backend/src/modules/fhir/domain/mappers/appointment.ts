import type { AppointmentRecord } from "../ports/sources";
import { reference } from "../profiles";
import type { FhirAppointment } from "../resources/types";

export function toAppointment(record: AppointmentRecord): FhirAppointment {
  return {
    resourceType: "Appointment",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    status: record.status,
    start: record.startAt.toISOString(),
    end: record.endAt.toISOString(),
    slot: [reference("Slot", record.slotId)],
    participant: [
      { actor: reference("Patient", record.medicalRecordId), status: "accepted" },
      { actor: reference("Practitioner", record.practitionerId), status: "accepted" },
      { actor: reference("HealthcareService", record.healthcareServiceId), status: "accepted" },
    ],
  };
}
