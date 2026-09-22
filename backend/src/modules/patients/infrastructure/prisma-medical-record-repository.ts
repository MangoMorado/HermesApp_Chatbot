import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { DocumentType, MedicalRecord, MedicalRecordStatus } from "../domain/entities";
import type { MedicalRecordRepository } from "../domain/ports/repositories";

function mapRecord(row: {
  id: string;
  tenantId: string;
  identifierSystem: string;
  identifierValue: string;
  documentType: DocumentType;
  documentNumber: string;
  givenNames: string;
  familyNames: string;
  birthDate: Date;
  phone: string | null;
  email: string | null;
  status: MedicalRecordStatus;
}): MedicalRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
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

export function createPrismaMedicalRecordRepository(db: PrismaExecutor): MedicalRecordRepository {
  return {
    async findByDocument(tenantId, documentType, documentNumber) {
      const row = await db.medicalRecord.findUnique({
        where: {
          tenantId_documentType_documentNumber: { tenantId, documentType, documentNumber },
        },
      });
      return row ? mapRecord(row) : null;
    },

    async get(tenantId, id) {
      const row = await db.medicalRecord.findFirst({ where: { tenantId, id } });
      return row ? mapRecord(row) : null;
    },
  };
}
