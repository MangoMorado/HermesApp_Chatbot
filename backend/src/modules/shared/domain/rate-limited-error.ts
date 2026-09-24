/** Demasiadas peticiones en la ventana. HTTP → `rate_limited` 429 con `Retry-After`. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Demasiadas peticiones; intenta mas tarde");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
