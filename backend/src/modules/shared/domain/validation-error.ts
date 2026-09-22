/** Entrada invalida detectada por el nucleo. El adaptador HTTP la traduce a `validation_failed`. */
export class ValidationError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    if (details !== undefined) {
      this.details = details;
    }
  }
}
