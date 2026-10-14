import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";

export type MasterUpsertDeps = {
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

type UpsertMasterFromHermesOptions<TRecord extends { id: string }> = {
  readonly deps: MasterUpsertDeps;
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly existing: TRecord | null;
  readonly buildRecord: (id: string) => TRecord;
  readonly save: (record: TRecord, mode: "insert" | "update") => Promise<void>;
  readonly audit: { readonly action: string; readonly resourceType: string };
};

/** Flujo común find → save → audit para maestros escritos por Hermes. */
export async function upsertMasterFromHermes<TRecord extends { id: string }>(
  options: UpsertMasterFromHermesOptions<TRecord>,
): Promise<{ readonly outcome: "created" | "updated"; readonly record: TRecord }> {
  const outcome = options.existing ? "updated" : "created";
  const id = options.existing?.id ?? options.deps.ids.next();
  const record = options.buildRecord(id);
  await options.save(record, outcome === "updated" ? "update" : "insert");
  await options.deps.audit.record({
    tenantId: options.tenantId,
    ...options.actor,
    action: options.audit.action,
    resourceType: options.audit.resourceType,
    resourceId: id,
    occurredAt: options.deps.clock.now(),
  });
  return { outcome, record };
}
