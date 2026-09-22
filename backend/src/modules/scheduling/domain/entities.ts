export type HermesIdentifier = {
  readonly system: string;
  readonly value: string;
};

export type Practitioner = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: HermesIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type HealthcareService = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: HermesIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type Schedule = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: HermesIdentifier;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly active: boolean;
};

export type SlotStatus = "free" | "busy" | "busy_tentative" | "busy_unavailable";

export type Slot = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: HermesIdentifier;
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: SlotStatus;
};

export type AppointmentStatus = "booked" | "cancelled" | "fulfilled" | "noshow";

export type Appointment = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: HermesIdentifier;
  readonly medicalRecordId: string;
  readonly scheduleId: string;
  readonly slotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: AppointmentStatus;
};
