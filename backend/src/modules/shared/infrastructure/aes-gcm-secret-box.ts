import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretBox } from "../domain/ports/secret-box";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const INVALID_SEAL = "Secreto sellado invalido";

/** Decodifica base64url estricto y comprueba la longitud exacta del iv. */
function decodeIv(part: string): Buffer {
  if (!BASE64URL.test(part)) throw new Error(INVALID_SEAL);
  const iv = Buffer.from(part, "base64url");
  if (iv.byteLength !== IV_BYTES) throw new Error(INVALID_SEAL);
  return iv;
}

/** Decodifica el cuerpo (ciphertext || tag) en base64url estricto. */
function decodeBody(part: string): Buffer {
  if (!BASE64URL.test(part)) throw new Error(INVALID_SEAL);
  const body = Buffer.from(part, "base64url");
  if (body.byteLength <= TAG_BYTES) throw new Error(INVALID_SEAL);
  return body;
}

/** Adaptador: implementa el puerto de sellado con AES-256-GCM (formato v1.<iv>.<ciphertext||tag>). */
export function createAesGcmSecretBox(key: Uint8Array): SecretBox {
  if (key.byteLength !== KEY_BYTES) {
    throw new Error("La clave de sellado debe tener 32 bytes");
  }
  const keyBytes = Buffer.from(key);

  return {
    seal(plain) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: TAG_BYTES });
      const body = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return [VERSION, iv.toString("base64url"), body.toString("base64url")].join(".");
    },
    open(sealed) {
      const parts = sealed.split(".");
      if (parts.length !== 3 || parts[0] !== VERSION) throw new Error(INVALID_SEAL);
      const iv = decodeIv(parts[1] ?? "");
      const body = decodeBody(parts[2] ?? "");
      const ciphertext = body.subarray(0, body.byteLength - TAG_BYTES);
      const tag = body.subarray(body.byteLength - TAG_BYTES);
      try {
        const decipher = createDecipheriv("aes-256-gcm", keyBytes, iv, {
          authTagLength: TAG_BYTES,
        });
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw new Error(INVALID_SEAL);
      }
    },
  };
}
