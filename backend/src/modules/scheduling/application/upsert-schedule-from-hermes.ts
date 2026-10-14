import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { Schedule } from "../domain/entities";
import type { HermesMasterStore } from "../domain/ports/hermes-masters";

export type UpsertScheduleFromHermes = (input: {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: Schedule["identifier"];
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly active: boolean;
}) => Promise<{ readonly outcome: "created" | "updated"; readonly record: Schedule }>;

type Dependencies = {
  readonly store: HermesMasterStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

async function validateActors(deps: Dependencies, input: Parameters<UpsertScheduleFromHermes>[0]) {
  const practitioner = await deps.store.getPractitioner(input.tenantId, input.practitionerId);
  if (!practitioner) {
    throw new ValidationError("El profesional no existe");
  }
  const service = await deps.store.getHealthcareService(input.tenantId, input.healthcareServiceId);
  if (!service) {
    throw new ValidationError("El servicio de salud no existe");
  }
}

export function createUpsertScheduleFromHermes(deps: Dependencies): UpsertScheduleFromHermes {
  return async (input) => {
    await validateActors(deps, input);
    const existing = await deps.store.findScheduleByIdentifier(input.tenantId, input.identifier);
    const record: Schedule = {
      id: existing?.id ?? deps.ids.next(),
      tenantId: input.tenantId,
      identifier: input.identifier,
      practitionerId: input.practitionerId,
      healthcareServiceId: input.healthcareServiceId,
      active: input.active,
    };
    const outcome = existing ? "updated" : "created";
    await deps.store.saveSchedule(record, existing ? "update" : "insert");
    await deps.audit.record({
      tenantId: input.tenantId,
      ...input.actor,
      action: "schedule.written_by_hermes",
      resourceType: "schedule",
      resourceId: record.id,
      occurredAt: deps.clock.now(),
    });
    return { outcome, record };
  };
}
