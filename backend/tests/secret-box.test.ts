import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAesGcmSecretBox } from "@/modules/shared/infrastructure/aes-gcm-secret-box";

/** Cambia el ultimo caracter por otro con bits altos distintos, para que el descifrado no pueda ignorarlo. */
function flipLastChar(sealed: string): string {
  const last = sealed.slice(-1);
  const replacement = last === "A" ? "Q" : "A";
  return `${sealed.slice(0, -1)}${replacement}`;
}

describe("SecretBox AES-256-GCM", () => {
  const key = randomBytes(32);
  const box = createAesGcmSecretBox(key);
  const otherBox = createAesGcmSecretBox(randomBytes(32));

  it("ida y vuelta", () => {
    expect(box.open(box.seal("s3cr3t"))).toBe("s3cr3t");
  });

  it("dos sellos del mismo texto difieren (iv aleatorio)", () => {
    expect(box.seal("a")).not.toBe(box.seal("a"));
  });

  it("clave errónea falla", () => {
    expect(() => otherBox.open(box.seal("a"))).toThrow("Secreto sellado invalido");
  });

  it("manipulación detectada", () => {
    const sealed = box.seal("a");
    expect(() => box.open(flipLastChar(sealed))).toThrow("Secreto sellado invalido");
  });

  it("el sello no contiene el texto", () => {
    expect(box.seal("visible-text")).not.toContain("visible-text");
  });

  it("clave de longitud distinta de 32 lanza al crear", () => {
    expect(() => createAesGcmSecretBox(new Uint8Array(16))).toThrow();
  });

  it("el formato es v1.<iv12>.<ciphertext||tag16> en base64url", () => {
    const [version = "", iv = "", body = ""] = box.seal("a").split(".");
    expect(version).toBe("v1");
    expect(Buffer.from(iv, "base64url").byteLength).toBe(12);
    expect(Buffer.from(body, "base64url").byteLength).toBe(1 + 16);
  });

  it("formato malformado falla con el mismo error", () => {
    expect(() => box.open("no-es-un-sello")).toThrow("Secreto sellado invalido");
    expect(() => box.open("v2.AAAA.AAAA")).toThrow("Secreto sellado invalido");
  });
});
