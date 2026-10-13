import type { HealthcareServiceRecord } from "../ports/sources";
import type { FhirHealthcareService } from "../resources/types";

export function toHealthcareService(record: HealthcareServiceRecord): FhirHealthcareService {
  return {
    resourceType: "HealthcareService",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    active: record.active,
    name: record.name,
  };
}
