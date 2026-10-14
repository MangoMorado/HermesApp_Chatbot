import { fhirInvalid } from "../fhir-error";
import type { ScheduleWriteCommand } from "../ports/writers";
import type { FhirIdentifier } from "../resources/types";
import {
  assertNoExtraKeys,
  assertObject,
  readReference,
  readSingleIdentifier,
  requireBoolean,
  requireResourceType,
} from "./body";

type SchedulePayload = Omit<ScheduleWriteCommand, "tenantId" | "actor">;

export function parseScheduleBody(body: unknown, queryIdentifier: FhirIdentifier): SchedulePayload {
  const resource = assertObject(body);
  assertNoExtraKeys(resource, ["resourceType", "id", "identifier", "active", "actor"]);
  requireResourceType(resource, "Schedule");
  const actors = readActors(resource.actor);
  return {
    identifier: readSingleIdentifier(resource.identifier, queryIdentifier),
    active: requireBoolean(resource.active, "active"),
    ...actors,
  };
}

function readActors(value: unknown): {
  practitionerId: string;
  healthcareServiceId: string;
} {
  if (!Array.isArray(value) || value.length !== 2) {
    throw fhirInvalid("Schedule.actor debe tener profesional y servicio");
  }
  const references = value.map((item) => {
    const row = assertObject(item);
    assertNoExtraKeys(row, ["reference"]);
    return row.reference;
  });
  const practitioner = references.filter(
    (reference) => typeof reference === "string" && reference.startsWith("Practitioner/"),
  );
  const service = references.filter(
    (reference) => typeof reference === "string" && reference.startsWith("HealthcareService/"),
  );
  if (practitioner.length !== 1 || service.length !== 1) {
    throw fhirInvalid("Schedule.actor debe tener profesional y servicio");
  }
  return {
    practitionerId: readReference({ reference: practitioner[0] }, "Practitioner", "actor"),
    healthcareServiceId: readReference({ reference: service[0] }, "HealthcareService", "actor"),
  };
}
