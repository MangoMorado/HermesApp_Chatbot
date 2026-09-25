/** Formato de presentación para el tablero; el valor ISO original va en `dateTime`. */
const day = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "2-digit", month: "short" });

/** «mar 22 sep»: sin comas ni «de» para que quepa en una celda. */
function shortDay(date: Date): string {
  const parts = day.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value.replace(".", "") ?? "";
  return `${pick("weekday")} ${pick("day")} ${pick("month").slice(0, 3)}`;
}
const time = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function splitDateTime(iso: unknown): { day: string; time: string; iso: string } | null {
  if (typeof iso !== "string" || !iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return { day: shortDay(date), time: time.format(date), iso };
}

export function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

/** Id abreviado para celdas estrechas; el id completo queda en `title`. */
export function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** Día de un instante ISO («mar 22 sep»), para agrupar filas del tablero. */
export function dayOf(value: unknown): string {
  return splitDateTime(value)?.day ?? "Sin fecha";
}
