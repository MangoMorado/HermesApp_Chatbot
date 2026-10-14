import { fhirInvalid } from "./fhir-error";
import { toAppointment } from "./mappers/appointment";
import { toHealthcareService } from "./mappers/healthcare-service";
import { toPatient } from "./mappers/patient";
import { toPractitioner } from "./mappers/practitioner";
import { toSchedule } from "./mappers/schedule";
import { toSlot } from "./mappers/slot";
import type {
  AppointmentQuery,
  AppointmentRecord,
  HealthcareServiceRecord,
  MasterQuery,
  PatientQuery,
  PatientRecord,
  PractitionerRecord,
  ScheduleQuery,
  ScheduleRecord,
  SlotQuery,
  SlotRecord,
} from "./ports/sources";
import {
  APPOINTMENT_STATUSES,
  documentCodeOf,
  PRE_REGISTERED_TAG,
  type ResourceType,
  SLOT_STATUS,
  slotStatusKeyOf,
} from "./profiles";
import type { FhirIdentifier, FhirResource, SearchParamType } from "./resources/types";
import {
  parseBoolean,
  parseCode,
  parseDateBounds,
  parseReference,
  parseToken,
  parseWindow,
  type SearchParams,
  single,
} from "./search";

/**
 * Registro de recursos: la unica tabla que dice que se puede leer y buscar.
 * De aqui salen la validacion de parametros y el `CapabilityStatement`, asi
 * que `metadata` no puede declarar algo que no exista.
 */

export type SearchParamDef = { readonly name: string; readonly type: SearchParamType };

export type SearchContext = { readonly params: SearchParams; readonly timeZone: string };

export type ResourceDefinition<R, Q> = {
  readonly type: ResourceType;
  readonly writable: boolean;
  readonly searchParams: readonly SearchParamDef[];
  buildQuery(context: SearchContext): Q;
  toResource(record: R): FhirResource;
};

const IDENTIFIER: SearchParamDef = { name: "identifier", type: "token" };
const ACTIVE: SearchParamDef = { name: "active", type: "token" };

function identifierOf(params: SearchParams): FhirIdentifier | null {
  const raw = single(params, "identifier");
  return raw === null ? null : parseToken("identifier", raw);
}

function activeOf(params: SearchParams): boolean | null {
  const raw = single(params, "active");
  return raw === null ? null : parseBoolean("active", raw);
}

function referenceIdOf(params: SearchParams, name: string, type: ResourceType): string | null {
  const raw = single(params, name);
  return raw === null ? null : parseReference(name, raw, [type]).id;
}

function masterQuery({ params }: SearchContext): MasterQuery {
  return { identifier: identifierOf(params), active: activeOf(params), ...parseWindow(params) };
}

function preRegisteredOf(params: SearchParams): boolean | null {
  const raw = single(params, "_tag");
  if (raw === null) {
    return null;
  }
  const tag = parseToken("_tag", raw);
  if (tag.system !== PRE_REGISTERED_TAG.system || tag.value !== PRE_REGISTERED_TAG.code) {
    throw fhirInvalid("_tag desconocido");
  }
  return true;
}

const patient: ResourceDefinition<PatientRecord, PatientQuery> = {
  type: "Patient",
  writable: true,
  searchParams: [IDENTIFIER, { name: "_tag", type: "token" }],
  buildQuery({ params }) {
    const token = identifierOf(params);
    const documentType = token ? documentCodeOf(token.system) : null;
    return {
      identifier: token && !documentType ? token : null,
      document: token && documentType ? { type: documentType, number: token.value } : null,
      preRegistered: preRegisteredOf(params),
      ...parseWindow(params),
    };
  },
  toResource: toPatient,
};

const practitioner: ResourceDefinition<PractitionerRecord, MasterQuery> = {
  type: "Practitioner",
  writable: true,
  searchParams: [IDENTIFIER, ACTIVE],
  buildQuery: masterQuery,
  toResource: toPractitioner,
};

const healthcareService: ResourceDefinition<HealthcareServiceRecord, MasterQuery> = {
  type: "HealthcareService",
  writable: true,
  searchParams: [IDENTIFIER, ACTIVE],
  buildQuery: masterQuery,
  toResource: toHealthcareService,
};

const schedule: ResourceDefinition<ScheduleRecord, ScheduleQuery> = {
  type: "Schedule",
  writable: true,
  searchParams: [IDENTIFIER, { name: "actor", type: "reference" }, ACTIVE],
  buildQuery(context) {
    const raw = single(context.params, "actor");
    const actor =
      raw === null ? null : parseReference("actor", raw, ["Practitioner", "HealthcareService"]);
    return {
      ...masterQuery(context),
      practitionerId: actor?.type === "Practitioner" ? actor.id : null,
      healthcareServiceId: actor?.type === "HealthcareService" ? actor.id : null,
    };
  },
  toResource: toSchedule,
};

const slot: ResourceDefinition<SlotRecord, SlotQuery> = {
  type: "Slot",
  writable: true,
  searchParams: [
    IDENTIFIER,
    { name: "schedule", type: "reference" },
    { name: "status", type: "token" },
    { name: "start", type: "date" },
  ],
  buildQuery({ params, timeZone }) {
    const raw = single(params, "status");
    const code = raw === null ? null : parseCode("status", raw, Object.values(SLOT_STATUS));
    return {
      identifier: identifierOf(params),
      scheduleId: referenceIdOf(params, "schedule", "Schedule"),
      status: code === null ? null : slotStatusKeyOf(code),
      start: parseDateBounds("start", params.get("start") ?? [], timeZone),
      ...parseWindow(params),
    };
  },
  toResource: toSlot,
};

const appointment: ResourceDefinition<AppointmentRecord, AppointmentQuery> = {
  type: "Appointment",
  writable: false,
  searchParams: [
    IDENTIFIER,
    { name: "patient", type: "reference" },
    { name: "slot", type: "reference" },
    { name: "status", type: "token" },
    { name: "date", type: "date" },
  ],
  buildQuery({ params, timeZone }) {
    const raw = single(params, "status");
    return {
      identifier: identifierOf(params),
      medicalRecordId: referenceIdOf(params, "patient", "Patient"),
      slotId: referenceIdOf(params, "slot", "Slot"),
      status: raw === null ? null : parseCode("status", raw, APPOINTMENT_STATUSES),
      start: parseDateBounds("date", params.get("date") ?? [], timeZone),
      ...parseWindow(params),
    };
  },
  toResource: toAppointment,
};

export const DEFINITIONS = {
  Patient: patient,
  Practitioner: practitioner,
  HealthcareService: healthcareService,
  Schedule: schedule,
  Slot: slot,
  Appointment: appointment,
} as const;

export type DeclaredResource = {
  readonly type: ResourceType;
  readonly writable: boolean;
  readonly searchParams: readonly SearchParamDef[];
};

/** Lo que declara `metadata`, en el orden de `RESOURCE_TYPES`. */
export const DECLARED_RESOURCES: readonly DeclaredResource[] = Object.values(DEFINITIONS);
