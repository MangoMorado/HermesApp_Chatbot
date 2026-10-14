import { fhirInvalid } from "../fhir-error";
import type { MasterWriteCommand } from "../ports/writers";
import type { FhirIdentifier } from "../resources/types";
import {
  assertNoExtraKeys,
  assertObject,
  readSingleIdentifier,
  requireBoolean,
  requireResourceType,
  requireString,
} from "./body";

type MasterPayload = Omit<MasterWriteCommand, "tenantId" | "actor">;

export function parsePractitionerBody(
  body: unknown,
  queryIdentifier: FhirIdentifier,
): MasterPayload {
  const resource = assertObject(body);
  assertNoExtraKeys(resource, ["resourceType", "id", "identifier", "active", "name"]);
  requireResourceType(resource, "Practitioner");
  return {
    identifier: readSingleIdentifier(resource.identifier, queryIdentifier),
    name: readPractitionerName(resource.name),
    active: requireBoolean(resource.active, "active"),
  };
}

function readPractitionerName(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) {
    throw fhirInvalid("Practitioner.name debe tener una entrada");
  }
  const name = assertObject(value[0]);
  assertNoExtraKeys(name, ["text"]);
  return requireString(name.text, "name.text");
}
