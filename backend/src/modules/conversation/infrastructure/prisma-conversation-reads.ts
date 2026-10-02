import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { VerifiableRecord } from "@/modules/verification/domain/questions";
import type { ConversationReads } from "../domain/reads";

const MAX_UPCOMING = 10;

function toRecord(row: {
  id: string;
  birthDate: Date;
  phone: string | null;
  email: string | null;
}): VerifiableRecord {
  return {
    id: row.id,
    birthDate: row.birthDate.toISOString().slice(0, 10),
    phone: row.phone,
    email: row.email,
  };
}

const withNames = {
  schedule: { include: { practitioner: true, healthcareService: true } },
} as const;

export type PrismaConversationReads = Omit<ConversationReads, "challenge" | "searchKnowledge"> & {
  listActiveKnowledge(tenantId: string): Promise<
    {
      id: string;
      question: string;
      answer: string;
      detail: string | null;
      keywords: string[];
      position: number;
      active: boolean;
    }[]
  >;
  clinicName(tenantId: string): Promise<string>;
};

/** Lecturas del chat sobre tablas de dominio. El desafio y la busqueda los compone el root. */
export function createPrismaConversationReads(db: PrismaExecutor): PrismaConversationReads {
  return {
    async findPatient(tenantId, documentType, documentNumber) {
      const row = await db.medicalRecord.findUnique({
        where: { tenantId_documentType_documentNumber: { tenantId, documentType, documentNumber } },
      });
      return row ? toRecord(row) : null;
    },
    async getPatient(tenantId, id) {
      const row = await db.medicalRecord.findFirst({ where: { tenantId, id } });
      return row ? toRecord(row) : null;
    },
    async getKnowledge(tenantId, id) {
      const row = await db.knowledgeEntry.findFirst({ where: { tenantId, id, active: true } });
      return row && { id: row.id, question: row.question, answer: row.answer, detail: row.detail };
    },
    listActiveKnowledge(tenantId) {
      return db.knowledgeEntry.findMany({ where: { tenantId, active: true } });
    },
    listServices(tenantId) {
      return db.healthcareService.findMany({
        where: { tenantId, schedules: { some: { active: true } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    },
    listPractitioners(tenantId, serviceId) {
      return db.practitioner.findMany({
        where: { tenantId, schedules: { some: { active: true, healthcareServiceId: serviceId } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    },
    async listAvailableSlots(tenantId, filter) {
      const rows = await db.slot.findMany({
        where: {
          tenantId,
          status: "free",
          startAt: { gte: filter.from, lt: filter.to },
          schedule: {
            active: true,
            healthcareServiceId: filter.serviceId,
            ...(filter.practitionerId ? { practitionerId: filter.practitionerId } : {}),
          },
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: filter.limit,
        include: withNames,
      });
      return rows.map((row) => ({
        id: row.id,
        startAt: row.startAt,
        serviceName: row.schedule.healthcareService.name,
        practitionerName: row.schedule.practitioner.name,
      }));
    },
    async listUpcomingAppointments(tenantId, medicalRecordId, now) {
      const rows = await db.appointment.findMany({
        where: { tenantId, medicalRecordId, status: "booked", startAt: { gt: now } },
        orderBy: { startAt: "asc" },
        take: MAX_UPCOMING,
        include: withNames,
      });
      return rows.map((row) => ({
        id: row.id,
        startAt: row.startAt,
        serviceId: row.schedule.healthcareServiceId,
        serviceName: row.schedule.healthcareService.name,
        practitionerName: row.schedule.practitioner.name,
      }));
    },
    async clinicName(tenantId) {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      return tenant?.name ?? "";
    },
  };
}
