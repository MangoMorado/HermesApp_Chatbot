import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { MedicalRecordDirectory, MedicalRecordSearch } from "../domain/ports/repositories";
import { mapRecord } from "./prisma-medical-record-repository";

function statusWhere(preRegistered: boolean | null) {
  if (preRegistered === null) {
    return {};
  }
  return { status: preRegistered ? ("pre_registered" as const) : ("active" as const) };
}

function whereOf(search: MedicalRecordSearch) {
  return {
    tenantId: search.tenantId,
    ...(search.identifier
      ? { identifierSystem: search.identifier.system, identifierValue: search.identifier.value }
      : {}),
    ...(search.document
      ? { documentType: search.document.type, documentNumber: search.document.number }
      : {}),
    ...statusWhere(search.preRegistered),
  };
}

export function createPrismaMedicalRecordDirectory(db: PrismaExecutor): MedicalRecordDirectory {
  return {
    async search(search) {
      const where = whereOf(search);
      const [rows, total] = await Promise.all([
        db.medicalRecord.findMany({
          where,
          orderBy: { id: "asc" },
          skip: search.offset,
          take: search.limit,
        }),
        db.medicalRecord.count({ where }),
      ]);
      return { data: rows.map(mapRecord), total };
    },
  };
}
