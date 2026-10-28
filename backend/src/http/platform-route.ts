import { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requirePlatformActor } from "@/modules/auth/application/authorize";
import type { PlatformActor } from "@/modules/auth/domain/actor";
import { errorResponse, toApiError } from "./errors";
import {
  hashKeyFor,
  type IdempotentOutcome,
  idempotentJson,
  platformScope,
  readIdempotentRequest,
  runIdempotent,
} from "./idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

/** La plataforma es un actor fuera de todo tenant (GOBERNANZA §1.3): bearer del proveedor con rol `platform`. */
async function authenticatePlatform(request: Request): Promise<PlatformActor> {
  return requirePlatformActor(
    await getContainer().authenticate(request.headers.get("Authorization")),
  );
}

type PlatformHandler = (context: {
  actor: PlatformActor;
  requestId: string;
  request: Request;
}) => Promise<unknown>;

/** Ruta de plataforma sin escritura de dominio (lecturas). */
export function platformRoute(handler: PlatformHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const actor = await authenticatePlatform(request);
      return NextResponse.json(await handler({ actor, requestId, request }), {
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}

type PlatformWriteHandler = (context: {
  actor: PlatformActor;
  requestId: string;
  body: unknown;
  ports: WritePorts;
}) => Promise<IdempotentOutcome>;

/**
 * Escritura de plataforma con `Idempotency-Key` en su propio ambito (sin tenant). Los cuerpos
 * llevan secretos de cliente: el hash de la peticion es un HMAC con clave propia.
 */
export function platformIdempotentRoute(handler: PlatformWriteHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      const actor = await authenticatePlatform(request);
      const idempotent = await readIdempotentRequest(
        request,
        actor.subject,
        1,
        hashKeyFor(container.config.credentialsEncryptionKey),
      );
      const result = await runIdempotent({
        request: idempotent,
        outside: platformScope(container.platformIdempotencyStore),
        inside: (ports) => platformScope(ports.platformIdempotencyStore),
        execute: (ports) => handler({ actor, requestId, body: idempotent.body, ports }),
      });
      return idempotentJson(result, requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
