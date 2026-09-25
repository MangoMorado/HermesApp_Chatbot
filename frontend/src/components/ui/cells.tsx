import { shortId, splitDateTime } from "@/lib/format";

/** Hora en paleta neutra del tablero; el instante exacto queda en `dateTime` y `title`. */
export function Time({ value }: { readonly value: unknown }) {
  const parts = splitDateTime(value);
  if (!parts) {
    return <span className="cell-muted">—</span>;
  }
  return (
    <time className="tile" dateTime={parts.iso} title={parts.iso}>
      {parts.time}
    </time>
  );
}

/** Día y hora en una línea, para listas sin agrupar (historial de citas). */
export function When({ value }: { readonly value: unknown }) {
  const parts = splitDateTime(value);
  if (!parts) {
    return <span className="cell-muted">—</span>;
  }
  return (
    <time className="when" dateTime={parts.iso} title={parts.iso}>
      <span className="day data">{parts.day}</span>
      <span className="tile">{parts.time}</span>
    </time>
  );
}

/** Id abreviado en fuente de datos; el completo va en `title` para copiarlo. */
export function Id({ value, label }: { readonly value: unknown; readonly label?: string }) {
  const id = typeof value === "string" ? value : "";
  if (!id) {
    return <span className="cell-muted">—</span>;
  }
  return (
    <span className={label ? "data" : "data cell-id"} title={id}>
      {label || shortId(id)}
    </span>
  );
}
