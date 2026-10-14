import type { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import {
  fhirMethodNotAllowed,
  fhirNotFound,
  fhirNotSupported,
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

type WriteTarget =
  | { readonly mode: "conditional"; readonly type: ResourceType }
  | { readonly mode: "byId"; readonly type: "Appointment" | "Task"; readonly id: string };

function methodAllow(
  definition: { readonly writable: boolean; readonly updateById: boolean },
  id: string | undefined,
): string {
  if (definition.updateById) {
    return "GET, PUT";
  }
  return definition.writable && id === undefined ? "GET, PUT" : "GET";
}

function asResolvable(type: ResourceType): "Appointment" | "Task" {
  if (type === "Appointment" || type === "Task") {
    return type;
  }
  throw fhirMethodNotAllowed("GET");
}

function assertNoQuery(request: Request): void {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw fhirNotSupported("Parametro no soportado en PUT por id");
  }
}

/** Enrutado y media type, sin leer la clave ni el cuerpo. */
function resolveWriteTarget(request: Request, path: readonly string[]): WriteTarget {
  const [type, id, ...rest] = path;
  if (type === undefined || !isResourceType(type)) {
    throw fhirNotFound();
  }
  const definition = DEFINITIONS[type];
  if (request.method !== "PUT") {
    throw fhirMethodNotAllowed(methodAllow(definition, id));
  }
  if (rest.length > 0) {
    throw fhirMethodNotAllowed("GET");
  }
  if (definition.updateById && id !== undefined) {
    if (!isFhirJson(request.headers.get("content-type"))) {
      throw fhirUnsupportedMediaType();
    }
    assertNoQuery(request);
    return { mode: "byId", type: asResolvable(type), id };
  }
  if (definition.writable && id === undefined) {
    if (!isFhirJson(request.headers.get("content-type"))) {
      throw fhirUnsupportedMediaType();
    }
    return { mode: "conditional", type };
  }
  throw fhirMethodNotAllowed("GET");
}

/** `PUT` condicional de maestros, o `PUT` por id de `Appointment` y `Task`. */
export function handleFhirWrite(request: Request, path: readonly string[]): Promise<NextResponse> {
  return serviceFhirIdempotentRoute(
    request,
    () => resolveWriteTarget(request, path),
    async ({ actor, body, ports, requestId, target }) => {
      if (target.mode === "byId") {
        const resource = await getContainer().fhir.resolveById(ports.fhirAgenda)({
          tenantId: actor.tenantId,
          actor: { actorSubject: actor.subject, actorRole: actor.role, requestId },
          type: target.type,
          id: target.id,
          body,
        });
        return { status: 200, body: resource };
      }
      const url = new URL(request.url);
      const conditionalPut = getContainer().fhir.conditionalPut(ports.fhirWriters);
      const result = await conditionalPut({
        tenantId: actor.tenantId,
        actor: { actorSubject: actor.subject, actorRole: actor.role, requestId },
        type: target.type,
        entries: [...url.searchParams.entries()],
        body,
      });
      return { status: result.status, body: result.resource };
    },
  );
}
