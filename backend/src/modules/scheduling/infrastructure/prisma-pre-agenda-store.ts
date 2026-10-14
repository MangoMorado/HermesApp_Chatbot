import { type AppointmentRequest as AppointmentRequestRow, Prisma } from "@prisma/client";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import { type AppointmentRequest, preAgendaConflict } from "../domain/appointment-request";
import type {
  ExpiryScope,
  NewAppointmentRequest,
  PreAgendaStore,
  RequestExpirer,
} from "../domain/ports/pre-agenda";
import { mapAppointment } from "./prisma-appointment-repository";
import { mapSchedule } from "./prisma-schedule-repository";
import { mapSlot } from "./prisma-slot-repository";

export function mapRequest(row: AppointmentRequestRow): AppointmentRequest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    status: row.status,
    medicalRecordId: row.medicalRecordId,
    slotId: row.slotId,
    appointmentId: row.appointmentId,
    expiresAt: row.expiresAt,
    resolutionReason: row.resolutionReason,
    resultingAppointmentId: row.resultingAppointmentId,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

function scopeFilter(scope: ExpiryScope | undefined): Prisma.Sql {
  if (!scope) {
    return Prisma.empty;
  }
  return "slotId" in scope
    ? Prisma.sql`AND "slot_id" = ${scope.slotId}`
    : Prisma.sql`AND "appointment_id" = ${scope.appointmentId}`;
}

/** Un solo UPDATE por conjunto: vence pendientes y libera sus cupos apartados. */
export function createPrismaRequestExpirer(db: PrismaExecutor): RequestExpirer {
  return {
    async expireDue(tenantId, now, scope) {
      await db.$executeRaw`
        WITH expired AS (
          UPDATE "public"."appointment_requests"
          SET "status" = 'expired', "resolved_at" = ${now}
          WHERE "tenant_id" = ${tenantId} AND "status" = 'pending' AND "expires_at" <= ${now}
          ${scopeFilter(scope)}
          RETURNING "slot_id"
        )
        UPDATE "public"."slots" SET "status" = 'free', "updated_at" = ${now}
        WHERE "tenant_id" = ${tenantId} AND "status" = 'busy_tentative'
          AND "id" IN (SELECT "slot_id" FROM expired WHERE "slot_id" IS NOT NULL)`;
    },
  };
}

function preAgendaReads(db: PrismaExecutor) {
  return {
    async lockMedicalRecord(tenantId: TenantId, medicalRecordId: string) {
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."medical_records"
        WHERE "tenant_id" = ${tenantId} AND "id" = ${medicalRecordId} FOR UPDATE`;
      return rows.length === 1;
    },
    async getSlot(tenantId: TenantId, id: string) {
      const row = await db.slot.findFirst({ where: { tenantId, id } });
      return row ? mapSlot(row) : null;
    },
    async getSchedule(tenantId: TenantId, id: string) {
      const row = await db.schedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },
    async getAppointment(tenantId: TenantId, id: string) {
      const row = await db.appointment.findFirst({ where: { tenantId, id } });
      return row ? mapAppointment(row) : null;
    },
    countLiveHolds(tenantId: TenantId, medicalRecordId: string, now: Date) {
      return db.appointmentRequest.count({
        where: {
          tenantId,
          medicalRecordId,
          status: "pending",
          kind: { in: ["book", "reschedule"] },
          expiresAt: { gt: now },
        },
      });
    },
    async findLiveHoldBySlot(tenantId: TenantId, slotId: string, now: Date) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."appointment_requests"
        WHERE "tenant_id" = ${tenantId} AND "slot_id" = ${slotId}
          AND "status" = 'pending' AND "expires_at" > ${now}
        FOR UPDATE`;
      if (locked.length === 0) {
        return null;
      }
      const requestId = locked[0]?.id;
      if (!requestId) {
        return null;
      }
      return mapRequest(
        await db.appointmentRequest.findFirstOrThrow({
          where: { tenantId, id: requestId },
        }),
      );
    },
    async getRequestForUpdate(tenantId: TenantId, id: string) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."appointment_requests"
        WHERE "tenant_id" = ${tenantId} AND "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        return null;
      }
      return mapRequest(await db.appointmentRequest.findFirstOrThrow({ where: { tenantId, id } }));
    },
  };
}

async function insertRequest(db: PrismaExecutor, row: NewAppointmentRequest) {
  try {
    return mapRequest(await db.appointmentRequest.create({ data: { ...row, status: "pending" } }));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // El cupo ya lo apartamos con holdSlot: el unico choque posible es la cita.
    throw row.appointmentId
      ? preAgendaConflict("appointment_change_pending", "La cita ya tiene un cambio pendiente")
      : preAgendaConflict("slot_unavailable", "El cupo ya esta apartado");
  }
}

function preAgendaWrites(db: PrismaExecutor) {
  return {
    async holdSlot(tenantId: TenantId, slotId: string) {
      const result = await db.slot.updateMany({
        where: { tenantId, id: slotId, status: "free" },
        data: { status: "busy_tentative" },
      });
      return result.count === 1;
    },
    insertRequest: (row: NewAppointmentRequest) => insertRequest(db, row),
    async setSlotStatus(
      tenantId: TenantId,
      slotId: string,
      status: Parameters<PreAgendaStore["setSlotStatus"]>[2],
    ) {
      await db.slot.updateMany({ where: { tenantId, id: slotId }, data: { status } });
    },
    async insertAppointment(row: Parameters<PreAgendaStore["insertAppointment"]>[0]) {
      await db.appointment.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifier.system,
          identifierValue: row.identifier.value,
          medicalRecordId: row.medicalRecordId,
          scheduleId: row.scheduleId,
          slotId: row.slotId,
          startAt: row.startAt,
          endAt: row.endAt,
          status: "booked",
        },
      });
    },
    async setAppointmentStatus(
      tenantId: TenantId,
      id: string,
      status: Parameters<PreAgendaStore["setAppointmentStatus"]>[2],
    ) {
      await db.appointment.updateMany({ where: { tenantId, id }, data: { status } });
    },
    async markResolved(
      tenantId: TenantId,
      id: string,
      patch: Parameters<PreAgendaStore["markResolved"]>[2],
    ) {
      await db.appointmentRequest.updateMany({ where: { tenantId, id }, data: patch });
      return mapRequest(await db.appointmentRequest.findFirstOrThrow({ where: { tenantId, id } }));
    },
  };
}

export function createPrismaPreAgendaStore(db: PrismaExecutor): PreAgendaStore {
  return { ...createPrismaRequestExpirer(db), ...preAgendaReads(db), ...preAgendaWrites(db) };
}
