import type { SimPatient, SimPractitioner, SimSchedule, SimSlot } from "../domain/entities";
import {
  documentSystem,
  RESOLUTION_REASON_SYSTEM,
  SLOT_STATUS_CODE,
} from "../domain/fhir-contract";
import type { InboxIdentifier } from "../domain/inbox";
import type { FhirId } from "./fhir-json";

type Named = { readonly identifierSystem: string; readonly identifierValue: string };

function identifierOf(row: Named): FhirId {
  return { system: row.identifierSystem, value: row.identifierValue };
}

function reasonCoding(reason: "slot_unavailable" | "declined") {
  return { coding: [{ system: RESOLUTION_REASON_SYSTEM, code: reason }] };
}

export function bookedAppointment(identifier: InboxIdentifier): unknown {
  return { resourceType: "Appointment", status: "booked", identifier: [identifier] };
}

export function cancelledAppointment(reason: "slot_unavailable" | "declined"): unknown {
  return {
    resourceType: "Appointment",
    status: "cancelled",
    cancelationReason: reasonCoding(reason),
  };
}

export function completedTask(): unknown {
  return { resourceType: "Task", status: "completed" };
}

export function rejectedTask(reason: "slot_unavailable" | "declined"): unknown {
  return { resourceType: "Task", status: "rejected", statusReason: reasonCoding(reason) };
}

export function practitionerBody(row: SimPractitioner): unknown {
  return {
    resourceType: "Practitioner",
    identifier: [identifierOf(row)],
    active: row.active,
    name: [{ text: row.name }],
  };
}

export function serviceBody(
  row: Named & { readonly name: string; readonly active: boolean },
): unknown {
  return {
    resourceType: "HealthcareService",
    identifier: [identifierOf(row)],
    active: row.active,
    name: row.name,
  };
}

export function patientBody(row: SimPatient): unknown {
  const given = row.givenNames.split(/\s+/).filter(Boolean);
  if (given.length === 0) {
    throw new Error("El paciente no tiene nombre");
  }
  const telecom = [
    ...(row.phone ? [{ system: "phone" as const, value: row.phone }] : []),
    ...(row.email ? [{ system: "email" as const, value: row.email }] : []),
  ];
  return {
    resourceType: "Patient",
    identifier: [
      identifierOf(row),
      { system: documentSystem(row.documentType), value: row.documentNumber },
    ],
    active: true,
    name: [{ family: row.familyNames, given }],
    birthDate: row.birthDate,
    ...(telecom.length > 0 ? { telecom } : {}),
  };
}

export function scheduleBody(row: SimSchedule, practitionerId: string, serviceId: string): unknown {
  return {
    resourceType: "Schedule",
    identifier: [identifierOf(row)],
    active: row.active,
    actor: [
      { reference: `Practitioner/${practitionerId}` },
      { reference: `HealthcareService/${serviceId}` },
    ],
  };
}

export function slotBody(row: SimSlot, scheduleId: string): unknown {
  return {
    resourceType: "Slot",
    identifier: [identifierOf(row)],
    schedule: { reference: `Schedule/${scheduleId}` },
    status: SLOT_STATUS_CODE[row.status],
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
  };
}
