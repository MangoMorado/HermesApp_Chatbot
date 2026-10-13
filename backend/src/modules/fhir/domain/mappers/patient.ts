import type { PatientRecord } from "../ports/sources";
import { documentSystem, PRE_REGISTERED_TAG } from "../profiles";
import type { FhirPatient } from "../resources/types";

function telecomOf(record: PatientRecord): FhirPatient["telecom"] {
  const telecom = [
    ...(record.phone ? [{ system: "phone" as const, value: record.phone }] : []),
    ...(record.email ? [{ system: "email" as const, value: record.email }] : []),
  ];
  return telecom.length > 0 ? telecom : undefined;
}

export function toPatient(record: PatientRecord): FhirPatient {
  const telecom = telecomOf(record);
  const given = record.givenNames.split(/\s+/).filter(Boolean);
  return {
    resourceType: "Patient",
    id: record.id,
    ...(record.status === "pre_registered" ? { meta: { tag: [PRE_REGISTERED_TAG] } } : {}),
    identifier: [
      { system: record.identifier.system, value: record.identifier.value },
      { system: documentSystem(record.documentType), value: record.documentNumber },
    ],
    active: true,
    name: [{ family: record.familyNames, ...(given.length > 0 ? { given } : {}) }],
    birthDate: record.birthDate,
    ...(telecom ? { telecom } : {}),
  };
}
