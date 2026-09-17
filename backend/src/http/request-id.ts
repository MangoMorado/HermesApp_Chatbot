import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Toma el identificador que trae el cliente o genera uno.
 * Se acota el largo para que un valor externo no contamine logs ni respuestas.
 */
export function resolveRequestId(incoming: string | null): string {
  const candidate = incoming?.trim();
  if (candidate && candidate.length > 0 && candidate.length <= 128) {
    return candidate;
  }
  return randomUUID();
}
