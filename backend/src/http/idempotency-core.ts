import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { IdempotencyKeyTakenError } from "@/modules/shared/domain/idempotency";
import type {
  IdempotencyStore,
  PlatformIdempotencyStore,
} from "@/modules/shared/domain/ports/idempotency-store";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { REQUEST_ID_HEADER } from "./request-id";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Estado provisional de una clave reservada; nunca sale de la transaccion. */
const PENDING_STATUS = 0;

export type IdempotentResult = { readonly status: number; readonly body: unknown };

/** `stored` se persiste en lugar de `body` cuando la respuesta lleva credenciales. */
export type IdempotentOutcome = IdempotentResult & { readonly stored?: unknown };

type StoredResponse = {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
};

type Reservation = {
  readonly key: string;
  readonly actorSubject: string;
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  readonly createdAt: Date;
};

/** Almacen de claves ya atado a su ambito: un tenant o la plataforma. */
export type ScopedIdempotencyStore = {
  find(key: string): Promise<StoredResponse | null>;
  reserve(reservation: Reservation): Promise<void>;
  complete(key: string, status: number, body: unknown): Promise<void>;
};

export type IdempotentRequest = {
  readonly key: string;
  readonly hash: string;
  readonly method: string;
  readonly path: string;
  readonly actorSubject: string;
  readonly body: unknown;
};

export type IdempotencyPlan = {
  readonly request: IdempotentRequest;
  readonly outside: ScopedIdempotencyStore;
  readonly inside: (ports: WritePorts) => ScopedIdempotencyStore;
  readonly execute: (ports: WritePorts) => Promise<IdempotentOutcome>;
  /** Reconstruye la respuesta desde lo persistido; por defecto se repite tal cual. */
  readonly rebuild?: (stored: IdempotentResult) => Promise<IdempotentResult>;
};

export function tenantScope(store: IdempotencyStore, tenantId: TenantId): ScopedIdempotencyStore {
  return {
    find: (key) => store.find(tenantId, key),
    reserve: (reservation) =>
      store.save({ tenantId, ...reservation, responseStatus: PENDING_STATUS, responseBody: {} }),
    complete: (key, status, body) => store.complete(tenantId, key, status, body),
  };
}

export function platformScope(store: PlatformIdempotencyStore): ScopedIdempotencyStore {
  return {
    find: (key) => store.find(key),
    reserve: (reservation) =>
      store.save({
        key: reservation.key,
        method: reservation.method,
        path: reservation.path,
        requestHash: reservation.requestHash,
        createdAt: reservation.createdAt,
        responseStatus: PENDING_STATUS,
        responseBody: {},
      }),
    complete: (key, status, body) => store.complete(key, status, body),
  };
}

/** Clave propia del hash de peticiones, derivada de la clave de cifrado para no reutilizarla. */
export function hashKeyFor(key: Uint8Array): string {
  return createHmac("sha256", key).update("idempotency-request-hash").digest("hex");
}

export function parseJsonBody(bodyText: string): unknown {
  if (bodyText === "") {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new ValidationError("Cuerpo JSON invalido");
  }
}

/**
 * Con `hashKey` (HMAC) el hash no permite recuperar por fuerza bruta un cuerpo corto, como una
 * respuesta de verificacion de 4 digitos (GOBERNANZA §1.5).
 */
function requestHash(method: string, path: string, bodyText: string, hashKey?: string): string {
  const payload = `${method}\n${path}\n${bodyText}`;
  return hashKey
    ? createHmac("sha256", hashKey).update(payload).digest("hex")
    : createHash("sha256").update(payload).digest("hex");
}

export async function readIdempotentRequest(
  request: Request,
  actorSubject: string,
  minKeyLength = 1,
  hashKey?: string,
  pathMode: "pathname" | "pathname+search" = "pathname",
): Promise<IdempotentRequest> {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (key === "") {
    throw new ValidationError("Falta la cabecera Idempotency-Key, obligatoria en toda escritura", {
      field: IDEMPOTENCY_HEADER,
    });
  }
  if (key.length < minKeyLength) {
    throw new ValidationError(`Idempotency-Key debe tener al menos ${minKeyLength} caracteres`, {
      field: IDEMPOTENCY_HEADER,
      min_length: minKeyLength,
    });
  }
  const bodyText = await request.text();
  const url = new URL(request.url);
  const path = pathMode === "pathname+search" ? `${url.pathname}${url.search}` : url.pathname;
  return {
    key,
    hash: requestHash(request.method, path, bodyText, hashKey),
    method: request.method,
    path,
    actorSubject,
    body: parseJsonBody(bodyText),
  };
}

/** Respuesta ya servida para la clave, o `null` si nadie la ha usado. */
async function previousResult(
  store: ScopedIdempotencyStore,
  request: IdempotentRequest,
): Promise<IdempotentResult | null> {
  const existing = await store.find(request.key);
  if (!existing) {
    return null;
  }
  if (existing.requestHash !== request.hash) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion", {
      field: IDEMPOTENCY_HEADER,
    });
  }
  return { status: existing.responseStatus, body: existing.responseBody };
}

/**
 * Ejecuta la escritura una sola vez por clave. La clave se reserva al abrir la transaccion,
 * antes de la escritura de negocio: un envio concurrente con la misma clave queda bloqueado
 * en esa insercion hasta que el primero confirma; entonces falla, su transaccion se revierte
 * entera y la respuesta guardada se repite fuera de ella.
 */
export async function runIdempotent(plan: IdempotencyPlan): Promise<IdempotentResult> {
  const rebuild = plan.rebuild ?? ((stored: IdempotentResult) => Promise.resolve(stored));
  const replay = await previousResult(plan.outside, plan.request);
  if (replay) {
    return rebuild(replay);
  }
  try {
    return await getContainer().withWriteTransaction(async (ports) => {
      const store = plan.inside(ports);
      const { key, actorSubject, method, path, hash } = plan.request;
      await store.reserve({
        key,
        actorSubject,
        method,
        path,
        requestHash: hash,
        createdAt: ports.clock.now(),
      });
      const outcome = await plan.execute(ports);
      await store.complete(key, outcome.status, outcome.stored ?? outcome.body);
      return { status: outcome.status, body: outcome.body };
    });
  } catch (error) {
    if (!(error instanceof IdempotencyKeyTakenError)) {
      throw error;
    }
    const raced = await previousResult(plan.outside, plan.request);
    if (!raced) {
      throw error;
    }
    return rebuild(raced);
  }
}

export function idempotentJson(result: IdempotentResult, requestId: string): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}
