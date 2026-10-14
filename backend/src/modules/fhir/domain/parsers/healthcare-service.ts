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

export function parseHealthcareServiceBody(
  body: unknown,
  queryIdentifier: FhirIdentifier,
): MasterPayload {
  const resource = assertObject(body);
  const fields = pickKnown(
    resource,
    ["resourceType", "id", "identifier", "active", "name"],
    ["meta", "text", "extension"],
  );
  requireResourceType(fields, "HealthcareService");
  return {
    bodyId: readBodyId(fields.id),
    identifier: readSingleIdentifier(fields.identifier, queryIdentifier),
    name: requireString(fields.name, "name"),
    active: requireBoolean(fields.active, "active"),
  };
}
