/** Peticion mal formada o inadmisible (p. ej. logout_token invalido). HTTP → `invalid_request` 400. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}
