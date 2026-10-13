import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { fhirNotFound } from "../domain/fhir-error";
import { isResourceType } from "../domain/profiles";
import type { FhirResource } from "../domain/resources/types";
import type { ResourceHandlers } from "./resource-handlers";

export type ReadResource = (tenantId: TenantId, type: string, id: string) => Promise<FhirResource>;

/** Tipo desconocido, id inexistente o de otro tenant: el mismo `not-found`. */
export function createReadResource(handlers: ResourceHandlers): ReadResource {
  return async (tenantId, type, id) => {
    const resource = isResourceType(type) ? await handlers[type].read(tenantId, id) : null;
    if (!resource) {
      throw fhirNotFound();
    }
    return resource;
  };
}
