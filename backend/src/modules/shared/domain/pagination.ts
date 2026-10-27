import { ValidationError } from "./validation-error";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** Posicion del ultimo elemento servido: clave de orden + id como desempate. */
export type CursorPosition = { readonly key: string; readonly id: string };

export type Page<T> = { readonly data: readonly T[]; readonly nextCursor: string | null };

export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") {
    return DEFAULT_PAGE_LIMIT;
  }
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new ValidationError(`limit debe ser un entero entre 1 y ${MAX_PAGE_LIMIT}`, {
      field: "limit",
      max: MAX_PAGE_LIMIT,
    });
  }
  return value;
}

function stripTrailingEquals(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === "=") {
    end -= 1;
  }
  return value.slice(0, end);
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCodePoint(byte);
  }
  return stripTrailingEquals(btoa(binary).replaceAll("+", "-").replaceAll("/", "_"));
}

function fromBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0));
}

export function encodeCursor(position: CursorPosition): string {
  return toBase64Url(JSON.stringify([position.key, position.id]));
}

export function decodeCursor(raw: string): CursorPosition {
  const invalid = new ValidationError("cursor invalido", { field: "cursor" });
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw invalid;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(raw));
  } catch {
    throw invalid;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw invalid;
  }
  return { key: parsed[0], id: parsed[1] };
}

/**
 * Arma una pagina a partir de `limit + 1` filas: si sobra una, hay pagina siguiente
 * y el cursor apunta al ultimo elemento servido.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  positionOf: (row: T) => CursorPosition,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last !== undefined ? encodeCursor(positionOf(last)) : null,
  };
}

/** Ventana por desplazamiento (FHIR `_count`/`_offset`). REST sigue paginando por cursor. */
export type OffsetWindow = { readonly offset: number; readonly limit: number };

export type OffsetPage<T> = { readonly data: readonly T[]; readonly total: number };
