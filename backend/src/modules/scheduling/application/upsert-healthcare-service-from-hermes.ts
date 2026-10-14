import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HealthcareService } from "../domain/entities";
import type { HermesMasterStore } from "../domain/ports/hermes-masters";
import { upsertMasterFromHermes } from "./upsert-master-from-hermes";

export type UpsertHealthcareServiceFromHermes = (input: {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: HealthcareService["identifier"];
  readonly name: string;
  readonly active: boolean;
}) => Promise<{ readonly outcome: "created" | "updated"; readonly record: HealthcareService }>;

type Dependencies = {
  readonly store: HermesMasterStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

export function createUpsertHealthcareServiceFromHermes(
  deps: Dependencies,
): UpsertHealthcareServiceFromHermes {
  return async (input) => {
    const existing = await deps.store.findHealthcareServiceByIdentifier(
      input.tenantId,
      input.identifier,
    );
    return upsertMasterFromHermes({
      deps,
      tenantId: input.tenantId,
      actor: input.actor,
      existing,
      buildRecord: (id) => ({
        id,
        tenantId: input.tenantId,
        identifier: input.identifier,
        name: input.name,
        active: input.active,
      }),
      save: (record, mode) => deps.store.saveHealthcareService(record, mode),
      audit: {
        action: "healthcare_service.written_by_hermes",
        resourceType: "healthcare_service",
      },
    });
  };
}
