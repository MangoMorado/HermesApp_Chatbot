import { asRecord, requiredText } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { IncomingMessage } from "./types";

export const MAX_TEXT_LENGTH = 500;
const MAX_OPTION_ID_LENGTH = 64;
const FIELDS = new Set(["option_id", "text"]);

/** Cuerpo de `POST /widget/conversation/messages`: exactamente uno de option_id o text. */
export function parseIncomingMessage(raw: unknown): IncomingMessage {
  const data = asRecord(raw, "body");
  const unknown = Object.keys(data).find((key) => !FIELDS.has(key));
  if (unknown !== undefined) {
    throw new ValidationError(`Campo desconocido: ${unknown}`, { field: unknown });
  }
  const hasOption = Object.hasOwn(data, "option_id");
  if (hasOption === Object.hasOwn(data, "text")) {
    throw new ValidationError("Envia option_id o text, no ambos", { field: "body" });
  }
  if (!hasOption) {
    return { text: requiredText(data.text, "text", MAX_TEXT_LENGTH) };
  }
  const optionId = data.option_id;
  if (typeof optionId !== "string" || optionId === "" || optionId.length > MAX_OPTION_ID_LENGTH) {
    throw new ValidationError("option_id invalido", { field: "option_id" });
  }
  return { optionId };
}
