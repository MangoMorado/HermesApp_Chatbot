import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import type { Role } from "@/modules/auth/domain/role";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { IdempotencyKeyTakenError } from "@/modules/shared/domain/idempotency";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { errorResponse, toApiError } from "./errors";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const IDEMPOTENCY_HEADER = "Idempotency-Key";

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

/**
 * Escritura autenticada con `Idempotency-Key` obligatoria. La escritura de negocio
 * y el registro de la clave van en la misma transaccion.
 */
export function idempotentRoute(allowedRoles: readonly Role[], handler: IdempotentHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      const actor = await container.authenticate(request.headers.get("Authorization"));
      requireRole(actor, allowedRoles);

      const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
      if (!key) {
        throw new ValidationError("Idempotency-Key es obligatoria", {
          field: "Idempotency-Key",
        });
      }

      const bodyText = await request.text();
      let body: unknown = null;
      if (bodyText !== "") {
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw new ValidationError("Cuerpo JSON invalido");
        }
      }

      const path = new URL(request.url).pathname;
      const hash = requestHash(request.method, path, bodyText);
      const existing = await container.idempotencyStore.find(actor.tenantId, key);
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new ConflictError("Idempotency-Key reutilizada con otra peticion", {
            field: "Idempotency-Key",
          });
        }
        return NextResponse.json(existing.responseBody, {
          status: existing.responseStatus,
          headers: { [REQUEST_ID_HEADER]: requestId },
        });
      }

      const result = await container.withWriteTransaction(async (ports) => {
        const outcome = await handler({ actor, requestId, body, ports });
        try {
          await ports.idempotencyStore.save({
            tenantId: actor.tenantId,
            key,
            actorSubject: actor.subject,
            method: request.method,
            path,
            requestHash: hash,
            responseStatus: outcome.status,
            responseBody: outcome.body,
            createdAt: ports.clock.now(),
          });
        } catch (error) {
          if (error instanceof IdempotencyKeyTakenError) {
            const raced = await ports.idempotencyStore.find(actor.tenantId, key);
            if (raced && raced.requestHash === hash) {
              return { status: raced.responseStatus, body: raced.responseBody };
            }
            throw new ConflictError("Idempotency-Key reutilizada con otra peticion", {
              field: "Idempotency-Key",
            });
          }
          throw error;
        }
        return outcome;
      });

      return NextResponse.json(result.body, {
        status: result.status,
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
