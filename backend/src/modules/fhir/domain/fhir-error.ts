import type { IssueCode } from "./resources/types";

/** Error de la superficie FHIR. El adaptador HTTP lo traduce a un `OperationOutcome`. */
export class FhirError extends Error {
  readonly status: number;
  readonly code: IssueCode;

  constructor(status: number, code: IssueCode, message: string) {
    super(message);
    this.name = "FhirError";
    this.status = status;
    this.code = code;
  }
}

/** Mensaje fijo: decir por que fallo el token ya es informacion. */
export function fhirLogin(): FhirError {
  return new FhirError(401, "login", "Credenciales ausentes o invalidas");
}

export function fhirForbidden(): FhirError {
  return new FhirError(403, "forbidden", "El rol no admite esta operacion");
}

export function fhirNotFound(): FhirError {
  return new FhirError(404, "not-found", "Recurso inexistente");
}

export function fhirInvalid(message: string): FhirError {
  return new FhirError(400, "invalid", message);
}

export function fhirNotSupported(message: string): FhirError {
  return new FhirError(400, "not-supported", message);
}

export function fhirMethodNotAllowed(): FhirError {
  return new FhirError(405, "not-supported", "Interaccion no soportada sobre este recurso");
}

export function fhirException(): FhirError {
  return new FhirError(500, "exception", "Error interno");
}
