import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantSettingsRepository } from "../domain/ports/tenant-settings-repository";
import { type TenantSettings, validateTenantSettings } from "../domain/tenant-settings";

export type GetTenantSettings = (tenantId: TenantId) => Promise<TenantSettings>;

export function createGetTenantSettings(repo: TenantSettingsRepository): GetTenantSettings {
  return async (tenantId) => {
    const settings = await repo.get(tenantId);
    if (!settings) {
      throw new NotFoundError();
    }
    return settings;
  };
}

export type UpdateTenantSettingsInput = {
  readonly tenantId: TenantId;
  readonly maxQueryRangeDays: number;
  readonly actorSubject: string;
  readonly actorRole: string;
  readonly requestId: string;
};

export type UpdateTenantSettings = (input: UpdateTenantSettingsInput) => Promise<TenantSettings>;

export function createUpdateTenantSettings(
  repo: TenantSettingsRepository,
  audit: AuditLog,
  clock: Clock,
): UpdateTenantSettings {
  return async (input) => {
    const settings = validateTenantSettings({ maxQueryRangeDays: input.maxQueryRangeDays });
    const updated = await repo.update(input.tenantId, settings);
    if (!updated) {
      throw new NotFoundError();
    }
    await audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "tenant_settings.updated",
      resourceType: "tenant",
      resourceId: input.tenantId,
      requestId: input.requestId,
      occurredAt: clock.now(),
    });
    return updated;
  };
}
