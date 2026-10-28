import type { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requireTenantActor } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import { fhirInvalid } from "@/modules/fhir/domain/fhir-error";
import { operationOutcome } from "@/modules/fhir/domain/operation-outcome";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { fhirResponse, toFhirError } from "./fhir-route";
import { readIdempotentRequest, runIdempotent, tenantScope } from "./idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

type ExecuteContext<T> = {
  readonly actor: Actor;
  readonly body: unknown;
  readonly ports: WritePorts;
  readonly requestId: string;
  readonly target: T;
};

type ExecuteResult = { readonly status: number; readonly body: unknown };

async function readRequest(request: Request, actor: Actor) {
  try {
    return await readIdempotentRequest(request, actor.subject, 1, undefined, "pathname+search");
  } catch (error) {
    if (error instanceof ValidationError) {
      throw fhirInvalid(error.message);
    }
    throw error;
  }
}

function locationOf(request: Request, status: number, body: unknown): string | undefined {
  if (status !== 200 && status !== 201) {
    return undefined;
  }
  const resource = body as { readonly resourceType?: unknown; readonly id?: unknown };
  if (typeof resource.resourceType !== "string" || typeof resource.id !== "string") {
    return undefined;
  }
  const url = new URL(request.url);
  const base = getContainer().config.fhirBaseUrl ?? `${url.origin}/fhir`;
  return `${base}/${resource.resourceType}/${resource.id}`;
}

export async function serviceFhirIdempotentRoute<T>(
  request: Request,
  precheck: () => T,
  execute: (context: ExecuteContext<T>) => Promise<ExecuteResult>,
): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    const container = getContainer();
    const actor = requireTenantActor(
      await container.authenticate(request.headers.get("Authorization")),
      ["service"],
    );
    const target = precheck();
    const idempotent = await readRequest(request, actor);
    const result = await runIdempotent({
      request: idempotent,
      outside: tenantScope(container.idempotencyStore, actor.tenantId),
      inside: (ports) => tenantScope(ports.idempotencyStore, actor.tenantId),
      execute: async (ports) => {
        const outcome = await execute({
          actor,
          body: idempotent.body,
          ports,
          requestId,
          target,
        });
        return { ...outcome, stored: outcome.body };
      },
    });
    return fhirResponse(result.body, result.status, requestId, {
      location: locationOf(request, result.status, result.body),
    });
  } catch (error) {
    const failure = toFhirError(error);
    return fhirResponse(
      operationOutcome(failure.code, failure.message),
      failure.status,
      requestId,
      { allow: failure.allow },
    );
  }
}
