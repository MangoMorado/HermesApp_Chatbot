import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterIdCursor, pageByIdAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import type { Practitioner } from "../domain/entities";
import type { PractitionerRepository } from "../domain/ports/repositories";

function mapPractitioner(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  name: string;
  active: boolean;
}): Practitioner {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
    name: row.name,
    active: row.active,
  };
}

export function createPrismaPractitionerRepository(db: PrismaExecutor): PractitionerRepository {
  return {
    async list(filter) {
      const rows = await db.practitioner.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.active === undefined ? {} : { active: filter.active }),
          ...afterIdCursor(filter.cursor),
        },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapPractitioner), filter.limit);
    },
  };
}
