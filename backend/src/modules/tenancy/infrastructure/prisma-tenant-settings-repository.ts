import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { TenantSettingsRepository } from "../domain/ports/tenant-settings-repository";

export function createPrismaTenantSettingsRepository(db: PrismaExecutor): TenantSettingsRepository {
  async function get(tenantId: TenantId) {
    const row = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { maxQueryRangeDays: true },
    });
    return row ? { maxQueryRangeDays: row.maxQueryRangeDays } : null;
  }

  return {
    get,
    async update(tenantId, settings) {
      const result = await db.tenant.updateMany({
        where: { id: tenantId },
        data: { maxQueryRangeDays: settings.maxQueryRangeDays },
      });
      return result.count === 0 ? null : get(tenantId);
    },
  };
}
