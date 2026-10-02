import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { DocumentType, HistoryAppointment, MedicalRecord } from "../entities";

export type MedicalRecordRepository = {
  findByDocument(
    tenantId: TenantId,
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<MedicalRecord | null>;
  get(tenantId: TenantId, id: string): Promise<MedicalRecord | null>;
  /** Inserta un expediente `pre_registered`. Documento ya existente: ConflictError document_taken. */
  insertPreRegistered(record: MedicalRecord): Promise<void>;
};

export type AppointmentHistoryFilter = {
  readonly tenantId: TenantId;
  readonly medicalRecordId: string;
  readonly cursor?: string | null;
  readonly limit: number;
};

/** Puerto propio de patients: no importa scheduling. */
export type AppointmentHistory = {
  list(filter: AppointmentHistoryFilter): Promise<Page<HistoryAppointment>>;
};
