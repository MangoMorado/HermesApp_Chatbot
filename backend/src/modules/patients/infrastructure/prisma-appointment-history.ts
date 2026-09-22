import { toPage } from "@/modules/shared/domain/pagination";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterCursorDesc } from "@/modules/shared/infrastructure/prisma-cursor";
import type { HistoryAppointment } from "../domain/entities";
import type { AppointmentHistory } from "../domain/ports/repositories";

export function createPrismaAppointmentHistory(db: PrismaExecutor): AppointmentHistory {
  return {
    async list(filter) {
      const rows = await db.appointment.findMany({
        where: {
          tenantId: filter.tenantId,
          medicalRecordId: filter.medicalRecordId,
          ...afterCursorDesc(filter.cursor),
        },
        orderBy: [{ startAt: "desc" }, { id: "desc" }],
        take: filter.limit + 1,
      });
      const mapped: HistoryAppointment[] = rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        scheduleId: row.scheduleId,
        slotId: row.slotId,
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
      }));
      return toPage(mapped, filter.limit, (row) => ({
        key: row.startAt.toISOString(),
        id: row.id,
      }));
    },
  };
}
