import {
  parseEmailAddress,
  parseMobilePhone,
  parsePastDate,
  parsePersonName,
} from "@/modules/shared/domain/pre-registration-parsers";
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

function fail(field: string, message: string): never {
  throw new ValidationError(message, { field });
}

function requireParsed(value: string | null, field: string, message: string): string {
  return value ?? fail(field, message);
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
    givenNames: requireParsed(
      parsePersonName(raw.givenNames),
      "given_names",
      "given_names solo admite letras (1 a 100)",
    ),
    familyNames: requireParsed(
      parsePersonName(raw.familyNames),
      "family_names",
      "family_names solo admite letras (1 a 100)",
    ),
    birthDate: requireParsed(
      parsePastDate(raw.birthDate, today),
      "birth_date",
      "birth_date debe ser una fecha AAAA-MM-DD pasada",
    ),
    phone: requireParsed(
      parseMobilePhone(raw.phone),
      "phone",
      "phone debe ser un celular de 10 digitos",
    ),
    email:
      raw.email === null
        ? null
        : requireParsed(parseEmailAddress(raw.email), "email", "email invalido"),
  };
}
