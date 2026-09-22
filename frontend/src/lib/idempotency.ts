/**
 * Una `Idempotency-Key` por intento, no por clic: mientras el mismo envío (misma
 * operación y mismo cuerpo) no haya tenido éxito, se reutiliza la misma clave, así
 * que un doble clic o un reintento tras un fallo de red no escribe dos veces.
 * `apiFetcher` la libera al recibir una respuesta correcta.
 *
 * `scope` distingue operaciones con el mismo cuerpo (p. ej. dos borrados con `{}`):
 * en el backend la clave es única por tenant, no por ruta.
 */
const pending = new Map<string, string>();

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function idempotent(scope: string, body: unknown): RequestInit {
  const payload = JSON.stringify(body);
  const attempt = `${scope}\n${payload}`;
  let key = pending.get(attempt);
  if (!key) {
    key = crypto.randomUUID();
    pending.set(attempt, key);
  }
  return { body: payload, headers: { [IDEMPOTENCY_HEADER]: key } };
}

export function settleIdempotencyKey(key: string): void {
  for (const [attempt, pendingKey] of pending) {
    if (pendingKey === key) {
      pending.delete(attempt);
    }
  }
}
