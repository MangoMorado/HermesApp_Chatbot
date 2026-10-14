/**
 * Literales que el cliente envia. Copia de `fhir/domain/profiles.ts`: este modulo no importa
 * `fhir`. El test de paridad exige que las dos copias coincidan.
 */

export const REQUEST_SYSTEM = "urn:ingenius:appointment-request";
export const PRE_REGISTRATION_SYSTEM = "urn:ingenius:pre-registration";
export const DOCUMENT_SYSTEM_PREFIX = "urn:ingenius:document:";
export const PRE_REGISTERED_TAG = {
  system: "urn:ingenius:patient-tag",
  code: "pre-registered",
} as const;
export const REPLACES_EXTENSION =
  "http://hl7.org/fhir/5.0/StructureDefinition/extension-Appointment.replaces";
export const RESOLUTION_REASON_SYSTEM = "urn:ingenius:resolution-reason";
export const SIM_APPOINTMENT_SYSTEM = "urn:hermes:appointment";
export const HERMES_PATIENT_SYSTEM = "urn:hermes:patient";

export const SLOT_STATUS_CODE = {
  free: "free",
  busy: "busy",
  busy_tentative: "busy-tentative",
  busy_unavailable: "busy-unavailable",
} as const;

export type SlotStatusName = keyof typeof SLOT_STATUS_CODE;

export function documentSystem(code: string): string {
  return `${DOCUMENT_SYSTEM_PREFIX}${code}`;
}

export function isDocumentSystem(system: string): boolean {
  return system.startsWith(DOCUMENT_SYSTEM_PREFIX);
}
