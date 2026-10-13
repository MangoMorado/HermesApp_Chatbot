import type { OffsetWindow } from "@/modules/shared/domain/pagination";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { HermesIdentifier } from "../domain/entities";
import type {
  AppointmentSearch,
  AppointmentWithActors,
  MasterSearch,
  SchedulingDirectory,
  SlotSearch,
  TimeBound,
} from "../domain/ports/directory";
import { mapAppointment } from "./prisma-appointment-repository";
import { mapService } from "./prisma-healthcare-service-repository";
import { mapPractitioner } from "./prisma-practitioner-repository";
import { mapSchedule } from "./prisma-schedule-repository";
import { mapSlot } from "./prisma-slot-repository";

function byIdentifier(identifier: HermesIdentifier | null) {
  return identifier
    ? { identifierSystem: identifier.system, identifierValue: identifier.value }
    : {};
}

function startFilter(bound: TimeBound) {
  switch (bound.op) {
    case "ge":
      return { startAt: { gte: bound.at } };
    case "gt":
      return { startAt: { gt: bound.at } };
    case "le":
      return { startAt: { lte: bound.at } };
    case "lt":
      return { startAt: { lt: bound.at } };
  }
}

function windowOf(search: OffsetWindow) {
  return { skip: search.offset, take: search.limit };
}

function masterWhere(search: MasterSearch) {
  return {
    tenantId: search.tenantId,
    ...byIdentifier(search.identifier),
    ...(search.active === null ? {} : { active: search.active }),
  };
}

function slotWhere(search: SlotSearch) {
  return {
    tenantId: search.tenantId,
    ...byIdentifier(search.identifier),
    ...(search.scheduleId === null ? {} : { scheduleId: search.scheduleId }),
    ...(search.status === null ? {} : { status: search.status }),
    AND: search.start.map(startFilter),
  };
}

function appointmentWhere(search: AppointmentSearch) {
  return {
    tenantId: search.tenantId,
    ...byIdentifier(search.identifier),
    ...(search.medicalRecordId === null ? {} : { medicalRecordId: search.medicalRecordId }),
    ...(search.slotId === null ? {} : { slotId: search.slotId }),
    ...(search.status === null ? {} : { status: search.status }),
    AND: search.start.map(startFilter),
  };
}

const BY_START = [{ startAt: "asc" as const }, { id: "asc" as const }];
const WITH_ACTORS = {
  schedule: { select: { practitionerId: true, healthcareServiceId: true } },
} as const;

type AppointmentRow = Parameters<typeof mapAppointment>[0] & {
  schedule: { practitionerId: string; healthcareServiceId: string };
};

function mapWithActors(row: AppointmentRow): AppointmentWithActors {
  return {
    ...mapAppointment(row),
    practitionerId: row.schedule.practitionerId,
    healthcareServiceId: row.schedule.healthcareServiceId,
  };
}

function practitionerReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getPractitioner" | "searchPractitioners"> {
  return {
    async getPractitioner(tenantId, id) {
      const row = await db.practitioner.findFirst({ where: { tenantId, id } });
      return row ? mapPractitioner(row) : null;
    },
    async searchPractitioners(search) {
      const where = masterWhere(search);
      const [rows, total] = await Promise.all([
        db.practitioner.findMany({ where, orderBy: { id: "asc" }, ...windowOf(search) }),
        db.practitioner.count({ where }),
      ]);
      return { data: rows.map(mapPractitioner), total };
    },
  };
}

function serviceReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getHealthcareService" | "searchHealthcareServices"> {
  return {
    async getHealthcareService(tenantId, id) {
      const row = await db.healthcareService.findFirst({ where: { tenantId, id } });
      return row ? mapService(row) : null;
    },
    async searchHealthcareServices(search) {
      const where = masterWhere(search);
      const [rows, total] = await Promise.all([
        db.healthcareService.findMany({ where, orderBy: { id: "asc" }, ...windowOf(search) }),
        db.healthcareService.count({ where }),
      ]);
      return { data: rows.map(mapService), total };
    },
  };
}

function scheduleReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getSchedule" | "searchSchedules"> {
  return {
    async getSchedule(tenantId, id) {
      const row = await db.schedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },
    async searchSchedules(search) {
      const where = {
        ...masterWhere(search),
        ...(search.practitionerId === null ? {} : { practitionerId: search.practitionerId }),
        ...(search.healthcareServiceId === null
          ? {}
          : { healthcareServiceId: search.healthcareServiceId }),
      };
      const [rows, total] = await Promise.all([
        db.schedule.findMany({ where, orderBy: { id: "asc" }, ...windowOf(search) }),
        db.schedule.count({ where }),
      ]);
      return { data: rows.map(mapSchedule), total };
    },
  };
}

function slotReads(db: PrismaExecutor): Pick<SchedulingDirectory, "getSlot" | "searchSlots"> {
  return {
    async getSlot(tenantId, id) {
      const row = await db.slot.findFirst({ where: { tenantId, id } });
      return row ? mapSlot(row) : null;
    },
    async searchSlots(search) {
      const where = slotWhere(search);
      const [rows, total] = await Promise.all([
        db.slot.findMany({ where, orderBy: BY_START, ...windowOf(search) }),
        db.slot.count({ where }),
      ]);
      return { data: rows.map(mapSlot), total };
    },
  };
}

function appointmentReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getAppointment" | "searchAppointments"> {
  return {
    async getAppointment(tenantId, id) {
      const row = await db.appointment.findFirst({ where: { tenantId, id }, include: WITH_ACTORS });
      return row ? mapWithActors(row) : null;
    },
    async searchAppointments(search) {
      const where = appointmentWhere(search);
      const [rows, total] = await Promise.all([
        db.appointment.findMany({
          where,
          include: WITH_ACTORS,
          orderBy: BY_START,
          ...windowOf(search),
        }),
        db.appointment.count({ where }),
      ]);
      return { data: rows.map(mapWithActors), total };
    },
  };
}

/** Lecturas por id y por desplazamiento; todas filtran por tenant. */
export function createPrismaSchedulingDirectory(db: PrismaExecutor): SchedulingDirectory {
  return {
    ...practitionerReads(db),
    ...serviceReads(db),
    ...scheduleReads(db),
    ...slotReads(db),
    ...appointmentReads(db),
  };
}
