import { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import type { Role } from "@/modules/auth/domain/role";
import { errorResponse, toApiError } from "./errors";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

type PublicHandler = (context: { requestId: string }) => Promise<unknown> | unknown;
type PrivateHandler = (context: { actor: Actor; requestId: string }) => Promise<unknown> | unknown;

function ok(payload: unknown, requestId: string): NextResponse {
  return NextResponse.json(payload, {
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

/** Ruta publica: resuelve `X-Request-Id` y normaliza los errores. */
export function publicRoute(handler: PublicHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      return ok(await handler({ requestId }), requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}

/**
 * Ruta autenticada. Sin token valido responde `401` antes de tocar el handler,
 * y el tenant del actor sale solo del claim del token.
 */
export function privateRoute(allowedRoles: readonly Role[], handler: PrivateHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const { authenticate } = getContainer();
      const actor = await authenticate(request.headers.get("Authorization"));
      requireRole(actor, allowedRoles);
      return ok(await handler({ actor, requestId }), requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
