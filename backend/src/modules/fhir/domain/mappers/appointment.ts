import type { AppointmentRecord } from "../ports/sources";
import { REPLACES_APPOINTMENT, reference } from "../profiles";
import type { FhirAppointment, ParticipantStatus } from "../resources/types";

function othersStatus(record: AppointmentRecord): ParticipantStatus {
  return record.status === "proposed" ? "needs-action" : "accepted";
}

/** Cita en firme o pre-agenda. El estado decide a los participantes; `replaces` solo en reschedule. */
export function toAppointment(record: AppointmentRecord): FhirAppointment {
  const others = othersStatus(record);
  const resource: FhirAppointment = {
    resourceType: "Appointment",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    status: record.status,
    start: record.startAt.toISOString(),
    end: record.endAt.toISOString(),
    slot: [reference("Slot", record.slotId)],
    participant: [
      { actor: reference("Patient", record.medicalRecordId), status: "accepted" },
      { actor: reference("Practitioner", record.practitionerId), status: others },
      { actor: reference("HealthcareService", record.healthcareServiceId), status: others },
    ],
  };
  if (record.replacesAppointmentId === null) {
    return resource;
  }
  return {
    ...resource,
    extension: [
      {
        url: REPLACES_APPOINTMENT,
        valueReference: reference("Appointment", record.replacesAppointmentId),
      },
    ],
  };
}
