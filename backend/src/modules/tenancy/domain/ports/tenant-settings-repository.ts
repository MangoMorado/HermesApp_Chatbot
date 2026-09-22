import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantSettings } from "../tenant-settings";

/** `null` significa que el tenant no existe; el caso de uso lo traduce a `not_found`. */
export type TenantSettingsRepository = {
  get(tenantId: TenantId): Promise<TenantSettings | null>;
  update(tenantId: TenantId, settings: TenantSettings): Promise<TenantSettings | null>;
};
