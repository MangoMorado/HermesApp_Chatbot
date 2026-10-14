import { fhirInvalid } from "../fhir-error";
import type { SlotWriteCommand } from "../ports/writers";
import { slotStatusKeyOf } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import {
  assertNoExtraKeys,
  assertObject,
  readReference,
  readSingleIdentifier,
  requireResourceType,
  requireString,
} from "./body";

type SlotPayload = Omit<SlotWriteCommand, "tenantId" | "actor">;

export function parseSlotBody(body: unknown, queryIdentifier: FhirIdentifier): SlotPayload {
  const resource = assertObject(body);
  assertNoExtraKeys(resource, [
    "resourceType",
    "id",
    "identifier",
    "schedule",
    "status",
    "start",
    "end",
  ]);
  requireResourceType(resource, "Slot");
  const startAt = readInstant(resource.start, "start");
  const endAt = readInstant(resource.end, "end");
  if (startAt >= endAt) {
    throw fhirInvalid("start debe ser anterior a end");
  }
  return {
    identifier: readSingleIdentifier(resource.identifier, queryIdentifier),
    scheduleId: readReference(resource.schedule, "Schedule", "schedule"),
    status: readStatus(resource.status),
    startAt,
    endAt,
  };
}

function readStatus(value: unknown): NonNullable<ReturnType<typeof slotStatusKeyOf>> {
  const status = slotStatusKeyOf(requireString(value, "status"));
  if (status === null) {
    throw fhirInvalid("status no pertenece al value set de Slot");
  }
  return status;
}

function readInstant(value: unknown, field: string): Date {
  const instant = requireString(value, field);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(instant)) {
    throw fhirInvalid(`${field} debe incluir offset`);
  }
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    throw fhirInvalid(`${field} debe ser una fecha valida`);
  }
  return parsed;
}
