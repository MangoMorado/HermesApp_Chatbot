import { parseQueryRange } from "@/modules/shared/domain/date-range";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantSettingsRepository } from "@/modules/tenancy/domain/ports/tenant-settings-repository";
import type { Slot } from "../domain/entities";
import type { ScheduleRepository, SlotRepository } from "../domain/ports/repositories";
import type { ExpireDueRequests } from "./appointment-request-queries";

export type ListScheduleSlotsInput = {
  readonly tenantId: TenantId;
  readonly scheduleId: string;
  readonly fromRaw: string | null;
  readonly toRaw: string | null;
  readonly timeZone: string;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListScheduleSlots = (input: ListScheduleSlotsInput) => Promise<Page<Slot>>;

export function createListScheduleSlots(
  schedules: ScheduleRepository,
  slots: SlotRepository,
  tenantSettings: TenantSettingsRepository,
  expire: ExpireDueRequests,
): ListScheduleSlots {
  return async (input) => {
    const schedule = await schedules.get(input.tenantId, input.scheduleId);
    if (!schedule) {
      throw new NotFoundError();
    }
    const settings = await tenantSettings.get(input.tenantId);
    if (!settings) {
      throw new NotFoundError();
    }
    const range = parseQueryRange(
      input.fromRaw,
      input.toRaw,
      input.timeZone,
      settings.maxQueryRangeDays,
    );
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    await expire(input.tenantId);
    return slots.listBySchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      from: range.from,
      to: range.to,
      cursor: input.cursor,
      limit,
    });
  };
}
