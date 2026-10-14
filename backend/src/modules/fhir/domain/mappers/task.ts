import type { TaskRecord } from "../ports/sources";
import { RESOLUTION_REASON_SYSTEM, reference } from "../profiles";
import type { FhirTask } from "../resources/types";

/** Cancelación pendiente o ya resuelta. `intent` es siempre `proposal`. */
export function toTask(record: TaskRecord): FhirTask {
  const task: FhirTask = {
    resourceType: "Task",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    status: record.status,
    intent: "proposal",
    focus: reference("Appointment", record.focusAppointmentId),
    for: reference("Patient", record.medicalRecordId),
  };
  if (record.statusReason === null) {
    return task;
  }
  return {
    ...task,
    statusReason: {
      coding: [{ system: RESOLUTION_REASON_SYSTEM, code: record.statusReason }],
    },
  };
}
