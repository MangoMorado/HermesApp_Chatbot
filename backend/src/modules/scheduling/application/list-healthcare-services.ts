import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HealthcareService } from "../domain/entities";
import type { HealthcareServiceRepository } from "../domain/ports/repositories";

export type ListHealthcareServicesInput = {
  readonly tenantId: TenantId;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListHealthcareServices = (
  input: ListHealthcareServicesInput,
) => Promise<Page<HealthcareService>>;

export function createListHealthcareServices(
  repo: HealthcareServiceRepository,
): ListHealthcareServices {
  return async (input) => {
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return repo.list({
      tenantId: input.tenantId,
      active: input.active,
      cursor: input.cursor,
      limit,
    });
  };
}
