import type { PreRegField } from "./types";

/**
 * Validacion campo a campo para la UX del chat. La autoritativa es la de patients
 * (refinamiento 14); si cambian las reglas, cambian en ambos lados.
 */
export const PREREG_FIELDS: readonly PreRegField[] = [
  "given_names",
  "family_names",
  "birth_date",
  "phone",
  "email",
];

const NAME = /^\p{L}[\p{L}' -]{0,99}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE = /^3\d{9}$/;

/** Misma forma que patients (refinamiento 14), sin regex con backtracking. */
function isEmailShape(value: string): boolean {
  const at = value.indexOf("@");
  if (at < 1 || value.includes(" ") || value.includes("\t")) {
    return false;
  }
  if (value.indexOf("@", at + 1) !== -1) {
    return false;
  }
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

export function nextField(field: PreRegField): PreRegField | null {
  return PREREG_FIELDS[PREREG_FIELDS.indexOf(field) + 1] ?? null;
}

function parseName(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  return NAME.test(value) ? value : null;
}

function parseDate(raw: string, today: string): string | null {
  const value = raw.trim();
  if (!DATE.test(value) || value > today || value < "1900-01-01") {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : null;
}

function parsePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
  return MOBILE.test(national) ? national : null;
}

function parseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return isEmailShape(value) && value.length <= 254 ? value : null;
}

/** Valor normalizado del campo, o `null` si no es valido. */
export function parseField(field: PreRegField, raw: string, today: string): string | null {
  switch (field) {
    case "given_names":
    case "family_names":
      return parseName(raw);
    case "birth_date":
      return parseDate(raw, today);
    case "phone":
      return parsePhone(raw);
    case "email":
      return parseEmail(raw);
  }
}
