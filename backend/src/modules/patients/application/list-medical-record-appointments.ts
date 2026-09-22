import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HistoryAppointment } from "../domain/entities";
import type { AppointmentHistory, MedicalRecordRepository } from "../domain/ports/repositories";

export type ListMedicalRecordAppointmentsInput = {
  readonly tenantId: TenantId;
  readonly medicalRecordId: string;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export type ListMedicalRecordAppointments = (
  input: ListMedicalRecordAppointmentsInput,
) => Promise<Page<HistoryAppointment>>;

export function createListMedicalRecordAppointments(
  records: MedicalRecordRepository,
  history: AppointmentHistory,
): ListMedicalRecordAppointments {
  return async (input) => {
    const record = await records.get(input.tenantId, input.medicalRecordId);
    if (!record) {
      throw new NotFoundError();
    }
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return history.list({
      tenantId: input.tenantId,
      medicalRecordId: input.medicalRecordId,
      cursor: input.cursor,
      limit,
    });
  };
}
