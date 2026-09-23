import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { KnowledgeEntry } from "../knowledge-entry";

export type KnowledgeListFilter = {
  readonly tenantId: TenantId;
  readonly category?: string;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limit: number;
};

/** Orden estable: category, position, id. `null` / `false` = no existe en ese tenant. */
export type KnowledgeRepository = {
  list(filter: KnowledgeListFilter): Promise<Page<KnowledgeEntry>>;
  get(tenantId: TenantId, id: string): Promise<KnowledgeEntry | null>;
  count(tenantId: TenantId): Promise<number>;
  create(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  update(entry: KnowledgeEntry): Promise<KnowledgeEntry | null>;
  delete(tenantId: TenantId, id: string): Promise<boolean>;
};
