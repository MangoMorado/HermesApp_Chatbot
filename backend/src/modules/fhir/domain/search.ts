import { startOfDayInZone } from "@/modules/shared/domain/date-range";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type OffsetWindow,
} from "@/modules/shared/domain/pagination";
import { fhirInvalid, fhirNotSupported } from "./fhir-error";
import type { DateBound } from "./ports/sources";
import type { ResourceType } from "./profiles";
import type { FhirIdentifier } from "./resources/types";

/** Parametros de busqueda tal como llegan: nombre -> valores en orden. */
export type SearchParams = ReadonlyMap<string, readonly string[]>;

const CONTROL_PARAMS: readonly string[] = ["_count", "_offset"];

export function collectParams(entries: Iterable<readonly [string, string]>): SearchParams {
  const collected = new Map<string, string[]>();
  for (const [name, value] of entries) {
    collected.set(name, [...(collected.get(name) ?? []), value]);
  }
  return collected;
}

/** Un parametro que el recurso no declara no se ignora: responde `not-supported`. */
export function assertSupported(params: SearchParams, supported: readonly string[]): void {
  for (const name of params.keys()) {
    if (!supported.includes(name) && !CONTROL_PARAMS.includes(name)) {
      throw fhirNotSupported(`Parametro de busqueda no soportado: ${name}`);
    }
  }
}

/** Valor unico de un parametro. Repetido o vacio -> `invalid`. */
export function single(params: SearchParams, name: string): string | null {
  const values = params.get(name);
  if (!values) {
    return null;
  }
  const [value] = values;
  if (values.length !== 1 || value === undefined || value === "") {
    throw fhirInvalid(`${name} admite un solo valor no vacio`);
  }
  return value;
}

export function parseToken(name: string, raw: string): FhirIdentifier {
  const at = raw.indexOf("|");
  const system = at < 0 ? "" : raw.slice(0, at);
  const value = at < 0 ? "" : raw.slice(at + 1);
  if (system === "" || value === "") {
    throw fhirInvalid(`${name} debe tener la forma system|value`);
  }
  return { system, value };
}

export function parseReference(
  name: string,
  raw: string,
  types: readonly ResourceType[],
): { readonly type: ResourceType; readonly id: string } {
  const [type, id, ...rest] = raw.split("/");
  const known = types.find((candidate) => candidate === type);
  if (!known || !id || rest.length > 0) {
    const shapes = types.map((candidate) => `${candidate}/{id}`).join(" o ");
    throw fhirInvalid(`${name} debe ser una referencia ${shapes}`);
  }
  return { type: known, id };
}

export function parseBoolean(name: string, raw: string): boolean {
  if (raw !== "true" && raw !== "false") {
    throw fhirInvalid(`${name} debe ser true o false`);
  }
  return raw === "true";
}

export function parseCode<T extends string>(name: string, raw: string, allowed: readonly T[]): T {
  const code = allowed.find((candidate) => candidate === raw);
  if (code === undefined) {
    throw fhirInvalid(`${name} debe ser uno de: ${allowed.join(", ")}`);
  }
  return code;
}

const INTEGER = /^\d+$/;
/** Tope de `skip` en Prisma (entero de 32 bits). */
const MAX_OFFSET = 2_147_483_647;

export function parseWindow(params: SearchParams): OffsetWindow {
  const count = single(params, "_count");
  const offset = single(params, "_offset");
  if (count !== null && (!INTEGER.test(count) || Number(count) < 1)) {
    throw fhirInvalid("_count debe ser un entero mayor o igual a 1");
  }
  if (offset !== null && (!INTEGER.test(offset) || Number(offset) > MAX_OFFSET)) {
    throw fhirInvalid(`_offset debe ser un entero entre 0 y ${MAX_OFFSET}`);
  }
  return {
    offset: offset === null ? 0 : Number(offset),
    limit: count === null ? DEFAULT_PAGE_LIMIT : Math.min(Number(count), MAX_PAGE_LIMIT),
  };
}

type Prefix = "eq" | "ge" | "gt" | "le" | "lt";

const PREFIXED = /^(eq|ge|gt|le|lt)?(.*)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/;
const INSTANT_OFFSET = /^(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isInstant(value: string): boolean {
  if (value.length < 12 || value.charAt(10) !== "T") {
    return false;
  }
  if (!DATE_ONLY.test(value.slice(0, 10))) {
    return false;
  }
  const rest = value.slice(11);
  const offsetAt = rest.endsWith("Z")
    ? rest.length - 1
    : Math.max(rest.lastIndexOf("+"), rest.lastIndexOf("-"));
  if (offsetAt < 1) {
    return false;
  }
  return INSTANT_TIME.test(rest.slice(0, offsetAt)) && INSTANT_OFFSET.test(rest.slice(offsetAt));
}

/** Rango de anios aceptado: `Date.UTC` mapea 0-99 a 1900-1999 y fuera de el no hay citas reales. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

function isSaneYear(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/** `2026-02-31` no existe: `Date` lo desbordaria a marzo sin avisar. */
function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function dayBounds(prefix: Prefix, date: string, timeZone: string): DateBound[] {
  const start = startOfDayInZone(date, timeZone);
  const end = startOfDayInZone(nextDay(date), timeZone);
  switch (prefix) {
    case "eq":
      return [
        { op: "ge", at: start },
        { op: "lt", at: end },
      ];
    case "ge":
      return [{ op: "ge", at: start }];
    case "gt":
      return [{ op: "ge", at: end }];
    case "le":
      return [{ op: "lt", at: end }];
    case "lt":
      return [{ op: "lt", at: start }];
  }
}

function instantBounds(prefix: Prefix, at: Date): DateBound[] {
  if (prefix === "eq") {
    return [
      { op: "ge", at },
      { op: "le", at },
    ];
  }
  return [{ op: prefix, at }];
}

function boundsOf(name: string, raw: string, timeZone: string): DateBound[] {
  const invalid = fhirInvalid(
    `${name} debe ser una fecha (YYYY-MM-DD) o un instante con offset, con prefijo opcional eq, ge, gt, le o lt`,
  );
  const match = PREFIXED.exec(raw);
  const prefix: Prefix = (match?.[1] as Prefix | undefined) ?? "eq";
  // Un `+` sin codificar en la URL llega como espacio antes del offset.
  const value = (match?.[2] ?? "").replace(/ (\d{2}:\d{2})$/, "+$1");
  if (DATE_ONLY.test(value)) {
    if (!isSaneYear(value) || !isRealDate(value)) {
      throw invalid;
    }
    return dayBounds(prefix, value, timeZone);
  }
  // `new Date` desbordaria 2026-02-31 a marzo sin avisar: se valida el dia del instante.
  const day = value.slice(0, 10);
  const at = isInstant(value) && isSaneYear(day) && isRealDate(day) ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) {
    throw invalid;
  }
  return instantBounds(prefix, at);
}

/** Cotas de un parametro `date`; puede repetirse para formar un rango. */
export function parseDateBounds(
  name: string,
  values: readonly string[],
  timeZone: string,
): DateBound[] {
  return values.flatMap((raw) => boundsOf(name, raw, timeZone));
}
