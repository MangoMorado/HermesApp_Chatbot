import { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import { AuthError } from "@/modules/auth/domain/auth-error";
import {
  FhirError,
  fhirException,
  fhirForbidden,
  fhirInvalid,
  fhirLogin,
  fhirNotFound,
} from "@/modules/fhir/domain/fhir-error";
import { operationOutcome } from "@/modules/fhir/domain/operation-outcome";
import { FHIR_MIME } from "@/modules/fhir/domain/profiles";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

/**
 * Envoltorio de la superficie FHIR. No comparte nada con `errors.ts`: aqui todo
 * error es un `OperationOutcome` con `application/fhir+json`, nunca la envoltura REST.
 */

export function fhirResponse(body: unknown, status: number, requestId: string): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": FHIR_MIME,
      [REQUEST_ID_HEADER]: requestId,
      ...(status === 405 ? { Allow: "GET" } : {}),
    },
  });
}

function fromAuthError(error: AuthError): FhirError {
  if (error.reason === "unauthorized") {
    return fhirLogin();
  }
  return error.reason === "forbidden" ? fhirForbidden() : fhirNotFound();
}

/** Traduce el error del nucleo sin filtrar detalle interno. */
export function toFhirError(error: unknown): FhirError {
  if (error instanceof FhirError) {
    return error;
  }
  if (error instanceof AuthError) {
    return fromAuthError(error);
  }
  if (error instanceof NotFoundError) {
    return fhirNotFound();
  }
  if (error instanceof ValidationError) {
    return fhirInvalid(error.message);
  }
  return fhirException();
}

async function respond(request: Request, run: () => Promise<unknown>): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    return fhirResponse(await run(), 200, requestId);
  } catch (error) {
    const failure = toFhirError(error);
    return fhirResponse(operationOutcome(failure.code, failure.message), failure.status, requestId);
  }
}

/** Ruta sin token. Solo `GET /fhir/metadata`. */
export function publicFhirRoute(
  request: Request,
  handler: () => Promise<unknown> | unknown,
): Promise<NextResponse> {
  return respond(request, async () => handler());
}

/** Autentica y exige `service` antes de tocar el handler: el enrutado va despues. */
export function serviceFhirRoute(
  request: Request,
  handler: (actor: Actor) => Promise<unknown>,
): Promise<NextResponse> {
  return respond(request, async () => {
    const actor = await getContainer().authenticate(request.headers.get("Authorization"));
    requireRole(actor, ["service"]);
    return handler(actor);
  });
}
