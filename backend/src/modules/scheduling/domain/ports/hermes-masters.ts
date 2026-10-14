import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HealthcareService, Practitioner, Schedule, Slot } from "../entities";

export type HermesMasterStore = {
  findPractitionerByIdentifier(
    tenantId: TenantId,
    identifier: Practitioner["identifier"],
  ): Promise<Practitioner | null>;
  savePractitioner(row: Practitioner, mode: "insert" | "update"): Promise<void>;
  findHealthcareServiceByIdentifier(
    tenantId: TenantId,
    identifier: HealthcareService["identifier"],
  ): Promise<HealthcareService | null>;
  saveHealthcareService(row: HealthcareService, mode: "insert" | "update"): Promise<void>;
  findScheduleByIdentifier(
    tenantId: TenantId,
    identifier: Schedule["identifier"],
  ): Promise<Schedule | null>;
  getPractitioner(tenantId: TenantId, id: string): Promise<Practitioner | null>;
  getHealthcareService(tenantId: TenantId, id: string): Promise<HealthcareService | null>;
  getSchedule(tenantId: TenantId, id: string): Promise<Schedule | null>;
  saveSchedule(row: Schedule, mode: "insert" | "update"): Promise<void>;
  findSlotByIdentifier(tenantId: TenantId, identifier: Slot["identifier"]): Promise<Slot | null>;
  saveSlot(row: Slot, mode: "insert" | "update"): Promise<void>;
};
