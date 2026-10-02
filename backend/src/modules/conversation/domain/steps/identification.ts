import { isLocked } from "@/modules/verification/domain/challenge";
import { drawPair, pairUsable, type QuestionPair } from "@/modules/verification/domain/draw";
import type { VerifiableRecord } from "@/modules/verification/domain/questions";
import { DOCUMENT_TYPES, type DocumentType, isDocumentType } from "../document";
import { formatWhen } from "../format";
import { choice, go, optionValue, prompt, resetFlow, retry } from "../step-kit";
import { type BotLine, type ConversationTextKey, line, t } from "../text";
import type { ConversationContext, HandleResult, HandoffReason, Step, StepEnv } from "../types";

const DOC_LABEL: Record<DocumentType, ConversationTextKey> = {
  CC: "doc_type_cc",
  TI: "doc_type_ti",
  CE: "doc_type_ce",
  PA: "doc_type_pa",
  RC: "doc_type_rc",
};
const DOCUMENT_NUMBER = /^[A-Z0-9]{3,20}$/;

export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

export const idDocumentType: Step = {
  id: "id_document_type",
  globals: "full",
  echo: "label",
  async enter(context) {
    const options = DOCUMENT_TYPES.map((type) => choice(`doc:${type}`, t(DOC_LABEL[type])));
    return prompt(context, [line("id_document_type_prompt")], options);
  },
  async handle(input, context) {
    const type = optionValue(input, "doc:");
    if (type === null || !isDocumentType(type)) {
      return retry("id_document_type", context);
    }
    return go("id_document_number", { ...context, documentType: type });
  },
};

export const idDocumentNumber: Step = {
  id: "id_document_number",
  globals: "full",
  echo: "document",
  async enter(context) {
    return prompt(context, [line("id_document_number_prompt")], [], "text");
  },
  async handle(input, context, env) {
    const documentType = context.documentType;
    if (!documentType) {
      return go("id_document_type", context);
    }
    if (input.kind !== "text") {
      return retry("id_document_number", context);
    }
    const documentNumber = normalizeDocumentNumber(input.text);
    if (!DOCUMENT_NUMBER.test(documentNumber)) {
      return retry("id_document_number", context, "id_document_number_invalid");
    }
    const record = await env.reads.findPatient(env.tenantId, documentType, documentNumber);
    if (!record) {
      const preRegistration = { documentType, documentNumber, field: "given_names" as const };
      return go("privacy_notice", { ...context, preRegistration }, [line("prereg_not_found")]);
    }
    return startVerification(record, context, env);
  },
};

function blocked(
  context: ConversationContext,
  reason: HandoffReason,
  lines: readonly BotLine[],
): HandleResult {
  return go("verification_blocked", { ...resetFlow(context), handoffReason: reason }, lines);
}

function verifying(
  context: ConversationContext,
  medicalRecordId: string,
  questionIds: QuestionPair,
): HandleResult {
  const verification = { medicalRecordId, questionIds, index: 0 as const };
  return go("verify_question", { ...context, verification }, [line("verify_intro")]);
}

/**
 * Par guardado si existe (par fijo); si no, uno sorteado que se guarda con `open_challenge`
 * antes de preguntar (refinamiento 3). Un par guardado que ya no aplica deriva a un asesor.
 */
async function startVerification(
  record: VerifiableRecord,
  context: ConversationContext,
  env: StepEnv,
): Promise<HandleResult> {
  const challenge = await env.reads.challenge(env.tenantId, record.id);
  if (challenge?.lockedUntil && isLocked(challenge, env.now)) {
    const until = formatWhen(challenge.lockedUntil, env.timeZone);
    return blocked(context, "verification_locked", [line("verify_locked", { until })]);
  }
  if (challenge) {
    return pairUsable(challenge.questionIds, record)
      ? verifying(context, record.id, challenge.questionIds)
      : blocked(context, "unverifiable", [line("verify_unverifiable")]);
  }
  const drawn = drawPair(record, env.random);
  if (!drawn) {
    return blocked(context, "unverifiable", [line("verify_unverifiable")]);
  }
  return {
    ...verifying(context, record.id, drawn),
    effect: { kind: "open_challenge", medicalRecordId: record.id, questionIds: drawn },
    onOutcome: (outcome) =>
      outcome.ok && outcome.questionIds
        ? verifying(context, record.id, outcome.questionIds)
        : go("main_menu", resetFlow(context), [line("generic_error")]),
  };
}
