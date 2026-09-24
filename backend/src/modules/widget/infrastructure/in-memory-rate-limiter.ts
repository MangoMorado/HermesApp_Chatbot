import type { RateLimiter } from "../domain/ports/ports";

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

/** Ventana fija en memoria. Valida con una sola replica; la Fase 5 la cambia por un store compartido. */
export function createInMemoryRateLimiter(): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  function prune(now: number): void {
    for (const [bucket, window] of windows) {
      if (now - window.start >= WINDOW_MS) {
        windows.delete(bucket);
      }
    }
  }

  return {
    hit(bucket, limit, now) {
      const t = now.getTime();
      const current = windows.get(bucket);
      const window = current && t - current.start < WINDOW_MS ? current : { start: t, count: 0 };
      if (window.count >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((window.start + WINDOW_MS - t) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
      window.count += 1;
      windows.set(bucket, window);
      if (windows.size > MAX_BUCKETS) {
        prune(t);
      }
      return { allowed: true };
    },
  };
}
