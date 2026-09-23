import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { unauthorized } from "@/modules/auth/domain/auth-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { errorResponse, toApiError } from "./errors";
import { parseJsonBody } from "./idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const BEARER = /^Bearer (.+)$/;

/** Compara en tiempo constante: los digests tienen siempre la misma longitud. */
function sameSecret(presented: string, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}

/**
 * La plataforma es un actor fuera de todo tenant (GOBERNANZA §1.3). Sin PLATFORM_SECRET la
 * superficie no existe (404), igual que el simulador apagado.
 */
export function requirePlatform(authorization: string | null, secret: string | null): void {
  if (secret === null) {
    throw new NotFoundError();
  }
  const presented = BEARER.exec(authorization ?? "")?.[1];
  if (!presented || !sameSecret(presented, secret)) {
    throw unauthorized();
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(await request.text());
}

type PlatformHandler = (context: { requestId: string; request: Request }) => Promise<unknown>;

/** Ruta de plataforma sin escritura de dominio (lecturas y emision de tokens). */
export function platformRoute(handler: PlatformHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      requirePlatform(request.headers.get("Authorization"), getContainer().config.platformSecret);
      return NextResponse.json(await handler({ requestId, request }), {
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
