import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { unauthorized } from "@/modules/auth/domain/auth-error";
import { PLATFORM_AUDIT_ACTOR } from "@/modules/platform/domain/platform-actor";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { errorResponse, toApiError } from "./errors";
import {
  type IdempotentOutcome,
  idempotentJson,
  parseJsonBody,
  platformScope,
  readIdempotentRequest,
  runIdempotent,
} from "./idempotency-core";
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

type PlatformWriteHandler = (context: {
  requestId: string;
  body: unknown;
  ports: WritePorts;
}) => Promise<IdempotentOutcome>;

/** Escritura de plataforma con `Idempotency-Key` en su propio ambito (sin tenant). */
export function platformIdempotentRoute(handler: PlatformWriteHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      requirePlatform(request.headers.get("Authorization"), container.config.platformSecret);
      const idempotent = await readIdempotentRequest(request, PLATFORM_AUDIT_ACTOR.actorSubject);
      const result = await runIdempotent({
        request: idempotent,
        outside: platformScope(container.platformIdempotencyStore),
        inside: (ports) => platformScope(ports.platformIdempotencyStore),
        execute: (ports) => handler({ requestId, body: idempotent.body, ports }),
      });
      return idempotentJson(result, requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
