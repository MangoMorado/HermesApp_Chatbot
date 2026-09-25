import { parseQueryRange } from "@/modules/shared/domain/date-range";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantSettingsRepository } from "@/modules/tenancy/domain/ports/tenant-settings-repository";
import type { Slot } from "../domain/entities";
import type { SlotRepository } from "../domain/ports/repositories";
import type { ExpireDueRequests } from "./appointment-request-queries";

export type ListAvailabilityInput = {
  readonly tenantId: TenantId;
  readonly fromRaw: string | null;
  readonly toRaw: string | null;
  readonly timeZone: string;
  readonly healthcareServiceId?: string;
  readonly practitionerId?: string;
  readonly scheduleId?: string;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListAvailability = (input: ListAvailabilityInput) => Promise<Page<Slot>>;

export function createListAvailability(
  slots: SlotRepository,
  tenantSettings: TenantSettingsRepository,
  expire: ExpireDueRequests,
): ListAvailability {
  return async (input) => {
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
    return slots.listAvailability({
      tenantId: input.tenantId,
      from: range.from,
      to: range.to,
      healthcareServiceId: input.healthcareServiceId,
      practitionerId: input.practitionerId,
      scheduleId: input.scheduleId,
      cursor: input.cursor,
      limit,
    });
  };
}
