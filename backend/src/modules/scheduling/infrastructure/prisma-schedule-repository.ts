import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterIdCursor, pageByIdAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import type { Schedule } from "../domain/entities";
import type { ScheduleRepository } from "../domain/ports/repositories";

export function mapSchedule(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  practitionerId: string;
  healthcareServiceId: string;
  active: boolean;
}): Schedule {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
    practitionerId: row.practitionerId,
    healthcareServiceId: row.healthcareServiceId,
    active: row.active,
  };
}

export function createPrismaScheduleRepository(db: PrismaExecutor): ScheduleRepository {
  return {
    async list(filter) {
      const rows = await db.schedule.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.active === undefined ? {} : { active: filter.active }),
          ...(filter.practitionerId ? { practitionerId: filter.practitionerId } : {}),
          ...(filter.healthcareServiceId
            ? { healthcareServiceId: filter.healthcareServiceId }
            : {}),
          ...afterIdCursor(filter.cursor),
        },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapSchedule), filter.limit);
    },

    async get(tenantId, id) {
      const row = await db.schedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },
  };
}
