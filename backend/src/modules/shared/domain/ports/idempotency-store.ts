import type { IdempotencyRecord } from "../idempotency";
import type { TenantId } from "../tenant-id";

export type IdempotencyStore = {
  find(tenantId: TenantId, key: string): Promise<IdempotencyRecord | null>;
  /** Lanza `IdempotencyKeyTakenError` si la clave ya existe para el tenant. */
  save(record: IdempotencyRecord): Promise<void>;
};
