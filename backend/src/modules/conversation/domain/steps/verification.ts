import { answerMatches, questionById } from "@/modules/verification/domain/questions";
import { formatWhen } from "../format";
import { choice, go, optionValue, prompt, redirect, resetFlow } from "../step-kit";
import { type ConversationTextKey, line, literal } from "../text";
import type {
  ConversationContext,
  EffectOutcome,
  HandleResult,
  Step,
  StepEnv,
  VerificationDraft,
} from "../types";

/**
 * Pregunta de seguridad (una por turno). La respuesta se compara en memoria y se descarta:
 * el contexto solo guarda si la primera fue correcta (refinamiento 3, GOBERNANZA §1.5).
 */
export const verifyQuestion: Step = {
  id: "verify_question",
  globals: "cancel_only",
  echo: "redacted",
  async enter(context, env) {
    const draft = context.verification;
    const question = draft ? questionById(draft.questionIds[draft.index]) : null;
    if (!draft || !question) {
      return redirect("main_menu", resetFlow(context), [line("generic_error")]);
    }
    const ask = [line(question.textKey as ConversationTextKey)];
    if (question.input === "text") {
      return prompt(context, ask, [], "text");
    }
    const record = await env.reads.getPatient(env.tenantId, draft.medicalRecordId);
    const options = record && question.options ? question.options(record) : [];
    return prompt(
      context,
      ask,
      options.map((o) => choice(`ans:${o.value}`, literal(o.label))),
    );
  },
  async handle(input, context, env) {
    const draft = context.verification;
    const record = draft ? await env.reads.getPatient(env.tenantId, draft.medicalRecordId) : null;
    if (!draft || !record) {
      return go("main_menu", resetFlow(context), [line("generic_error")]);
    }
    const answer = input.kind === "text" ? input.text : (optionValue(input, "ans:") ?? "");
    const correct = answerMatches(draft.questionIds[draft.index], record, answer);
    if (draft.index === 0) {
      return go("verify_question", {
        ...context,
        verification: { ...draft, index: 1, firstCorrect: correct },
      });
    }
    return attempt(draft, draft.firstCorrect === true && correct, context, env);
  },
};

function attempt(
  draft: VerificationDraft,
  success: boolean,
  context: ConversationContext,
  env: StepEnv,
): HandleResult {
  return {
    goto: "verify_question",
    context,
    lines: [],
    effect: { kind: "verification_attempt", medicalRecordId: draft.medicalRecordId, success },
    onOutcome: (outcome) => afterAttempt(outcome, draft, context, env),
  };
}

function afterAttempt(
  outcome: EffectOutcome,
  draft: VerificationDraft,
  context: ConversationContext,
  env: StepEnv,
): HandleResult {
  const result = outcome.ok ? outcome.verification : undefined;
  if (result?.result === "verified") {
    const verified = { ...resetFlow(context), patientId: draft.medicalRecordId };
    return go("appointments_menu", verified, [line("verify_success")]);
  }
  if (result?.result === "failed") {
    const verification = {
      medicalRecordId: draft.medicalRecordId,
      questionIds: draft.questionIds,
      index: 0 as const,
    };
    const remaining = String(result.remainingAttempts);
    return go("verify_question", { ...context, verification }, [
      line("verify_failed", { remaining }),
    ]);
  }
  if (result?.result === "locked" && result.lockedUntil) {
    const until = formatWhen(result.lockedUntil, env.timeZone);
    const blocked = { ...resetFlow(context), handoffReason: "verification_locked" as const };
    return go("verification_blocked", blocked, [line("verify_locked", { until })]);
  }
  return go("main_menu", resetFlow(context), [line("generic_error")]);
}
