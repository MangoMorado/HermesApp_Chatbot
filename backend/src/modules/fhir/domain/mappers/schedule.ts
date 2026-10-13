import type { ScheduleRecord } from "../ports/sources";
import { reference } from "../profiles";
import type { FhirSchedule } from "../resources/types";

export function toSchedule(record: ScheduleRecord): FhirSchedule {
  return {
    resourceType: "Schedule",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    active: record.active,
    actor: [
      reference("Practitioner", record.practitionerId),
      reference("HealthcareService", record.healthcareServiceId),
    ],
  };
}
