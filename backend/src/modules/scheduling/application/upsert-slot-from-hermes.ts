import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { type AppointmentRequest, isLive } from "../domain/appointment-request";
import type { Slot } from "../domain/entities";
import type { HermesMasterStore } from "../domain/ports/hermes-masters";
import type { PreAgendaStore } from "../domain/ports/pre-agenda";

export type UpsertSlotFromHermes = (input: {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: Slot["identifier"];
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: Slot["status"];
}) => Promise<{ readonly outcome: "created" | "updated"; readonly record: Slot }>;

type Dependencies = {
  readonly store: Pick<
    HermesMasterStore,
    "findSlotByIdentifier" | "getSchedule" | "lockSlotForUpdate" | "saveSlot"
  >;
  readonly preAgenda: Pick<PreAgendaStore, "expireDue" | "findLiveHoldBySlot" | "markResolved">;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

function unchangedHoldFields(existing: Slot, input: Parameters<UpsertSlotFromHermes>[0]) {
  return (
    existing.scheduleId === input.scheduleId &&
    existing.startAt.getTime() === input.startAt.getTime() &&
    existing.endAt.getTime() === input.endAt.getTime()
  );
}

function assertHoldCanBeRejected(existing: Slot, input: Parameters<UpsertSlotFromHermes>[0]): void {
  const occupied = input.status === "busy" || input.status === "busy_unavailable";
  if (!occupied || !unchangedHoldFields(existing, input)) {
    throw new ConflictError("El cupo esta apartado");
  }
}

async function auditWrittenSlot(
  deps: Dependencies,
  input: Parameters<UpsertSlotFromHermes>[0],
  resourceId: string,
  occurredAt: Date,
) {
  await deps.audit.record({
    tenantId: input.tenantId,
    ...input.actor,
    action: "slot.written_by_hermes",
    resourceType: "slot",
    resourceId,
    occurredAt,
  });
}

async function markHoldRejected(
  deps: Dependencies,
  input: Parameters<UpsertSlotFromHermes>[0],
  hold: AppointmentRequest,
  occurredAt: Date,
) {
  await deps.preAgenda.markResolved(input.tenantId, hold.id, {
    status: "rejected",
    resolutionReason: "slot_unavailable",
    resultingAppointmentId: null,
    resolvedAt: occurredAt,
  });
}

async function auditRejectedHold(
  deps: Dependencies,
  input: Parameters<UpsertSlotFromHermes>[0],
  hold: AppointmentRequest,
  occurredAt: Date,
) {
  await deps.audit.record({
    tenantId: input.tenantId,
    ...input.actor,
    action: "appointment_request.rejected",
    resourceType: "appointment_request",
    resourceId: hold.id,
    occurredAt,
  });
}

async function loadExistingAndHold(
  deps: Dependencies,
  input: Parameters<UpsertSlotFromHermes>[0],
  now: Date,
) {
  await deps.preAgenda.expireDue(input.tenantId, now);
  if (!(await deps.store.getSchedule(input.tenantId, input.scheduleId))) {
    throw new ValidationError("La agenda no existe");
  }
  const found = await deps.store.findSlotByIdentifier(input.tenantId, input.identifier);
  const existing = found ? await deps.store.lockSlotForUpdate(input.tenantId, found.id) : null;
  const hold = existing
    ? await deps.preAgenda.findLiveHoldBySlot(input.tenantId, existing.id, now)
    : null;
  const liveHold = hold && isLive(hold, now) ? hold : null;
  if (existing && liveHold) {
    assertHoldCanBeRejected(existing, input);
  }
  return { existing, liveHold };
}

async function markHoldIfPresent(
  deps: Dependencies,
  input: Parameters<UpsertSlotFromHermes>[0],
  hold: AppointmentRequest | null,
  now: Date,
) {
  if (!hold) {
    return;
  }
  await markHoldRejected(deps, input, hold, now);
}

async function auditHoldIfPresent(
  deps: Dependencies,
  input: Parameters<UpsertSlotFromHermes>[0],
  hold: AppointmentRequest | null,
  now: Date,
) {
  if (!hold) {
    return;
  }
  await auditRejectedHold(deps, input, hold, now);
}

export function createUpsertSlotFromHermes(deps: Dependencies): UpsertSlotFromHermes {
  return async (input) => {
    const now = deps.clock.now();
    const { existing, liveHold } = await loadExistingAndHold(deps, input, now);
    const outcome = existing ? "updated" : "created";
    const record: Slot = {
      id: existing?.id ?? deps.ids.next(),
      tenantId: input.tenantId,
      identifier: input.identifier,
      scheduleId: input.scheduleId,
      startAt: input.startAt,
      endAt: input.endAt,
      status: input.status,
    };
    await deps.store.saveSlot(record, outcome === "updated" ? "update" : "insert");
    await markHoldIfPresent(deps, input, liveHold, now);
    await auditWrittenSlot(deps, input, record.id, now);
    await auditHoldIfPresent(deps, input, liveHold, now);
    return { outcome, record };
  };
}
