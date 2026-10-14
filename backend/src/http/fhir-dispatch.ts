import type { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import {
  fhirMethodNotAllowed,
  fhirNotFound,
  fhirUnsupportedMediaType,
} from "@/modules/fhir/domain/fhir-error";
import { FHIR_MIME, isResourceType, type ResourceType } from "@/modules/fhir/domain/profiles";
import { DEFINITIONS } from "@/modules/fhir/domain/registry";
import { serviceFhirIdempotentRoute } from "./fhir-idempotent-route";
import { publicFhirRoute, serviceFhirRoute } from "./fhir-route";

function isMetadata(path: readonly string[]): boolean {
  return path.length === 1 && path[0] === "metadata";
}

/** `GET /fhir/metadata`, `GET /fhir/{Tipo}` (busqueda) y `GET /fhir/{Tipo}/{id}` (lectura). */
export function handleFhirRead(request: Request, path: readonly string[]): Promise<NextResponse> {
  if (isMetadata(path)) {
    return publicFhirRoute(request, () => getContainer().fhir.getCapabilityStatement());
  }
  return serviceFhirRoute(request, async (actor) => {
    const { fhir, config } = getContainer();
    const [type, id, ...rest] = path;
    if (type === undefined || rest.length > 0) {
      throw fhirNotFound();
    }
    if (id !== undefined) {
      return fhir.readResource(actor.tenantId, type, id);
    }
    const url = new URL(request.url);
    return fhir.searchResources({
      tenantId: actor.tenantId,
      type,
      entries: [...url.searchParams.entries()],
      baseUrl: config.fhirBaseUrl ?? `${url.origin}/fhir`,
    });
  });
}

function isFhirJson(header: string | null): boolean {
  const mime = (header ?? "").split(";")[0]?.trim().toLowerCase();
  return mime === FHIR_MIME || mime === "application/json";
}

/** Enrutado y media type, sin leer la clave ni el cuerpo. */
function resolveWriteTarget(request: Request, path: readonly string[]): ResourceType {
  const [type, id, ...rest] = path;
  if (type === undefined || !isResourceType(type)) {
    throw fhirNotFound();
  }
  const writable = DEFINITIONS[type].writable;
  if (request.method !== "PUT") {
    throw fhirMethodNotAllowed(writable && id === undefined ? "GET, PUT" : "GET");
  }
  if (id !== undefined || rest.length > 0 || !writable) {
    throw fhirMethodNotAllowed("GET");
  }
  if (!isFhirJson(request.headers.get("content-type"))) {
    throw fhirUnsupportedMediaType();
  }
  return type;
}

/** `PUT /fhir/{Tipo}?identifier=system|value`, dentro de la transaccion idempotente. */
export function handleFhirWrite(request: Request, path: readonly string[]): Promise<NextResponse> {
  return serviceFhirIdempotentRoute(
    request,
    () => resolveWriteTarget(request, path),
    async ({ actor, body, ports, requestId, target }) => {
      const url = new URL(request.url);
      const conditionalPut = getContainer().fhir.conditionalPut(ports.fhirWriters);
      const result = await conditionalPut({
        tenantId: actor.tenantId,
        actor: { actorSubject: actor.subject, actorRole: actor.role, requestId },
        type: target,
        entries: [...url.searchParams.entries()],
        body,
      });
      return { status: result.status, body: result.resource };
    },
  );
}
