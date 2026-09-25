import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterCursorAsc, pageByStartAtAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import type { Appointment, AppointmentStatus } from "../domain/entities";
import type { AppointmentRepository } from "../domain/ports/repositories";

export function mapAppointment(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  medicalRecordId: string;
  scheduleId: string;
  slotId: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
}): Appointment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
    medicalRecordId: row.medicalRecordId,
    scheduleId: row.scheduleId,
    slotId: row.slotId,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
  };
}

export function createPrismaAppointmentRepository(db: PrismaExecutor): AppointmentRepository {
  return {
    async listBySchedule(filter) {
      const rows = await db.appointment.findMany({
        where: {
          tenantId: filter.tenantId,
          scheduleId: filter.scheduleId,
          startAt: { gte: filter.from, lt: filter.to },
          ...afterCursorAsc(filter.cursor),
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return pageByStartAtAsc(rows.map(mapAppointment), filter.limit);
    },
  };
}
