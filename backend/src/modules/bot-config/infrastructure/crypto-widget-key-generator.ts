import { randomBytes } from "node:crypto";
import type { WidgetKeyGenerator } from "../domain/ports/widget-key-generator";

/** Adaptador: `wk_` + 32 bytes aleatorios en base64url (43 caracteres). */
export const cryptoWidgetKeyGenerator: WidgetKeyGenerator = {
  next: () => `wk_${randomBytes(32).toString("base64url")}`,
};
