/**
 * Por que se rechaza una peticion. `not_found` es deliberado: un recurso de otro
 * tenant nunca responde `forbidden`, porque eso confirmaria que existe.
 */
export type AuthErrorReason = "unauthorized" | "forbidden" | "not_found";

export class AuthError extends Error {
  readonly reason: AuthErrorReason;

  constructor(reason: AuthErrorReason, message: string) {
    super(message);
    this.name = "AuthError";
    this.reason = reason;
  }
}

export function unauthorized(message = "Credenciales ausentes o invalidas"): AuthError {
  return new AuthError("unauthorized", message);
}

export function forbidden(message = "El rol no admite esta operacion"): AuthError {
  return new AuthError("forbidden", message);
}

export function notFound(message = "Recurso inexistente"): AuthError {
  return new AuthError("not_found", message);
}
