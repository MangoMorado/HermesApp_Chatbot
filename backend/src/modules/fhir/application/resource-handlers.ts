import type { OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { FhirSource, FhirSources } from "../domain/ports/sources";
import type { ResourceType } from "../domain/profiles";
import { DEFINITIONS, type ResourceDefinition, type SearchContext } from "../domain/registry";
import type { FhirResource } from "../domain/resources/types";
import { assertSupported } from "../domain/search";

export type SearchResult = OffsetWindow & {
  readonly resources: readonly FhirResource[];
  readonly total: number;
};

export type ResourceHandler = {
  read(tenantId: TenantId, id: string): Promise<FhirResource | null>;
  search(tenantId: TenantId, context: SearchContext): Promise<SearchResult>;
};

export type ResourceHandlers = Readonly<Record<ResourceType, ResourceHandler>>;

/** Une la definicion de un recurso con su fuente, borrando los tipos del registro. */
function bind<R, Q extends OffsetWindow>(
  definition: ResourceDefinition<R, Q>,
  source: FhirSource<R, Q>,
): ResourceHandler {
  return {
    async read(tenantId, id) {
      const record = await source.read(tenantId, id);
      return record ? definition.toResource(record) : null;
    },
    async search(tenantId, context) {
      assertSupported(
        context.params,
        definition.searchParams.map((param) => param.name),
      );
      const query = definition.buildQuery(context);
      const page = await source.search(tenantId, query);
      return {
        resources: page.data.map((record) => definition.toResource(record)),
        total: page.total,
        offset: query.offset,
        limit: query.limit,
      };
    },
  };
}

export function createResourceHandlers(sources: FhirSources): ResourceHandlers {
  return {
    Patient: bind(DEFINITIONS.Patient, sources.Patient),
    Practitioner: bind(DEFINITIONS.Practitioner, sources.Practitioner),
    HealthcareService: bind(DEFINITIONS.HealthcareService, sources.HealthcareService),
    Schedule: bind(DEFINITIONS.Schedule, sources.Schedule),
    Slot: bind(DEFINITIONS.Slot, sources.Slot),
    Appointment: bind(DEFINITIONS.Appointment, sources.Appointment),
  };
}
