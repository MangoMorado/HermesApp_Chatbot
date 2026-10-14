import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Practitioner } from "../domain/entities";
import type { HermesMasterStore } from "../domain/ports/hermes-masters";
import { upsertMasterFromHermes } from "./upsert-master-from-hermes";

export type UpsertPractitionerFromHermes = (input: {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: Practitioner["identifier"];
  readonly name: string;
  readonly active: boolean;
}) => Promise<{ readonly outcome: "created" | "updated"; readonly record: Practitioner }>;

type Dependencies = {
  readonly store: HermesMasterStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

export function createUpsertPractitionerFromHermes(
  deps: Dependencies,
): UpsertPractitionerFromHermes {
  return async (input) => {
    const existing = await deps.store.findPractitionerByIdentifier(
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
      save: (record, mode) => deps.store.savePractitioner(record, mode),
      audit: { action: "practitioner.written_by_hermes", resourceType: "practitioner" },
    });
  };
}
