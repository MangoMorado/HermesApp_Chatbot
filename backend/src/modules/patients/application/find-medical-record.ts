import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { DocumentType, MedicalRecord } from "../domain/entities";
import type { MedicalRecordRepository } from "../domain/ports/repositories";

const DOCUMENT_TYPES: readonly DocumentType[] = ["CC", "TI", "CE", "PA", "RC"];

export type FindMedicalRecordInput = {
  readonly tenantId: TenantId;
  readonly documentTypeRaw: string | null;
  readonly documentNumberRaw: string | null;
};

export type FindMedicalRecord = (input: FindMedicalRecordInput) => Promise<MedicalRecord>;

export function createFindMedicalRecord(repo: MedicalRecordRepository): FindMedicalRecord {
  return async (input) => {
    if (!input.documentTypeRaw || !DOCUMENT_TYPES.includes(input.documentTypeRaw as DocumentType)) {
      throw new ValidationError("document_type invalido", { field: "document_type" });
    }
    if (!input.documentNumberRaw?.trim()) {
      throw new ValidationError("document_number es obligatorio", { field: "document_number" });
    }
    const found = await repo.findByDocument(
      input.tenantId,
      input.documentTypeRaw as DocumentType,
      input.documentNumberRaw.trim(),
    );
    if (!found) {
      throw new NotFoundError();
    }
    return found;
  };
}
