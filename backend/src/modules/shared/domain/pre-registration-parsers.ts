/**
 * Parsers de campos de pre-registro compartidos entre la validacion autoritativa
 * (patients) y la UX del chat (conversation). Devuelven el valor normalizado o
 * `null` si no es valido; el llamador decide si lanza o sigue.
 */

const NAME = /^\p{L}[\p{L}' -]{0,99}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE = /^3\d{9}$/;

/** Forma minima de correo sin regex (evita backtracking super-lineal). */
export function isEmailShape(value: string): boolean {
  const at = value.indexOf("@");
  if (at < 1 || value.includes(" ") || value.includes("\t")) {
    return false;
  }
  if (value.includes("@", at + 1)) {
    return false;
  }
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

export function parsePersonName(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  return NAME.test(value) ? value : null;
}

/** Fecha AAAA-MM-DD real, no futura y no anterior a 1900-01-01. */
export function parsePastDate(raw: string, today: string): string | null {
  const value = raw.trim();
  if (!DATE.test(value) || value > today || value < "1900-01-01") {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Celular colombiano de 10 digitos; acepta prefijo +57. */
export function parseMobilePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
  return MOBILE.test(national) ? national : null;
}

export function parseEmailAddress(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return isEmailShape(value) && value.length <= 254 ? value : null;
}
