import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantSummary } from "../tenant-registration";

export type TenantRegistry = {
  /** Lanza `ConflictError` (`field: slug`) si el slug ya existe. */
  create(tenant: { id: string; slug: string; name: string }): Promise<TenantSummary>;
  exists(id: string): Promise<boolean>;
  list(filter: { cursor?: string | null; limit: number }): Promise<Page<TenantSummary>>;
};
