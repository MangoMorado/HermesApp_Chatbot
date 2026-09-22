import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterIdCursor, pageByIdAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import { enumerateSlotStarts } from "../application/generate-slots";
import type {
  SimHealthcareService,
  SimPatient,
  SimPractitioner,
  SimSchedule,
} from "../domain/entities";
import type {
  SimHealthcareServiceStore,
  SimPatientStore,
  SimPractitionerStore,
  SimScheduleStore,
  SimSlotGenerator,
} from "../domain/ports/stores";

const IDENTIFIER_SYSTEM = {
  practitioner: "urn:hermes:practitioner",
  healthcareService: "urn:hermes:healthcare-service",
  schedule: "urn:hermes:schedule",
  slot: "urn:hermes:slot",
  patient: "urn:hermes:patient",
} as const;

export function createPrismaSimPractitionerStore(db: PrismaExecutor): SimPractitionerStore {
  return {
    async list(filter) {
      const rows = await db.simPractitioner.findMany({
        where: { tenantId: filter.tenantId, ...afterIdCursor(filter.cursor) },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapPractitioner), filter.limit);
    },
    async get(tenantId, id) {
      const row = await db.simPractitioner.findFirst({ where: { tenantId, id } });
      return row ? mapPractitioner(row) : null;
    },
    async create(row) {
      const created = await db.simPractitioner.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifierSystem,
          identifierValue: row.identifierValue,
          name: row.name,
          active: row.active,
        },
      });
      return mapPractitioner(created);
    },
    async update(row) {
      const result = await db.simPractitioner.updateMany({
        where: { tenantId: row.tenantId, id: row.id },
        data: { name: row.name, active: row.active },
      });
      if (result.count === 0) {
        return null;
      }
      const found = await db.simPractitioner.findFirst({
        where: { tenantId: row.tenantId, id: row.id },
      });
      return found ? mapPractitioner(found) : null;
    },
    async delete(tenantId, id) {
      const existing = await db.simPractitioner.findFirst({ where: { tenantId, id } });
      if (!existing) {
        return "missing";
      }
      const dependents = await db.simSchedule.count({ where: { tenantId, practitionerId: id } });
      if (dependents > 0) {
        return "has_dependents";
      }
      await db.simPractitioner.delete({ where: { id } });
      return "ok";
    },
  };
}

export function createPrismaSimHealthcareServiceStore(
  db: PrismaExecutor,
): SimHealthcareServiceStore {
  return {
    async list(filter) {
      const rows = await db.simHealthcareService.findMany({
        where: { tenantId: filter.tenantId, ...afterIdCursor(filter.cursor) },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapService), filter.limit);
    },
    async get(tenantId, id) {
      const row = await db.simHealthcareService.findFirst({ where: { tenantId, id } });
      return row ? mapService(row) : null;
    },
    async create(row) {
      const created = await db.simHealthcareService.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifierSystem,
          identifierValue: row.identifierValue,
          name: row.name,
          active: row.active,
        },
      });
      return mapService(created);
    },
    async update(row) {
      const result = await db.simHealthcareService.updateMany({
        where: { tenantId: row.tenantId, id: row.id },
        data: { name: row.name, active: row.active },
      });
      if (result.count === 0) {
        return null;
      }
      const found = await db.simHealthcareService.findFirst({
        where: { tenantId: row.tenantId, id: row.id },
      });
      return found ? mapService(found) : null;
    },
    async delete(tenantId, id) {
      const existing = await db.simHealthcareService.findFirst({ where: { tenantId, id } });
      if (!existing) {
        return "missing";
      }
      const dependents = await db.simSchedule.count({
        where: { tenantId, healthcareServiceId: id },
      });
      if (dependents > 0) {
        return "has_dependents";
      }
      await db.simHealthcareService.delete({ where: { id } });
      return "ok";
    },
  };
}

export function createPrismaSimScheduleStore(db: PrismaExecutor): SimScheduleStore {
  return {
    async list(filter) {
      const rows = await db.simSchedule.findMany({
        where: { tenantId: filter.tenantId, ...afterIdCursor(filter.cursor) },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapSchedule), filter.limit);
    },
    async get(tenantId, id) {
      const row = await db.simSchedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },
    async create(row) {
      const created = await db.simSchedule.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifierSystem,
          identifierValue: row.identifierValue,
          practitionerId: row.practitionerId,
          healthcareServiceId: row.healthcareServiceId,
          active: row.active,
        },
      });
      return mapSchedule(created);
    },
    async update(row) {
      const result = await db.simSchedule.updateMany({
        where: { tenantId: row.tenantId, id: row.id },
        data: { active: row.active },
      });
      if (result.count === 0) {
        return null;
      }
      const found = await db.simSchedule.findFirst({
        where: { tenantId: row.tenantId, id: row.id },
      });
      return found ? mapSchedule(found) : null;
    },
    async delete(tenantId, id) {
      const existing = await db.simSchedule.findFirst({ where: { tenantId, id } });
      if (!existing) {
        return "missing";
      }
      const slots = await db.simSlot.count({ where: { tenantId, scheduleId: id } });
      const appointments = await db.simAppointment.count({ where: { tenantId, scheduleId: id } });
      if (slots > 0 || appointments > 0) {
        return "has_dependents";
      }
      await db.simSchedule.delete({ where: { id } });
      return "ok";
    },
  };
}

export function createPrismaSimPatientStore(db: PrismaExecutor): SimPatientStore {
  return {
    async list(filter) {
      const rows = await db.simPatient.findMany({
        where: { tenantId: filter.tenantId, ...afterIdCursor(filter.cursor) },
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapPatient), filter.limit);
    },
    async get(tenantId, id) {
      const row = await db.simPatient.findFirst({ where: { tenantId, id } });
      return row ? mapPatient(row) : null;
    },
    async create(row) {
      const created = await db.simPatient.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifierSystem,
          identifierValue: row.identifierValue,
          documentType: row.documentType,
          documentNumber: row.documentNumber,
          givenNames: row.givenNames,
          familyNames: row.familyNames,
          birthDate: new Date(`${row.birthDate}T00:00:00.000Z`),
          phone: row.phone,
          email: row.email,
          status: row.status,
        },
      });
      return mapPatient(created);
    },
    async update(row) {
      const result = await db.simPatient.updateMany({
        where: { tenantId: row.tenantId, id: row.id },
        data: {
          givenNames: row.givenNames,
          familyNames: row.familyNames,
          phone: row.phone,
          email: row.email,
          status: row.status,
        },
      });
      if (result.count === 0) {
        return null;
      }
      const found = await db.simPatient.findFirst({
        where: { tenantId: row.tenantId, id: row.id },
      });
      return found ? mapPatient(found) : null;
    },
    async delete(tenantId, id) {
      const existing = await db.simPatient.findFirst({ where: { tenantId, id } });
      if (!existing) {
        return "missing";
      }
      const dependents = await db.simAppointment.count({ where: { tenantId, patientId: id } });
      if (dependents > 0) {
        return "has_dependents";
      }
      await db.simPatient.delete({ where: { id } });
      return "ok";
    },
  };
}

export function createPrismaSimSlotGenerator(
  db: PrismaExecutor,
  ids: IdGenerator,
): SimSlotGenerator {
  return {
    async generate(input) {
      const starts = enumerateSlotStarts(
        input.from,
        input.to,
        input.durationMinutes,
        input.windows,
        input.timeZone,
      );
      let created = 0;
      for (const startAt of starts) {
        const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
        const overlap = await db.simSlot.findFirst({
          where: {
            tenantId: input.tenantId,
            scheduleId: input.scheduleId,
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });
        if (overlap) {
          continue;
        }
        const id = ids.next();
        await db.simSlot.create({
          data: {
            id,
            tenantId: input.tenantId,
            identifierSystem: IDENTIFIER_SYSTEM.slot,
            identifierValue: id,
            scheduleId: input.scheduleId,
            startAt,
            endAt,
            status: "free",
          },
        });
        created += 1;
      }
      return created;
    },
  };
}

function mapPractitioner(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  name: string;
  active: boolean;
}): SimPractitioner {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifierSystem: row.identifierSystem,
    identifierValue: row.identifierValue,
    name: row.name,
    active: row.active,
  };
}

function mapService(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  name: string;
  active: boolean;
}): SimHealthcareService {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifierSystem: row.identifierSystem,
    identifierValue: row.identifierValue,
    name: row.name,
    active: row.active,
  };
}

function mapSchedule(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  practitionerId: string;
  healthcareServiceId: string;
  active: boolean;
}): SimSchedule {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifierSystem: row.identifierSystem,
    identifierValue: row.identifierValue,
    practitionerId: row.practitionerId,
    healthcareServiceId: row.healthcareServiceId,
    active: row.active,
  };
}

function mapPatient(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  documentType: SimPatient["documentType"];
  documentNumber: string;
  givenNames: string;
  familyNames: string;
  birthDate: Date;
  phone: string | null;
  email: string | null;
  status: SimPatient["status"];
}): SimPatient {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifierSystem: row.identifierSystem,
    identifierValue: row.identifierValue,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    givenNames: row.givenNames,
    familyNames: row.familyNames,
    birthDate: row.birthDate.toISOString().slice(0, 10),
    phone: row.phone,
    email: row.email,
    status: row.status,
  };
}
