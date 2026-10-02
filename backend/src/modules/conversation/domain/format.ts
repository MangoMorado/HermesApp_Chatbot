import { startOfDayInZone } from "@/modules/shared/domain/date-range";

/** Formatos de fecha del chat (datos de dominio, no textos de bot-config). */
const LOCALE = "es-CO";
const DAY_MS = 86_400_000;

export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function formatDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}

export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function formatWhen(instant: Date, timeZone: string): string {
  return `${formatDay(instant, timeZone)}, ${formatTime(instant, timeZone)}`;
}

/** Inicio y fin (exclusivo) del dia local `YYYY-MM-DD` en la zona. */
export function dayBounds(date: string, timeZone: string): { from: Date; to: Date } {
  const next = new Date(new Date(`${date}T00:00:00.000Z`).getTime() + DAY_MS);
  return {
    from: startOfDayInZone(date, timeZone),
    to: startOfDayInZone(next.toISOString().slice(0, 10), timeZone),
  };
}

export function formatLocalDay(date: string, timeZone: string): string {
  const { from } = dayBounds(date, timeZone);
  return formatDay(new Date(from.getTime() + DAY_MS / 2), timeZone);
}

/** Eco del documento en el historial: tipo y ultimos 4 caracteres. */
export function normalizeDocument(raw: string): string {
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

export function maskDocument(type: string | undefined, raw: string): string {
  const clean = normalizeDocument(raw);
  return `${type ?? ""} ••••${clean.slice(-4)}`.trim();
}
