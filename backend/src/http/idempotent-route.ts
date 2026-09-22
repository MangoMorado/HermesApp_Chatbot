import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import type { Role } from "@/modules/auth/domain/role";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { IdempotencyKeyTakenError } from "@/modules/shared/domain/idempotency";
import type { IdempotencyStore } from "@/modules/shared/domain/ports/idempotency-store";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { errorResponse, toApiError } from "./errors";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Estado provisional de una clave reservada; nunca sale de la transaccion. */
const PENDING_STATUS = 0;

export type IdempotentResult = {
  readonly status: number;
  readonly body: unknown;
};

type IdempotentHandler = (context: {
  actor: Actor;
  requestId: string;
  body: unknown;
  ports: WritePorts;
}) => Promise<IdempotentResult>;

function requestHash(method: string, path: string, bodyText: string): string {
  return createHash("sha256").update(`${method}\n${path}\n${bodyText}`).digest("hex");
}

function readKey(request: Request): string {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key) {
    throw new ValidationError("Idempotency-Key es obligatoria", { field: IDEMPOTENCY_HEADER });
  }
  return key;
}

function parseBody(bodyText: string): unknown {
  if (bodyText === "") {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new ValidationError("Cuerpo JSON invalido");
  }
}

/** Respuesta ya servida para la clave, o `null` si nadie la ha usado. */
async function previousResult(
  store: IdempotencyStore,
  tenantId: TenantId,
  key: string,
  hash: string,
): Promise<IdempotentResult | null> {
  const existing = await store.find(tenantId, key);
  if (!existing) {
    return null;
  }
  if (existing.requestHash !== hash) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion", {
      field: IDEMPOTENCY_HEADER,
    });
  }
  return { status: existing.responseStatus, body: existing.responseBody };
}

function json(result: IdempotentResult, requestId: string): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

type Attempt = {
  readonly actor: Actor;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly key: string;
  readonly hash: string;
  readonly body: unknown;
};

/**
 * Ejecuta la escritura una sola vez por clave. La clave se reserva al abrir la transaccion,
 * antes de la escritura de negocio: un envio concurrente con la misma clave queda bloqueado
 * en esa insercion hasta que el primero confirma; entonces falla, su transaccion se revierte
 * entera y la respuesta guardada se repite fuera de ella (en Postgres no se puede seguir
 * leyendo dentro de una transaccion abortada).
 */
async function writeOnce(attempt: Attempt, handler: IdempotentHandler): Promise<IdempotentResult> {
  const container = getContainer();
  const { actor, key, hash } = attempt;
  try {
    return await container.withWriteTransaction(async (ports) => {
      await ports.idempotencyStore.save({
        tenantId: actor.tenantId,
        key,
        actorSubject: actor.subject,
        method: attempt.method,
        path: attempt.path,
        requestHash: hash,
        responseStatus: PENDING_STATUS,
        responseBody: {},
        createdAt: ports.clock.now(),
      });
      const outcome = await handler({
        actor,
        requestId: attempt.requestId,
        body: attempt.body,
        ports,
      });
      await ports.idempotencyStore.complete(actor.tenantId, key, outcome.status, outcome.body);
      return outcome;
    });
  } catch (error) {
    if (!(error instanceof IdempotencyKeyTakenError)) {
      throw error;
    }
    const raced = await previousResult(container.idempotencyStore, actor.tenantId, key, hash);
    if (!raced) {
      throw error;
    }
    return raced;
  }
}

/** Escritura autenticada con `Idempotency-Key` obligatoria. */
export function idempotentRoute(allowedRoles: readonly Role[], handler: IdempotentHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      const actor = await container.authenticate(request.headers.get("Authorization"));
      requireRole(actor, allowedRoles);

      const key = readKey(request);
      const bodyText = await request.text();
      const body = parseBody(bodyText);
      const path = new URL(request.url).pathname;
      const hash = requestHash(request.method, path, bodyText);

      const replay = await previousResult(container.idempotencyStore, actor.tenantId, key, hash);
      if (replay) {
        return json(replay, requestId);
      }
      const attempt = { actor, requestId, method: request.method, path, key, hash, body };
      return json(await writeOnce(attempt, handler), requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
