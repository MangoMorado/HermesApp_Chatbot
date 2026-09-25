import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterCursorAsc, pageByStartAtAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import type { Slot, SlotStatus } from "../domain/entities";
import type { SlotRepository } from "../domain/ports/repositories";

export function mapSlot(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  scheduleId: string;
  startAt: Date;
  endAt: Date;
  status: SlotStatus;
}): Slot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
    scheduleId: row.scheduleId,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
  };
}

export function createPrismaSlotRepository(db: PrismaExecutor): SlotRepository {
  return {
    async listAvailability(filter) {
      const rows = await db.slot.findMany({
        where: {
          tenantId: filter.tenantId,
          status: "free",
          startAt: { gte: filter.from, lt: filter.to },
          ...(filter.scheduleId ? { scheduleId: filter.scheduleId } : {}),
          ...(filter.practitionerId || filter.healthcareServiceId
            ? {
                schedule: {
                  ...(filter.practitionerId ? { practitionerId: filter.practitionerId } : {}),
                  ...(filter.healthcareServiceId
                    ? { healthcareServiceId: filter.healthcareServiceId }
                    : {}),
                },
              }
            : {}),
          ...afterCursorAsc(filter.cursor),
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return pageByStartAtAsc(rows.map(mapSlot), filter.limit);
    },

    async listBySchedule(filter) {
      const rows = await db.slot.findMany({
        where: {
          tenantId: filter.tenantId,
          scheduleId: filter.scheduleId,
          startAt: { gte: filter.from, lt: filter.to },
          ...afterCursorAsc(filter.cursor),
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return pageByStartAtAsc(rows.map(mapSlot), filter.limit);
    },
  };
}
