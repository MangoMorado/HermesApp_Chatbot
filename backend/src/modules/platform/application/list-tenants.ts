import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import type { TenantSummary } from "../domain/tenant-registration";

export type ListTenants = (input: {
  cursor?: string | null;
  limitRaw?: string | null;
}) => Promise<Page<TenantSummary>>;

export function createListTenants(registry: TenantRegistry): ListTenants {
  return async (input) => {
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return registry.list({ cursor: input.cursor, limit });
  };
}
