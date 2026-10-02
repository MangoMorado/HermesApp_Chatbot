import type { QuestionPair } from "./draw";

/** Par fijo y contador por expediente. Nunca guarda respuestas. */
export type Challenge = {
  readonly id: string;
  readonly tenantId: string;
  readonly medicalRecordId: string;
  readonly questionIds: QuestionPair;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
};

export type VerificationPolicy = { readonly maxAttempts: number; readonly lockMinutes: number };

export type AttemptOutcome = {
  readonly result: "verified" | "failed" | "locked";
  readonly remainingAttempts: number;
  readonly lockedUntil: Date | null;
};

export function isLocked(challenge: Challenge, now: Date): boolean {
  return challenge.lockedUntil !== null && challenge.lockedUntil.getTime() > now.getTime();
}

/** Vencimiento al leer: un bloqueo pasado vuelve el contador a cero con el mismo par. */
export function effectiveChallenge(challenge: Challenge, now: Date): Challenge {
  if (challenge.lockedUntil === null || isLocked(challenge, now)) {
    return challenge;
  }
  return { ...challenge, failedAttempts: 0, lockedUntil: null };
}

/**
 * Aplica un intento (ambas preguntas respondidas). Exito: re-sorteo y contador a cero.
 * Fallo: suma uno y bloquea al llegar al maximo, sin cambiar el par.
 */
export function applyAttempt(
  current: Challenge,
  success: boolean,
  now: Date,
  policy: VerificationPolicy,
  redraw: QuestionPair,
): { challenge: Challenge; outcome: AttemptOutcome } {
  const challenge = effectiveChallenge(current, now);
  if (isLocked(challenge, now)) {
    return {
      challenge,
      outcome: { result: "locked", remainingAttempts: 0, lockedUntil: challenge.lockedUntil },
    };
  }
  if (success) {
    const next = { ...challenge, questionIds: redraw, failedAttempts: 0, lockedUntil: null };
    return {
      challenge: next,
      outcome: { result: "verified", remainingAttempts: policy.maxAttempts, lockedUntil: null },
    };
  }
  const failedAttempts = challenge.failedAttempts + 1;
  if (failedAttempts < policy.maxAttempts) {
    return {
      challenge: { ...challenge, failedAttempts },
      outcome: {
        result: "failed",
        remainingAttempts: policy.maxAttempts - failedAttempts,
        lockedUntil: null,
      },
    };
  }
  const lockedUntil = new Date(now.getTime() + policy.lockMinutes * 60_000);
  return {
    challenge: { ...challenge, failedAttempts, lockedUntil },
    outcome: { result: "locked", remainingAttempts: 0, lockedUntil },
  };
}
