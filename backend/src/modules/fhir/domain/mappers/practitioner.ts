import type { PractitionerRecord } from "../ports/sources";
import type { FhirPractitioner } from "../resources/types";

export function toPractitioner(record: PractitionerRecord): FhirPractitioner {
  return {
    resourceType: "Practitioner",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    active: record.active,
    name: [{ text: record.name }],
  };
}
