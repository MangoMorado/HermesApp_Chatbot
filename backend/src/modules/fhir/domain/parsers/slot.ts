import { fhirUnprocessable } from "../fhir-error";
import type { SlotWriteCommand } from "../ports/writers";
import { slotStatusKeyOf } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import {
  assertObject,
  pickKnown,
  readBodyId,
  readReference,
  readSingleIdentifier,
  requireResourceType,
  requireString,
} from "./body";

type SlotPayload = Omit<SlotWriteCommand, "tenantId" | "actor"> & {
  readonly bodyId: string | null;
};

export function parseSlotBody(body: unknown, queryIdentifier: FhirIdentifier): SlotPayload {
  const resource = assertObject(body);
  const fields = pickKnown(
    resource,
    ["resourceType", "id", "identifier", "schedule", "status", "start", "end"],
    ["meta", "text", "extension"],
  );
  requireResourceType(fields, "Slot");
  const startAt = readInstant(fields.start, "start");
  const endAt = readInstant(fields.end, "end");
  if (startAt >= endAt) {
    throw fhirUnprocessable("processing", "start debe ser anterior a end");
  }
  return {
    bodyId: readBodyId(fields.id),
    identifier: readSingleIdentifier(fields.identifier, queryIdentifier),
    scheduleId: readReference(fields.schedule, "Schedule", "schedule"),
    status: readStatus(fields.status),
    startAt,
    endAt,
  };
}

function readStatus(value: unknown): NonNullable<ReturnType<typeof slotStatusKeyOf>> {
  const status = slotStatusKeyOf(requireString(value, "status"));
  if (status === null) {
    throw fhirUnprocessable("processing", "status no pertenece al value set de Slot");
  }
  return status;
}

function readInstant(value: unknown, field: string): Date {
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
