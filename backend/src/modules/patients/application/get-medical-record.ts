import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { MedicalRecord } from "../domain/entities";
import type { MedicalRecordRepository } from "../domain/ports/repositories";

export type GetMedicalRecord = (tenantId: TenantId, id: string) => Promise<MedicalRecord>;

export function createGetMedicalRecord(repo: MedicalRecordRepository): GetMedicalRecord {
  return async (tenantId, id) => {
    const found = await repo.get(tenantId, id);
    if (!found) {
      throw new NotFoundError();
    }
    return found;
  };
}
