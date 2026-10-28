/** Utilidades de fecha del seed. Fechas locales como `YYYY-MM-DD`, horas como `HH:mm`. */

export { addDays, zonedInstant } from "../../src/modules/shared/domain/date-range";

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
