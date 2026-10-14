import { fhirUnprocessable } from "./fhir-error";
import type { AppointmentResolutionBody } from "./parsers/appointment-resolution";
import type { TaskResolutionBody } from "./parsers/task-resolution";
import type { AppointmentRecord, TaskRecord } from "./ports/sources";
import type { FhirIdentifier } from "./resources/types";

function sameIdentifier(left: FhirIdentifier, right: FhirIdentifier): boolean {
  return left.system === right.system && left.value === right.value;
}

function assertEqual(actual: string | null, expected: string, field: string): void {
  if (actual !== null && actual !== expected) {
    throw fhirUnprocessable("structure", `${field} no coincide con el recurso`);
  }
}

function assertInstant(actual: Date | null, expected: Date, field: string): void {
  if (actual !== null && actual.getTime() !== expected.getTime()) {
    throw fhirUnprocessable("structure", `${field} no coincide con el recurso`);
  }
}

/** El cuerpo puede omitir un campo. Si lo trae, tiene que ser el que ya está guardado. */
export function assertAppointmentEcho(
  body: AppointmentResolutionBody,
  current: AppointmentRecord,
): void {
  assertInstant(body.start, current.startAt, "start");
  assertInstant(body.end, current.endAt, "end");
  assertEqual(body.slotId, current.slotId, "slot");
  assertEqual(body.patientId, current.medicalRecordId, "patient");
  assertEqual(body.practitionerId, current.practitionerId, "practitioner");
  assertEqual(body.serviceId, current.healthcareServiceId, "service");
  if (
    body.replacesAppointmentId !== null &&
    body.replacesAppointmentId !== current.replacesAppointmentId
  ) {
    throw fhirUnprocessable("structure", "replaces no coincide con el recurso");
  }
  if (
    body.status === "cancelled" &&
    body.identifier !== null &&
    !sameIdentifier(body.identifier, current.identifier)
  ) {
    throw fhirUnprocessable("structure", "identifier no coincide con el recurso");
  }
}

export function assertTaskEcho(body: TaskResolutionBody, current: TaskRecord): void {
  assertEqual(body.focusAppointmentId, current.focusAppointmentId, "focus");
  assertEqual(body.patientId, current.medicalRecordId, "patient");
  if (body.identifier !== null && !sameIdentifier(body.identifier, current.identifier)) {
    throw fhirUnprocessable("structure", "identifier no coincide con el recurso");
  }
}
