import {
  parseEmailAddress,
  parseMobilePhone,
  parsePastDate,
  parsePersonName,
} from "@/modules/shared/domain/pre-registration-parsers";
import type { PreRegField } from "./types";

/**
 * Validacion campo a campo para la UX del chat. La autoritativa es la de patients
 * (refinamiento 14); ambas comparten los parsers de shared.
 */
export const PREREG_FIELDS: readonly PreRegField[] = [
  "given_names",
  "family_names",
  "birth_date",
  "phone",
  "email",
];

export function nextField(field: PreRegField): PreRegField | null {
  return PREREG_FIELDS[PREREG_FIELDS.indexOf(field) + 1] ?? null;
}

/** Valor normalizado del campo, o `null` si no es valido. */
export function parseField(field: PreRegField, raw: string, today: string): string | null {
  switch (field) {
    case "given_names":
    case "family_names":
      return parsePersonName(raw);
    case "birth_date":
      return parsePastDate(raw, today);
    case "phone":
      return parseMobilePhone(raw);
    case "email":
      return parseEmailAddress(raw);
  }
}
