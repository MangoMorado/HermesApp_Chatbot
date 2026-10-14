import type {
  SimHealthcareService,
  SimPatient,
  SimPractitioner,
  SimSchedule,
  SimSlot,
} from "../entities";

/** Lectura completa de `hermes_sim` para una corrida de sincronizacion. */
export type SimCatalog = {
  practitioners(tenantId: string): Promise<readonly SimPractitioner[]>;
  services(tenantId: string): Promise<readonly SimHealthcareService[]>;
  patients(tenantId: string): Promise<readonly SimPatient[]>;
  schedules(tenantId: string): Promise<readonly SimSchedule[]>;
  slots(tenantId: string): Promise<readonly SimSlot[]>;
};
