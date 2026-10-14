import { fhirUnprocessable } from "../fhir-error";
import type { ResolutionReasonCode } from "../profiles";
import { isHermesBusinessSystem, REPLACES_APPOINTMENT, RESOLUTION_REASONS } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import {
  assertObject,
  pickKnown,
  readBodyId,
  readIdentifierArray,
  readReference,
  requireResourceType,
  requireString,
} from "./body";

export type AppointmentResolutionBody = {
  readonly bodyId: string | null;
  readonly status: "booked" | "cancelled";
  readonly businessIdentifier: FhirIdentifier | null;
  readonly identifier: FhirIdentifier | null;
  readonly reason: ResolutionReasonCode | null;
  readonly start: Date | null;
  readonly end: Date | null;
  readonly slotId: string | null;
  readonly patientId: string | null;
  readonly practitionerId: string | null;
  readonly serviceId: string | null;
  readonly replacesAppointmentId: string | null;
};

const KNOWN = [
  "resourceType",
  "id",
  "identifier",
  "status",
  "start",
  "end",
  "slot",
  "participant",
  "extension",
  "cancelationReason",
] as const;

/** Cuerpo de `PUT /fhir/Appointment/{id}`: solo cambia el estado y, al aprobar, el identificador. */
export function parseAppointmentResolution(body: unknown): AppointmentResolutionBody {
  const fields = pickKnown(assertObject(body), KNOWN, ["meta", "text"]);
  requireResourceType(fields, "Appointment");
  const status = readStatus(fields.status);
  if (status === "booked" && fields.cancelationReason !== undefined) {
    throw fhirUnprocessable("structure", "Campo no soportado: cancelationReason");
  }
  const identifier = optionalIdentifier(fields.identifier);
  if (status === "booked") {
    return { ...base(fields, status, readBusiness(identifier), null), identifier };
  }
  return {
    ...base(fields, status, null, readReason(fields.cancelationReason)),
    identifier,
  };
}

function base(
  fields: Record<string, unknown>,
  status: "booked" | "cancelled",
  businessIdentifier: FhirIdentifier | null,
  reason: ResolutionReasonCode | null,
): Omit<AppointmentResolutionBody, "identifier"> {
  const actors = readActors(fields.participant);
  return {
    bodyId: readBodyId(fields.id),
    status,
    businessIdentifier,
    reason,
    start: optionalInstant(fields.start, "start"),
    end: optionalInstant(fields.end, "end"),
    slotId: fields.slot === undefined ? null : readReference(fields.slot, "Slot", "slot"),
    patientId: actors?.patientId ?? null,
    practitionerId: actors?.practitionerId ?? null,
    serviceId: actors?.serviceId ?? null,
    replacesAppointmentId: readReplaces(fields.extension),
  };
}

function readStatus(value: unknown): "booked" | "cancelled" {
  const status = requireString(value, "status");
  if (status !== "booked" && status !== "cancelled") {
    throw fhirUnprocessable("processing", "status debe ser booked o cancelled");
  }
  return status;
}

function readBusiness(identifier: FhirIdentifier | null): FhirIdentifier {
  if (identifier === null || !isHermesBusinessSystem(identifier.system)) {
    throw fhirUnprocessable("processing", "identifier de negocio es obligatorio");
  }
  return identifier;
}

function optionalIdentifier(value: unknown): FhirIdentifier | null {
  if (value === undefined) {
    return null;
  }
  const identifiers = readIdentifierArray(value);
  if (identifiers.length !== 1) {
    throw fhirUnprocessable("processing", "identifier debe tener una sola entrada");
  }
  return identifiers[0] ?? null;
}

function optionalInstant(value: unknown, field: string): Date | null {
  if (value === undefined) {
    return null;
  }
  const instant = requireString(value, field);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(instant)) {
    throw fhirUnprocessable("processing", `${field} debe incluir offset`);
  }
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    throw fhirUnprocessable("processing", `${field} debe ser una fecha valida`);
  }
  return parsed;
}

function readReason(value: unknown): ResolutionReasonCode | null {
  if (value === undefined) {
    return null;
  }
  const row = pickKnown(assertObject(value), ["coding"], ["text", "extension"]);
  if (!Array.isArray(row.coding) || row.coding.length === 0) {
    throw fhirUnprocessable("processing", "cancelationReason.coding es obligatorio");
  }
  const coding = pickKnown(
    assertObject(row.coding[0]),
    ["code"],
    ["system", "display", "extension"],
  );
  const code = requireString(coding.code, "cancelationReason.coding.code");
  if (!(RESOLUTION_REASONS as readonly string[]).includes(code)) {
    throw fhirUnprocessable("processing", "motivo no soportado");
  }
  return code as ResolutionReasonCode;
}

function readReplaces(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw fhirUnprocessable("structure", "extension debe ser una lista");
  }
  let replaces: string | null = null;
  for (const item of value) {
    const id = replacesId(item);
    if (id === null) {
      continue;
    }
    if (replaces !== null) {
      throw fhirUnprocessable("processing", "replaces esta repetido");
    }
    replaces = id;
  }
  return replaces;
}

function replacesId(item: unknown): string | null {
  const row = assertObject(item);
  if (row.url !== REPLACES_APPOINTMENT) {
    return null;
  }
  return readReference(row.valueReference, "Appointment", "extension.valueReference");
}

type Actors = { patientId: string; practitionerId: string; serviceId: string };

function readActors(value: unknown): Actors | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw fhirUnprocessable("processing", "participant debe ser una lista");
  }
  const actors: Actors = { patientId: "", practitionerId: "", serviceId: "" };
  for (const item of value) {
    const actor = readActor(item);
    if (actors[actor.field] !== "") {
      throw fhirUnprocessable("structure", "participante repetido");
    }
    actors[actor.field] = actor.id;
  }
  if (!actors.patientId || !actors.practitionerId || !actors.serviceId) {
    throw fhirUnprocessable(
      "processing",
      "participant debe incluir paciente, profesional y servicio",
    );
  }
  return actors;
}

const ACTORS = [
  ["Patient/", "patientId"],
  ["Practitioner/", "practitionerId"],
  ["HealthcareService/", "serviceId"],
] as const;

function readActor(item: unknown): { field: keyof Actors; id: string } {
  const row = pickKnown(
    assertObject(item),
    ["actor"],
    ["status", "type", "required", "period", "extension"],
  );
  const actor = pickKnown(assertObject(row.actor), ["reference"], ["display", "type", "extension"]);
  const reference = requireString(actor.reference, "participant.actor.reference");
  const match = ACTORS.find(([prefix]) => reference.startsWith(prefix));
  const id = match ? reference.slice(match[0].length) : "";
  if (!match || id.length === 0 || id.includes("/")) {
    throw fhirUnprocessable(
      "processing",
      "participant.actor no es paciente, profesional o servicio",
    );
  }
  return { field: match[1], id };
}
