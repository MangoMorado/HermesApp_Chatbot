/** Huella estable de un cuerpo, para que la misma peticion reuse la Idempotency-Key. */
export function fingerprint(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 2166136261;
  for (const char of json) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
