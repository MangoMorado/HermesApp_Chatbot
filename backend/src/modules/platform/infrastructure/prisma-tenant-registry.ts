import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterIdCursor, pageByIdAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import type { TenantSummary } from "../domain/tenant-registration";

function mapTenant(row: {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}): TenantSummary {
  return { id: row.id, slug: row.slug, name: row.name, createdAt: row.createdAt };
}

export function createPrismaTenantRegistry(db: PrismaExecutor): TenantRegistry {
  return {
    async create(tenant) {
      try {
        return mapTenant(await db.tenant.create({ data: tenant }));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("El slug ya existe", { field: "slug" });
        }
        throw error;
      }
    },
    async exists(id) {
      return (await db.tenant.count({ where: { id } })) > 0;
    },
    async list(filter) {
      const rows = await db.tenant.findMany({
        where: afterIdCursor(filter.cursor),
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapTenant), filter.limit);
    },
  };
}
