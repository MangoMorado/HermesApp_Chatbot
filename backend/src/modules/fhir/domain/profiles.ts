/**
 * Unico modulo con literales FHIR: version, MIME, systems, tags y value sets
 * (GOBERNANZA §3.1). Ningun otro archivo repite estos valores.
 */

export const FHIR_VERSION = "4.0.1";
export const FHIR_MIME = "application/fhir+json";
export const SOFTWARE_NAME = "Chatbot Ingenius 360";
/** Fecha del contrato; se cambia cuando cambia lo que declara `metadata`. */
export const CAPABILITY_DATE = "2026-10-14";

export const CONDITIONAL_ONLY =
  "Solo actualización condicional (PUT [type]?identifier=system|value). El PUT por id responde 405.";

export const IDEMPOTENCY_DOCUMENTATION =
  "Las escrituras requieren la cabecera Idempotency-Key con un valor no vacío.";

export const RESOURCE_TYPES = [
  "Patient",
  "Practitioner",
  "HealthcareService",
  "Schedule",
  "Slot",
  "Appointment",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

export function reference(type: ResourceType, id: string): { readonly reference: string } {
  return { reference: `${type}/${id}` };
}

export const DOCUMENT_CODES = ["CC", "TI", "CE", "PA", "RC"] as const;

export type DocumentCode = (typeof DOCUMENT_CODES)[number];

const DOCUMENT_SYSTEM_PREFIX = "urn:ingenius:document:";

export function documentSystem(code: DocumentCode): string {
  return `${DOCUMENT_SYSTEM_PREFIX}${code}`;
}

/** Tipo de documento de un `system`, o `null` si no es un system de documento. */
export function documentCodeOf(system: string): DocumentCode | null {
  if (!system.startsWith(DOCUMENT_SYSTEM_PREFIX)) {
    return null;
  }
  const code = system.slice(DOCUMENT_SYSTEM_PREFIX.length);
  return (DOCUMENT_CODES as readonly string[]).includes(code) ? (code as DocumentCode) : null;
}

export const PRE_REGISTRATION_SYSTEM = "urn:ingenius:pre-registration";

export const PRE_REGISTERED_TAG = {
  system: "urn:ingenius:patient-tag",
  code: "pre-registered",
} as const;

/** Estado interno del cupo -> codigo del value set `slotstatus` de R4. */
export const SLOT_STATUS = {
  free: "free",
  busy: "busy",
  busy_tentative: "busy-tentative",
  busy_unavailable: "busy-unavailable",
} as const;

export type SlotStatusKey = keyof typeof SLOT_STATUS;
export type FhirSlotStatus = (typeof SLOT_STATUS)[SlotStatusKey];

export function slotStatusKeyOf(code: string): SlotStatusKey | null {
  const keys = Object.keys(SLOT_STATUS) as SlotStatusKey[];
  return keys.find((key) => SLOT_STATUS[key] === code) ?? null;
}

/** Citas en firme: los codigos internos ya son los de `appointmentstatus` de R4. */
export const APPOINTMENT_STATUSES = ["booked", "cancelled", "fulfilled", "noshow"] as const;

export type AppointmentStatusCode = (typeof APPOINTMENT_STATUSES)[number];
