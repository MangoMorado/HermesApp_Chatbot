/** Conflicto de estado (idempotencia, dependientes). HTTP → `conflict` 409. */
export class ConflictError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ConflictError";
    if (details !== undefined) {
      this.details = details;
    }
  }
}
