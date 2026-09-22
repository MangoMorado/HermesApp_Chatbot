import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterIdCursor, pageByIdAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import type { HealthcareService } from "../domain/entities";
import type { HealthcareServiceRepository } from "../domain/ports/repositories";

function mapService(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  name: string;
  active: boolean;
}): HealthcareService {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
    name: row.name,
    active: row.active,
  };
}

export function createPrismaHealthcareServiceRepository(
  db: PrismaExecutor,
): HealthcareServiceRepository {
  return {
    async list(filter) {
      const rows = await db.healthcareService.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.active === undefined ? {} : { active: filter.active }),
          ...afterIdCursor(filter.cursor),
        },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapService), filter.limit);
    },
  };
}
