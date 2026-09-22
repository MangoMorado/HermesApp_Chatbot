import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Practitioner } from "../domain/entities";
import type { PractitionerRepository } from "../domain/ports/repositories";

export type ListPractitionersInput = {
  readonly tenantId: TenantId;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListPractitioners = (input: ListPractitionersInput) => Promise<Page<Practitioner>>;

export function createListPractitioners(repo: PractitionerRepository): ListPractitioners {
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
