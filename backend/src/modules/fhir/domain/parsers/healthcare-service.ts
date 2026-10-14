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

export function parseHealthcareServiceBody(
  body: unknown,
  queryIdentifier: FhirIdentifier,
): MasterPayload {
  const resource = assertObject(body);
  assertNoExtraKeys(resource, ["resourceType", "id", "identifier", "active", "name"]);
  requireResourceType(resource, "HealthcareService");
  return {
    identifier: readSingleIdentifier(resource.identifier, queryIdentifier),
    name: requireString(resource.name, "name"),
    active: requireBoolean(resource.active, "active"),
  };
}
