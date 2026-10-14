import type { PrismaClient } from "@prisma/client";
import type { SimPatient, SimSlot } from "../domain/entities";
import type { SimCatalog } from "../domain/ports/catalog";

type PatientRow = {
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
};

function patientOf(row: PatientRow): SimPatient {
  return { ...row, birthDate: row.birthDate.toISOString().slice(0, 10) };
}

function slotOf(row: SimSlot & { startAt: Date; endAt: Date }): SimSlot {
  return row;
}

/** Lectura de todos los maestros de un tenant, sin paginar: el sync los recorre enteros. */
export function createPrismaSimCatalog(prisma: PrismaClient): SimCatalog {
  return {
    practitioners: (tenantId) => prisma.simPractitioner.findMany({ where: { tenantId } }),
    services: (tenantId) => prisma.simHealthcareService.findMany({ where: { tenantId } }),
    patients: async (tenantId) => {
      const rows = await prisma.simPatient.findMany({ where: { tenantId } });
      return rows.map(patientOf);
    },
    schedules: (tenantId) => prisma.simSchedule.findMany({ where: { tenantId } }),
    slots: async (tenantId) => {
      const rows = await prisma.simSlot.findMany({
        where: { tenantId },
        orderBy: { startAt: "asc" },
      });
      return rows.map(slotOf);
    },
  };
}
