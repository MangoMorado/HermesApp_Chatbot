import type { SlotRecord } from "../ports/sources";
import { reference, SLOT_STATUS } from "../profiles";
import type { FhirSlot } from "../resources/types";

export function toSlot(record: SlotRecord): FhirSlot {
  return {
    resourceType: "Slot",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    schedule: reference("Schedule", record.scheduleId),
    status: SLOT_STATUS[record.status],
    start: record.startAt.toISOString(),
    end: record.endAt.toISOString(),
  };
}
