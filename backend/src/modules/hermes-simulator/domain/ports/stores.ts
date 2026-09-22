import type { Page } from "@/modules/shared/domain/pagination";
import type {
  GenerateSlotsInput,
  SimHealthcareService,
  SimPatient,
  SimPractitioner,
  SimSchedule,
} from "../entities";

export type SimListFilter = {
  readonly tenantId: string;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type SimPractitionerStore = {
  list(filter: SimListFilter): Promise<Page<SimPractitioner>>;
  get(tenantId: string, id: string): Promise<SimPractitioner | null>;
  create(row: SimPractitioner): Promise<SimPractitioner>;
  update(row: SimPractitioner): Promise<SimPractitioner | null>;
  delete(tenantId: string, id: string): Promise<"ok" | "missing" | "has_dependents">;
};

export type SimHealthcareServiceStore = {
  list(filter: SimListFilter): Promise<Page<SimHealthcareService>>;
  get(tenantId: string, id: string): Promise<SimHealthcareService | null>;
  create(row: SimHealthcareService): Promise<SimHealthcareService>;
  update(row: SimHealthcareService): Promise<SimHealthcareService | null>;
  delete(tenantId: string, id: string): Promise<"ok" | "missing" | "has_dependents">;
};

export type SimScheduleStore = {
  list(filter: SimListFilter): Promise<Page<SimSchedule>>;
  get(tenantId: string, id: string): Promise<SimSchedule | null>;
  create(row: SimSchedule): Promise<SimSchedule>;
  update(row: SimSchedule): Promise<SimSchedule | null>;
  delete(tenantId: string, id: string): Promise<"ok" | "missing" | "has_dependents">;
};

export type SimPatientStore = {
  list(filter: SimListFilter): Promise<Page<SimPatient>>;
  get(tenantId: string, id: string): Promise<SimPatient | null>;
  create(row: SimPatient): Promise<SimPatient>;
  update(row: SimPatient): Promise<SimPatient | null>;
  delete(tenantId: string, id: string): Promise<"ok" | "missing" | "has_dependents">;
};

export type SimSlotGenerator = {
  generate(input: GenerateSlotsInput): Promise<number>;
};
