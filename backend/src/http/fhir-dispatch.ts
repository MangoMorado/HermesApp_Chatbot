import type { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { fhirMethodNotAllowed, fhirNotFound } from "@/modules/fhir/domain/fhir-error";
import { isResourceType } from "@/modules/fhir/domain/profiles";
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

/** La 4.1 es solo lectura: recurso conocido -> 405; desconocido -> 404. */
export function handleFhirWrite(request: Request, path: readonly string[]): Promise<NextResponse> {
  return serviceFhirRoute(request, async () => {
    const [type] = path;
    throw type !== undefined && isResourceType(type) ? fhirMethodNotAllowed("GET") : fhirNotFound();
  });
}
