import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Schedule } from "../domain/entities";
import type { ScheduleRepository } from "../domain/ports/repositories";

export type ListSchedulesInput = {
  readonly tenantId: TenantId;
  readonly practitionerId?: string;
  readonly healthcareServiceId?: string;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListSchedules = (input: ListSchedulesInput) => Promise<Page<Schedule>>;

export function createListSchedules(repo: ScheduleRepository): ListSchedules {
  return async (input) => {
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return repo.list({
      tenantId: input.tenantId,
      practitionerId: input.practitionerId,
      healthcareServiceId: input.healthcareServiceId,
      active: input.active,
      cursor: input.cursor,
      limit,
    });
  };
}
