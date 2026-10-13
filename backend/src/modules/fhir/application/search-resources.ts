import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { searchBundle } from "../domain/bundle";
import { fhirNotFound } from "../domain/fhir-error";
import { isResourceType } from "../domain/profiles";
import type { FhirBundle } from "../domain/resources/types";
import { collectParams } from "../domain/search";
import type { ResourceHandlers } from "./resource-handlers";

export type SearchResourcesInput = {
  readonly tenantId: TenantId;
  readonly type: string;
  /** Parametros de la query tal como llegaron, en orden. */
  readonly entries: readonly (readonly [string, string])[];
  readonly baseUrl: string;
};

export type SearchResources = (input: SearchResourcesInput) => Promise<FhirBundle>;

export function createSearchResources(
  handlers: ResourceHandlers,
  timeZone: string,
): SearchResources {
  return async (input) => {
    if (!isResourceType(input.type)) {
      throw fhirNotFound();
    }
    const result = await handlers[input.type].search(input.tenantId, {
      params: collectParams(input.entries),
      timeZone,
    });
    return searchBundle({
      baseUrl: input.baseUrl,
      type: input.type,
      filters: input.entries,
      ...result,
    });
  };
}
