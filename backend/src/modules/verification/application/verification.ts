import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { Random } from "@/modules/shared/domain/ports/random";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import {
  type AttemptOutcome,
  applyAttempt,
  type Challenge,
  effectiveChallenge,
} from "../domain/challenge";
import { drawPair, type QuestionPair } from "../domain/draw";
import type { ChallengeRepository, VerificationPolicyReader } from "../domain/ports";
import type { VerifiableRecord } from "../domain/questions";

export type OpenChallenge = (input: {
  readonly tenantId: TenantId;
  readonly medicalRecordId: string;
  readonly questionIds: QuestionPair;
}) => Promise<QuestionPair>;

/** Guarda el par sorteado al identificarse (refinamiento 3); devuelve el que quedo guardado. */
export function createOpenChallenge(deps: {
  repo: ChallengeRepository;
  ids: IdGenerator;
  clock: Clock;
}): OpenChallenge {
  return async (input) => {
    const now = deps.clock.now();
    await deps.repo.insertIfAbsent(
      {
        id: deps.ids.next(),
        tenantId: input.tenantId,
        medicalRecordId: input.medicalRecordId,
        questionIds: input.questionIds,
        failedAttempts: 0,
        lockedUntil: null,
      },
      now,
    );
    const stored = await deps.repo.find(input.tenantId, input.medicalRecordId);
    if (!stored) {
      throw new NotFoundError();
    }
    return stored.questionIds;
  };
}

export type ReadChallenge = (
  tenantId: TenantId,
  medicalRecordId: string,
) => Promise<Challenge | null>;

export function createReadChallenge(deps: {
  repo: ChallengeRepository;
  clock: Clock;
}): ReadChallenge {
  return async (tenantId, medicalRecordId) => {
    const stored = await deps.repo.find(tenantId, medicalRecordId);
    return stored && effectiveChallenge(stored, deps.clock.now());
  };
}

export type RecordVerificationAttempt = (
  input: AuditActor & {
    readonly tenantId: TenantId;
    readonly medicalRecordId: string;
    readonly success: boolean;
  },
) => Promise<AttemptOutcome>;

type AttemptDeps = {
  readonly repo: ChallengeRepository;
  readonly clock: Clock;
  readonly random: Random;
  readonly audit: AuditLog;
  readonly policy: VerificationPolicyReader;
  readonly records: (tenantId: TenantId, id: string) => Promise<VerifiableRecord | null>;
};

const ACTION: Record<AttemptOutcome["result"], string> = {
  verified: "verification.succeeded",
  failed: "verification.failed",
  locked: "verification.locked",
};

/** Registra el hecho y el resultado, nunca que pregunta fallo ni que se respondio. */
export function createRecordVerificationAttempt(deps: AttemptDeps): RecordVerificationAttempt {
  return async (input) => {
    const now = deps.clock.now();
    const current = await deps.repo.findForUpdate(input.tenantId, input.medicalRecordId);
    const record = await deps.records(input.tenantId, input.medicalRecordId);
    if (!current || !record) {
      throw new NotFoundError();
    }
    const redraw = drawPair(record, deps.random) ?? current.questionIds;
    const policy = await deps.policy(input.tenantId);
    const { challenge, outcome } = applyAttempt(current, input.success, now, policy, redraw);
    await deps.repo.update(challenge, now);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: ACTION[outcome.result],
      resourceType: "medical_record",
      resourceId: input.medicalRecordId,
      requestId: input.requestId,
      occurredAt: now,
    });
    return outcome;
  };
}
