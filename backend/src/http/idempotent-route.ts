import type { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requireTenantActor } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import type { TenantRole } from "@/modules/auth/domain/role";
import { errorResponse, toApiError } from "./errors";
import {
  hashKeyFor,
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
  /**
   * Sustituye al actor autenticado antes de leer la clave (p. ej. el widget resuelve su
   * conversacion y pasa a `widget:<sessionId>`). El ambito de idempotencia usa este actor.
   */
  readonly resolveActor?: (actor: Actor, request: Request) => Promise<Actor>;
  /** Comprobacion previa a la idempotencia: cubre la primera ejecucion y la repeticion. */
  readonly guard?: (context: { actor: Actor; request: Request }) => Promise<void>;
  /** El cuerpo puede llevar respuestas de verificacion: hash con clave (refinamiento 15). */
  readonly sensitiveBody?: boolean;
  /** Reconstruye la repeticion cuando lo persistido no es la respuesta (credenciales). */
  readonly rebuild?: (stored: IdempotentResult, actor: Actor) => Promise<IdempotentResult>;
};

/** Escritura autenticada con `Idempotency-Key` obligatoria, en el ambito del tenant del token. */
export function idempotentRoute(
  allowedRoles: readonly TenantRole[],
  handler: IdempotentHandler,
  options: IdempotentRouteOptions = {},
) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      const authenticated = requireTenantActor(
        await container.authenticate(request.headers.get("Authorization")),
        allowedRoles,
      );
      const actor = options.resolveActor
        ? await options.resolveActor(authenticated, request)
        : authenticated;
      await options.guard?.({ actor, request });
      const idempotent = await readIdempotentRequest(
        request,
        actor.subject,
        1,
        options.sensitiveBody ? hashKeyFor(container.config.credentialsEncryptionKey) : undefined,
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
