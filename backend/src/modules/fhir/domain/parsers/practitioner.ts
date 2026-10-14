import { fhirUnprocessable } from "../fhir-error";
import type { MasterWriteCommand } from "../ports/writers";
import type { FhirIdentifier } from "../resources/types";
import {
  assertObject,
  pickKnown,
  readBodyId,
  readSingleIdentifier,
  requireBoolean,
  requireResourceType,
  requireString,
} from "./body";

type MasterPayload = Omit<MasterWriteCommand, "tenantId" | "actor"> & {
  readonly bodyId: string | null;
};

export function parsePractitionerBody(
  body: unknown,
  queryIdentifier: FhirIdentifier,
): MasterPayload {
  const resource = assertObject(body);
  const fields = pickKnown(
    resource,
    ["resourceType", "id", "identifier", "active", "name"],
    ["meta", "text", "extension"],
  );
  requireResourceType(fields, "Practitioner");
  return {
    bodyId: readBodyId(fields.id),
    identifier: readSingleIdentifier(fields.identifier, queryIdentifier),
    name: readPractitionerName(fields.name),
    active: requireBoolean(fields.active, "active"),
  };
}

function readPractitionerName(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) {
    throw fhirUnprocessable("processing", "Practitioner.name debe tener una entrada");
  }
  if (value[0] === null || typeof value[0] !== "object" || Array.isArray(value[0])) {
    throw fhirUnprocessable("processing", "Practitioner.name debe tener una entrada");
  }
  const name = pickKnown(
    value[0] as Record<string, unknown>,
    ["text"],
    ["use", "prefix", "suffix", "period", "extension"],
  );
  return requireString(name.text, "name.text");
}
