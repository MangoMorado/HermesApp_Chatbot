import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HealthcareService } from "../domain/entities";
import type { HermesMasterStore } from "../domain/ports/hermes-masters";

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
    const record: HealthcareService = {
      id: existing?.id ?? deps.ids.next(),
      tenantId: input.tenantId,
      identifier: input.identifier,
      name: input.name,
      active: input.active,
    };
    const outcome = existing ? "updated" : "created";
    await deps.store.saveHealthcareService(record, existing ? "update" : "insert");
    await deps.audit.record({
      tenantId: input.tenantId,
      ...input.actor,
      action: "healthcare_service.written_by_hermes",
      resourceType: "healthcare_service",
      resourceId: record.id,
      occurredAt: deps.clock.now(),
    });
    return { outcome, record };
  };
}
