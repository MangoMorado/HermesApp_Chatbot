import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import type { HealthcareService, Practitioner, Schedule, Slot } from "../domain/entities";
import type { HermesMasterStore } from "../domain/ports/hermes-masters";
import { mapService } from "./prisma-healthcare-service-repository";
import { mapPractitioner } from "./prisma-practitioner-repository";
import { mapSchedule } from "./prisma-schedule-repository";
import { mapSlot } from "./prisma-slot-repository";

async function translateUniqueViolation(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("El identificador ya existe");
    }
    throw error;
  }
}

function namedMasterData(row: {
  readonly identifier: { readonly system: string; readonly value: string };
  readonly name: string;
  readonly active: boolean;
}) {
  return {
    identifierSystem: row.identifier.system,
    identifierValue: row.identifier.value,
    name: row.name,
    active: row.active,
  };
}

function practitionerData(row: Practitioner) {
  return namedMasterData(row);
}

function serviceData(row: HealthcareService) {
  return namedMasterData(row);
}

function scheduleData(row: Schedule) {
  return {
    identifierSystem: row.identifier.system,
    identifierValue: row.identifier.value,
    practitionerId: row.practitionerId,
    healthcareServiceId: row.healthcareServiceId,
    active: row.active,
  };
}

function slotData(row: Slot) {
  return {
    identifierSystem: row.identifier.system,
    identifierValue: row.identifier.value,
    scheduleId: row.scheduleId,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
  };
}

export function createPrismaHermesMasterStore(db: PrismaExecutor): HermesMasterStore {
  return {
    async findPractitionerByIdentifier(tenantId, identifier) {
      const row = await db.practitioner.findUnique({
        where: {
          tenantId_identifierSystem_identifierValue: {
            tenantId,
            identifierSystem: identifier.system,
            identifierValue: identifier.value,
          },
        },
      });
      return row ? mapPractitioner(row) : null;
    },

    async savePractitioner(row, mode) {
      await translateUniqueViolation(() =>
        mode === "insert"
          ? db.practitioner.create({
              data: { id: row.id, tenantId: row.tenantId, ...practitionerData(row) },
            })
          : db.practitioner.update({
              where: { tenantId_id: { tenantId: row.tenantId, id: row.id } },
              data: practitionerData(row),
            }),
      );
    },

    async findHealthcareServiceByIdentifier(tenantId, identifier) {
      const row = await db.healthcareService.findUnique({
        where: {
          tenantId_identifierSystem_identifierValue: {
            tenantId,
            identifierSystem: identifier.system,
            identifierValue: identifier.value,
          },
        },
      });
      return row ? mapService(row) : null;
    },

    async saveHealthcareService(row, mode) {
      await translateUniqueViolation(() =>
        mode === "insert"
          ? db.healthcareService.create({
              data: { id: row.id, tenantId: row.tenantId, ...serviceData(row) },
            })
          : db.healthcareService.update({
              where: { tenantId_id: { tenantId: row.tenantId, id: row.id } },
              data: serviceData(row),
            }),
      );
    },

    async findScheduleByIdentifier(tenantId, identifier) {
      const row = await db.schedule.findUnique({
        where: {
          tenantId_identifierSystem_identifierValue: {
            tenantId,
            identifierSystem: identifier.system,
            identifierValue: identifier.value,
          },
        },
      });
      return row ? mapSchedule(row) : null;
    },

    async getPractitioner(tenantId, id) {
      const row = await db.practitioner.findFirst({ where: { tenantId, id } });
      return row ? mapPractitioner(row) : null;
    },

    async getHealthcareService(tenantId, id) {
      const row = await db.healthcareService.findFirst({ where: { tenantId, id } });
      return row ? mapService(row) : null;
    },

    async getSchedule(tenantId, id) {
      const row = await db.schedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },

    async saveSchedule(row, mode) {
      await translateUniqueViolation(() =>
        mode === "insert"
          ? db.schedule.create({
              data: { id: row.id, tenantId: row.tenantId, ...scheduleData(row) },
            })
          : db.schedule.update({
              where: { tenantId_id: { tenantId: row.tenantId, id: row.id } },
              data: scheduleData(row),
            }),
      );
    },

    async findSlotByIdentifier(tenantId, identifier) {
      const row = await db.slot.findUnique({
        where: {
          tenantId_identifierSystem_identifierValue: {
            tenantId,
            identifierSystem: identifier.system,
            identifierValue: identifier.value,
          },
        },
      });
      return row ? mapSlot(row) : null;
    },

    async lockSlotForUpdate(tenantId, id) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."slots"
        WHERE "tenant_id" = ${tenantId} AND "id" = ${id}
        FOR UPDATE`;
      if (locked.length === 0) {
        return null;
      }
      const row = await db.slot.findFirst({ where: { tenantId, id } });
      return row ? mapSlot(row) : null;
    },

    async saveSlot(row, mode) {
      await translateUniqueViolation(() =>
        mode === "insert"
          ? db.slot.create({
              data: { id: row.id, tenantId: row.tenantId, ...slotData(row) },
            })
          : db.slot.update({
              where: { tenantId_id: { tenantId: row.tenantId, id: row.id } },
              data: slotData(row),
            }),
      );
    },
  };
}
