import { ValidationError } from "./validation-error";

export type QueryRange = {
  readonly from: Date;
  readonly to: Date;
};

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

/** Instante UTC correspondiente a una hora local (`HH:mm`) en la zona dada. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00.000Z`);
  return new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
}

/** Instante UTC del inicio del dia local (`YYYY-MM-DD`) en la zona dada. */
export function startOfDayInZone(date: string, timeZone: string): Date {
  return zonedInstant(date, "00:00", timeZone);
}

/** Suma dias de calendario a una fecha `YYYY-MM-DD` (aritmetica UTC). */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Interpreta `from`/`to` ISO 8601. Con offset se usan tal cual; una fecha sin hora
 * es el inicio del dia en `timeZone`. `to` es exclusivo. El rango no puede superar
 * `maxDays` (tope del tenant).
 */
export function parseQueryRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  timeZone: string,
  maxDays: number,
): QueryRange {
  if (!fromRaw || !toRaw) {
    throw new ValidationError("from y to son obligatorios", { fields: ["from", "to"] });
  }

  const from = parseBound(fromRaw, timeZone, "from");
  const to = parseBound(toRaw, timeZone, "to");
  if (from.getTime() >= to.getTime()) {
    throw new ValidationError("from debe ser anterior a to", { fields: ["from", "to"] });
  }

  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) {
    throw new ValidationError(`El rango supera el tope de ${maxDays} dias`, {
      field: "range",
      max_query_range_days: maxDays,
    });
  }

  return { from, to };
}

function parseBound(raw: string, timeZone: string, field: string): Date {
  if (DATE_ONLY.test(raw)) {
    return startOfDayInZone(raw, timeZone);
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) {
    throw new ValidationError(`${field} no es una fecha ISO 8601 valida`, { field });
  }
  return instant;
}
