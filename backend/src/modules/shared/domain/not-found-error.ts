/** Recurso inexistente o de otro tenant. El adaptador HTTP lo traduce a `not_found`. */
export class NotFoundError extends Error {
  constructor(message = "Recurso inexistente") {
    super(message);
    this.name = "NotFoundError";
  }
}
