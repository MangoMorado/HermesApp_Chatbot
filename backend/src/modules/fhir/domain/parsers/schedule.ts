import { fhirUnprocessable } from "../fhir-error";
import type { ScheduleWriteCommand } from "../ports/writers";
import type { FhirIdentifier } from "../resources/types";
import {
  assertObject,
  pickKnown,
  readBodyId,
  readReference,
  readSingleIdentifier,
  requireBoolean,
  requireResourceType,
} from "./body";

type SchedulePayload = Omit<ScheduleWriteCommand, "tenantId" | "actor"> & {
  readonly bodyId: string | null;
};

export function parseScheduleBody(body: unknown, queryIdentifier: FhirIdentifier): SchedulePayload {
  const resource = assertObject(body);
  const fields = pickKnown(
    resource,
    ["resourceType", "id", "identifier", "active", "actor"],
    ["meta", "text", "extension"],
  );
  requireResourceType(fields, "Schedule");
  const actors = readActors(fields.actor);
  return {
    bodyId: readBodyId(fields.id),
    identifier: readSingleIdentifier(fields.identifier, queryIdentifier),
    active: requireBoolean(fields.active, "active"),
    ...actors,
  };
}

function readActors(value: unknown): {
  practitionerId: string;
  healthcareServiceId: string;
} {
  if (!Array.isArray(value) || value.length !== 2) {
    throw fhirUnprocessable("processing", "Schedule.actor debe tener profesional y servicio");
  }
  const references = value.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw fhirUnprocessable("processing", "Schedule.actor debe contener referencias");
    }
    const row = item as Record<string, unknown>;
    pickKnown(row, ["reference"], ["display", "type", "extension"]);
    return row;
  });
  const practitioner = references.filter(
    (item) => typeof item.reference === "string" && item.reference.startsWith("Practitioner/"),
  );
  const service = references.filter(
    (item) => typeof item.reference === "string" && item.reference.startsWith("HealthcareService/"),
  );
  if (practitioner.length !== 1 || service.length !== 1) {
    throw fhirUnprocessable("processing", "Schedule.actor debe tener profesional y servicio");
  }
  return {
    practitionerId: readReference(practitioner[0], "Practitioner", "actor"),
    healthcareServiceId: readReference(service[0], "HealthcareService", "actor"),
  };
}
