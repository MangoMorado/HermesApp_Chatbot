import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { DocumentType } from "./entities";

/** Hermes asigna su identificador al confirmar (Fase 4); hasta entonces, el id propio. */
export const PRE_REGISTRATION_SYSTEM = "urn:ingenius:pre-registration";

export type PreRegistrationData = {
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string;
  readonly email: string | null;
};

const DOCUMENT = /^[A-Z0-9]{3,20}$/;
const NAME = /^\p{L}[\p{L}' -]{0,99}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE = /^3\d{9}$/;

/** Forma mínima de correo sin regex (evita backtracking super-lineal). */
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

function fail(field: string, message: string): never {
  throw new ValidationError(message, { field });
}

function name(raw: string, field: string): string {
  const value = raw.trim().replace(/\s+/g, " ");
  return NAME.test(value) ? value : fail(field, `${field} solo admite letras (1 a 100)`);
}

function birthDate(raw: string, today: string): string {
  const value = raw.trim();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const valid = DATE.test(value) && parsed.toISOString().slice(0, 10) === value;
  if (!valid || value > today || value < "1900-01-01") {
    fail("birth_date", "birth_date debe ser una fecha AAAA-MM-DD pasada");
  }
  return value;
}

function mobile(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("57")) {
    digits = digits.slice(2);
  }
  return MOBILE.test(digits) ? digits : fail("phone", "phone debe ser un celular de 10 digitos");
}

function email(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  return isEmailShape(value) && value.length <= 254 ? value : fail("email", "email invalido");
}

/** Validacion autoritativa del pre-registro (la del chat es solo UX, refinamiento 14). */
export function validatePreRegistration(
  raw: PreRegistrationData,
  today: string,
): PreRegistrationData {
  const documentNumber = raw.documentNumber.trim().toUpperCase();
  if (!DOCUMENT.test(documentNumber)) {
    fail("document_number", "document_number debe tener de 3 a 20 letras o digitos");
  }
  return {
    documentType: raw.documentType,
    documentNumber,
    givenNames: name(raw.givenNames, "given_names"),
    familyNames: name(raw.familyNames, "family_names"),
    birthDate: birthDate(raw.birthDate, today),
    phone: mobile(raw.phone),
    email: email(raw.email),
  };
}
