export type DocumentType = "CC" | "TI" | "CE" | "PA" | "RC";
export type MedicalRecordStatus = "active" | "pre_registered";

export type MedicalRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: { readonly system: string; readonly value: string };
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly status: MedicalRecordStatus;
};

export type HistoryAppointment = {
  readonly id: string;
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly slotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: "booked" | "cancelled" | "fulfilled" | "noshow";
};
