import { parseQueryRange } from "@/modules/shared/domain/date-range";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantSettingsRepository } from "@/modules/tenancy/domain/ports/tenant-settings-repository";
import type { Appointment } from "../domain/entities";
import type { AppointmentRepository, ScheduleRepository } from "../domain/ports/repositories";

export type ListAppointmentsInput = {
  readonly tenantId: TenantId;
  readonly scheduleId: string;
  readonly fromRaw: string | null;
  readonly toRaw: string | null;
  readonly timeZone: string;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListAppointments = (input: ListAppointmentsInput) => Promise<Page<Appointment>>;

export function createListAppointments(
  schedules: ScheduleRepository,
  appointments: AppointmentRepository,
  tenantSettings: TenantSettingsRepository,
): ListAppointments {
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
    return appointments.listBySchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      from: range.from,
      to: range.to,
      cursor: input.cursor,
      limit,
    });
  };
}
