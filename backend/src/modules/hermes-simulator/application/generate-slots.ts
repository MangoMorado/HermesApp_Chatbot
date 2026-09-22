import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { GenerateSlotsInput, WeekdayWindow } from "../domain/entities";
import type { SimScheduleStore, SimSlotGenerator } from "../domain/ports/stores";

const TIME_RE = /^\d{2}:\d{2}$/;

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

function zonedInstant(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00.000Z`);
  return new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

export function createGenerateSimSlots(
  schedules: SimScheduleStore,
  generator: SimSlotGenerator,
  audit: AuditLog,
  clock: Clock,
): (
  input: GenerateSlotsInput & {
    actorSubject: string;
    actorRole: string;
    requestId: string;
    tenantIdTyped: TenantId;
  },
) => Promise<{ created: number }> {
  return async (input) => {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5) {
      throw new ValidationError("duration_minutes invalido", { field: "duration_minutes" });
    }
    if (!Array.isArray(input.windows) || input.windows.length === 0) {
      throw new ValidationError("windows es obligatorio", { field: "windows" });
    }
    for (const window of input.windows) {
      assertWindow(window);
    }
    const schedule = await schedules.get(input.tenantId, input.scheduleId);
    if (!schedule) {
      throw new NotFoundError();
    }
    const created = await generator.generate(input);
    await audit.record({
      tenantId: input.tenantIdTyped,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "sim.slots.generated",
      resourceType: "sim.schedule",
      resourceId: input.scheduleId,
      requestId: input.requestId,
      occurredAt: clock.now(),
    });
    return { created };
  };
}

function assertWindow(window: WeekdayWindow): void {
  if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) {
    throw new ValidationError("weekday invalido", { field: "windows" });
  }
  if (!TIME_RE.test(window.startTime) || !TIME_RE.test(window.endTime)) {
    throw new ValidationError("franja horaria invalida", { field: "windows" });
  }
  if (window.startTime >= window.endTime) {
    throw new ValidationError("start_time debe ser anterior a end_time", { field: "windows" });
  }
}

export function enumerateSlotStarts(
  fromDate: string,
  toDateExclusive: string,
  durationMinutes: number,
  windows: readonly WeekdayWindow[],
  timeZone: string,
): Date[] {
  const starts: Date[] = [];
  for (let date = fromDate; date < toDateExclusive; date = addDays(date, 1)) {
    const dayWindows = windows.filter((window) => window.weekday === weekdayOf(date));
    for (const window of dayWindows) {
      let cursor = zonedInstant(date, window.startTime, timeZone);
      const end = zonedInstant(date, window.endTime, timeZone);
      while (cursor.getTime() + durationMinutes * 60_000 <= end.getTime()) {
        starts.push(cursor);
        cursor = new Date(cursor.getTime() + durationMinutes * 60_000);
      }
    }
  }
  return starts;
}
