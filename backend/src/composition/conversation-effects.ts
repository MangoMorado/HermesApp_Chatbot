import type { EffectRunner } from "../modules/conversation/domain/ports";
import type { Effect, EffectFailure, EffectOutcome } from "../modules/conversation/domain/types";
import type { CreateHandoffTicket } from "../modules/handoff/application/create-handoff-ticket";
import type { PreRegisterPatient } from "../modules/patients/application/pre-register-patient";
import type {
  CreateAppointmentRequest,
  CreateAppointmentRequestCommand,
} from "../modules/scheduling/application/create-appointment-request";
import type { AuditActor } from "../modules/shared/domain/audit-event";
import { ConflictError } from "../modules/shared/domain/conflict-error";
import { NotFoundError } from "../modules/shared/domain/not-found-error";
import { type TenantId, toTenantId } from "../modules/shared/domain/tenant-id";
import { ValidationError } from "../modules/shared/domain/validation-error";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { withSavepoint } from "../modules/shared/infrastructure/prisma-savepoint";
import type {
  OpenChallenge,
  RecordVerificationAttempt,
} from "../modules/verification/application/verification";

export type EffectPorts = {
  readonly createAppointmentRequest: CreateAppointmentRequest;
  readonly preRegisterPatient: PreRegisterPatient;
  readonly createHandoffTicket: CreateHandoffTicket;
  readonly openChallenge: OpenChallenge;
  readonly recordVerificationAttempt: RecordVerificationAttempt;
};

const KNOWN: ReadonlySet<string> = new Set<EffectFailure>([
  "slot_unavailable",
  "pending_limit_reached",
  "appointment_change_pending",
  "document_taken",
]);

/** Errores de dominio esperables → fallo que el paso traduce; el resto sigue siendo 500. */
function failureOf(error: unknown): EffectOutcome | null {
  if (error instanceof ConflictError) {
    const details = (error.details ?? {}) as { reason?: string; max?: number };
    if (!details.reason || !KNOWN.has(details.reason)) {
      return null;
    }
    const failure = details.reason as EffectFailure;
    return details.max === undefined
      ? { ok: false, failure }
      : { ok: false, failure, max: details.max };
  }
  if (error instanceof ValidationError || error instanceof NotFoundError) {
    return { ok: false, failure: "not_available" };
  }
  return null;
}

async function guarded(
  db: PrismaExecutor,
  run: () => Promise<EffectOutcome>,
): Promise<EffectOutcome> {
  try {
    return await withSavepoint(db, run);
  } catch (error) {
    const failure = failureOf(error);
    if (failure) {
      return failure;
    }
    throw error;
  }
}

function toCommand(
  tenantId: TenantId,
  effect: Extract<Effect, { kind: "request_appointment" }>,
  actor: AuditActor,
): CreateAppointmentRequestCommand {
  const base = { tenantId, medicalRecordId: effect.medicalRecordId, actor };
  const command = effect.command;
  switch (command.kind) {
    case "book":
      return { ...base, kind: "book", slotId: command.slotId };
    case "reschedule":
      return {
        ...base,
        kind: "reschedule",
        appointmentId: command.appointmentId,
        slotId: command.slotId,
      };
    case "cancel":
      return { ...base, kind: "cancel", appointmentId: command.appointmentId };
  }
}

type RunContext = Parameters<EffectRunner>[1];

function requestAppointment(
  db: PrismaExecutor,
  ports: EffectPorts,
  effect: Extract<Effect, { kind: "request_appointment" }>,
  context: RunContext,
): Promise<EffectOutcome> {
  const tenantId = toTenantId(context.tenantId);
  return guarded(db, async () => {
    const request = await ports.createAppointmentRequest(
      toCommand(tenantId, effect, context.actor),
    );
    return { ok: true, expiresAt: request.expiresAt };
  });
}

function preRegister(
  db: PrismaExecutor,
  ports: EffectPorts,
  effect: Extract<Effect, { kind: "pre_register" }>,
  context: RunContext,
): Promise<EffectOutcome> {
  const tenantId = toTenantId(context.tenantId);
  return guarded(db, async () => {
    const record = await ports.preRegisterPatient({
      ...context.actor,
      tenantId,
      data: effect.data,
    });
    return { ok: true, medicalRecordId: record.id };
  });
}

async function handoff(
  ports: EffectPorts,
  effect: Extract<Effect, { kind: "handoff" }>,
  context: RunContext,
): Promise<EffectOutcome> {
  await ports.createHandoffTicket({
    ...context.actor,
    tenantId: toTenantId(context.tenantId),
    conversationId: context.conversationId,
    reason: effect.reason,
    medicalRecordId: effect.medicalRecordId,
  });
  return { ok: true };
}

async function openChallenge(
  ports: EffectPorts,
  effect: Extract<Effect, { kind: "open_challenge" }>,
  context: RunContext,
): Promise<EffectOutcome> {
  const questionIds = await ports.openChallenge({
    tenantId: toTenantId(context.tenantId),
    medicalRecordId: effect.medicalRecordId,
    questionIds: effect.questionIds,
  });
  return { ok: true, questionIds };
}

async function verificationAttempt(
  ports: EffectPorts,
  effect: Extract<Effect, { kind: "verification_attempt" }>,
  context: RunContext,
): Promise<EffectOutcome> {
  const verification = await ports.recordVerificationAttempt({
    ...context.actor,
    tenantId: toTenantId(context.tenantId),
    medicalRecordId: effect.medicalRecordId,
    success: effect.success,
  });
  return { ok: true, verification };
}

/** Cumple los efectos del motor con los casos de uso de cada modulo (refinamiento 2). */
export function createEffectRunner(db: PrismaExecutor, ports: EffectPorts): EffectRunner {
  return (effect, context) => {
    switch (effect.kind) {
      case "request_appointment":
        return requestAppointment(db, ports, effect, context);
      case "pre_register":
        return preRegister(db, ports, effect, context);
      case "handoff":
        return handoff(ports, effect, context);
      case "open_challenge":
        return openChallenge(ports, effect, context);
      case "verification_attempt":
        return verificationAttempt(ports, effect, context);
    }
  };
}
