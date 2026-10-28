import { createHash, randomBytes } from "node:crypto";
import type { ConversationSecrets } from "../domain/ports/ports";

const SECRET_BYTES = 32;

/** 256 bits aleatorios en base64url; el hash que se guarda es sha256 en hex. */
export const cryptoConversationSecrets: ConversationSecrets = {
  generate: () => randomBytes(SECRET_BYTES).toString("base64url"),
  hash: (secret) => createHash("sha256").update(secret, "utf8").digest("hex"),
};
