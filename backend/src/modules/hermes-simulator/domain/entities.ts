export type SimPractitioner = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifierSystem: string;
  readonly identifierValue: string;
  readonly name: string;
  readonly active: boolean;
};

export type SimHealthcareService = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifierSystem: string;
  readonly identifierValue: string;
  readonly name: string;
  readonly active: boolean;
};

export type SimSchedule = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifierSystem: string;
  readonly identifierValue: string;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly active: boolean;
};

export type SimSlot = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifierSystem: string;
  readonly identifierValue: string;
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: "free" | "busy" | "busy_tentative" | "busy_unavailable";
};

export type SimPatient = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifierSystem: string;
  readonly identifierValue: string;
  readonly documentType: "CC" | "TI" | "CE" | "PA" | "RC";
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly status: "active" | "pre_registered";
};

export type WeekdayWindow = {
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
};

export type GenerateSlotsInput = {
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly from: string;
  readonly to: string;
  readonly durationMinutes: number;
  readonly windows: readonly WeekdayWindow[];
  readonly timeZone: string;
};
