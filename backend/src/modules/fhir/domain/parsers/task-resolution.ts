import { fhirUnprocessable } from "../fhir-error";
import type { ResolutionReasonCode } from "../profiles";
import { RESOLUTION_REASONS } from "../profiles";
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

export type TaskResolutionBody = {
  readonly bodyId: string | null;
  readonly status: "completed" | "rejected";
  readonly identifier: FhirIdentifier | null;
  readonly reason: ResolutionReasonCode | null;
  readonly focusAppointmentId: string | null;
  readonly patientId: string | null;
};

const KNOWN = [
  "resourceType",
  "id",
  "identifier",
  "status",
  "intent",
  "focus",
  "for",
  "statusReason",
] as const;

/** Cuerpo de `PUT /fhir/Task/{id}`: `completed` aprueba la cancelación y `rejected` la rechaza. */
export function parseTaskResolution(body: unknown): TaskResolutionBody {
  const fields = pickKnown(assertObject(body), KNOWN, ["meta", "text", "extension"]);
  requireResourceType(fields, "Task");
  const status = readStatus(fields.status);
  readIntent(fields.intent);
  if (status === "completed" && fields.statusReason !== undefined) {
    throw fhirUnprocessable("structure", "Campo no soportado: statusReason");
  }
  return {
    bodyId: readBodyId(fields.id),
    status,
    identifier: optionalIdentifier(fields.identifier),
    reason: status === "rejected" ? readReason(fields.statusReason) : null,
    focusAppointmentId:
      fields.focus === undefined ? null : readReference(fields.focus, "Appointment", "focus"),
    patientId: fields.for === undefined ? null : readReference(fields.for, "Patient", "for"),
  };
}

function readStatus(value: unknown): "completed" | "rejected" {
  const status = requireString(value, "status");
  if (status !== "completed" && status !== "rejected") {
    throw fhirUnprocessable("processing", "status debe ser completed o rejected");
  }
  return status;
}

function readIntent(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (value !== "proposal") {
    throw fhirUnprocessable("processing", "intent debe ser proposal");
  }
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

function readReason(value: unknown): ResolutionReasonCode | null {
  if (value === undefined) {
    return null;
  }
  const row = pickKnown(assertObject(value), ["coding"], ["text", "extension"]);
  if (!Array.isArray(row.coding) || row.coding.length === 0) {
    throw fhirUnprocessable("processing", "statusReason.coding es obligatorio");
  }
  const coding = pickKnown(
    assertObject(row.coding[0]),
    ["code"],
    ["system", "display", "extension"],
  );
  const code = requireString(coding.code, "statusReason.coding.code");
  if (!(RESOLUTION_REASONS as readonly string[]).includes(code)) {
    throw fhirUnprocessable("processing", "motivo no soportado");
  }
  return code as ResolutionReasonCode;
}
