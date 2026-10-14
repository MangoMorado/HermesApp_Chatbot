import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { SimInboxStore } from "../domain/ports/inbox";

export function createPrismaSimInboxStore(db: PrismaExecutor): SimInboxStore {
  return {
    async findPatientId(tenantId, identifier) {
      const row = await db.simPatient.findFirst({
        where: { tenantId, identifierSystem: identifier.system, identifierValue: identifier.value },
        select: { id: true },
      });
      return row?.id ?? null;
    },
    async lockSlot(tenantId, identifier) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "hermes_sim"."slots"
        WHERE "tenant_id" = ${tenantId} AND "identifier_system" = ${identifier.system}
          AND "identifier_value" = ${identifier.value}
        FOR UPDATE`;
      const id = locked[0]?.id;
      if (!id) {
        return null;
      }
      const row = await db.simSlot.findFirstOrThrow({ where: { tenantId, id } });
      return {
        id: row.id,
        scheduleId: row.scheduleId,
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
      };
    },
    async findAppointment(tenantId, identifier) {
      const row = await db.simAppointment.findFirst({
        where: { tenantId, identifierSystem: identifier.system, identifierValue: identifier.value },
        select: { id: true, slotId: true },
      });
      return row ?? null;
    },
    async setSlotStatus(tenantId, id, status) {
      await db.simSlot.updateMany({ where: { tenantId, id }, data: { status } });
    },
    async cancelAppointment(tenantId, id) {
      await db.simAppointment.updateMany({
        where: { tenantId, id },
        data: { status: "cancelled" },
      });
    },
    async setAppointmentStatus(tenantId, id, status) {
      await db.simAppointment.updateMany({ where: { tenantId, id }, data: { status } });
    },
    async deleteAppointment(tenantId, id) {
      await db.simAppointment.deleteMany({ where: { tenantId, id } });
    },
    async createAppointment(row) {
      await db.simAppointment.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifier.system,
          identifierValue: row.identifier.value,
          patientId: row.patientId,
          scheduleId: row.scheduleId,
          slotId: row.slotId,
          startAt: row.startAt,
          endAt: row.endAt,
          status: "booked",
        },
      });
    },
  };
}
