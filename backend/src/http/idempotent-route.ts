import { createHmac } from "node:crypto";
import type { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import type { Role } from "@/modules/auth/domain/role";
import { errorResponse, toApiError } from "./errors";
import {
  type IdempotentOutcome,
  type IdempotentResult,
  idempotentJson,
  readIdempotentRequest,
  runIdempotent,
  tenantScope,
} from "./idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

export type { IdempotentResult } from "./idempotency-core";

type IdempotentHandler = (context: {
  actor: Actor;
  requestId: string;
  body: unknown;
  ports: WritePorts;
  request: Request;
}) => Promise<IdempotentOutcome>;

type IdempotentRouteOptions = {
  /** Comprobacion previa a la idempotencia: cubre la primera ejecucion y la repeticion. */
  readonly guard?: (context: { actor: Actor; request: Request }) => Promise<void>;
  /** El cuerpo puede llevar respuestas de verificacion: hash con clave (refinamiento 15). */
  readonly sensitiveBody?: boolean;
  /** Reconstruye la repeticion cuando lo persistido no es la respuesta (credenciales). */
  readonly rebuild?: (stored: IdempotentResult, actor: Actor) => Promise<IdempotentResult>;
};

/** Clave propia del hash de peticiones, derivada del secreto para no reutilizarlo directamente. */
function hashKeyFor(secret: string): string {
  return createHmac("sha256", secret).update("idempotency-request-hash").digest("hex");
}

/** Escritura autenticada con `Idempotency-Key` obligatoria, en el ambito del tenant del token. */
export function idempotentRoute(
  allowedRoles: readonly Role[],
  handler: IdempotentHandler,
  options: IdempotentRouteOptions = {},
) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      const actor = await container.authenticate(request.headers.get("Authorization"));
      requireRole(actor, allowedRoles);
      await options.guard?.({ actor, request });
      const idempotent = await readIdempotentRequest(
        request,
        actor.subject,
        1,
        options.sensitiveBody ? hashKeyFor(container.config.jwt.secret) : undefined,
      );
      const { rebuild } = options;
      const result = await runIdempotent({
        request: idempotent,
        outside: tenantScope(container.idempotencyStore, actor.tenantId),
        inside: (ports) => tenantScope(ports.idempotencyStore, actor.tenantId),
        execute: (ports) => handler({ actor, requestId, body: idempotent.body, ports, request }),
        ...(rebuild ? { rebuild: (stored: IdempotentResult) => rebuild(stored, actor) } : {}),
      });
      return idempotentJson(result, requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
