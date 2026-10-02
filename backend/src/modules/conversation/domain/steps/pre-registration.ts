import { localDate } from "../format";
import { nextField, parseField } from "../pre-registration-fields";
import { choice, go, isOption, prompt, redirect, resetFlow, retry } from "../step-kit";
import { type ConversationTextKey, line, t } from "../text";
import type {
  ConversationContext,
  EffectOutcome,
  HandleResult,
  PatientInput,
  PreRegField,
  PreRegistrationDraft,
  PreRegistrationPayload,
  Step,
} from "../types";

const PROMPT: Record<PreRegField, ConversationTextKey> = {
  given_names: "prereg_given_names_prompt",
  family_names: "prereg_family_names_prompt",
  birth_date: "prereg_birth_date_prompt",
  phone: "prereg_phone_prompt",
  email: "prereg_email_prompt",
};

const DRAFT_KEY = {
  given_names: "givenNames",
  family_names: "familyNames",
  birth_date: "birthDate",
  phone: "phone",
  email: "email",
} as const satisfies Record<PreRegField, keyof PreRegistrationDraft>;

export const privacyNotice: Step = {
  id: "privacy_notice",
  globals: "full",
  echo: "label",
  async enter(context) {
    const options = [
      choice("privacy:accept", t("option_accept")),
      choice("privacy:decline", t("option_decline")),
    ];
    return prompt(context, [line("privacy_notice")], options);
  },
  async handle(input, context) {
    const draft = context.preRegistration;
    if (!draft) {
      return go("main_menu", resetFlow(context));
    }
    if (isOption(input, "privacy:accept")) {
      return go("prereg_field", {
        ...context,
        preRegistration: { ...draft, field: "given_names" },
      });
    }
    if (isOption(input, "privacy:decline")) {
      return go("main_menu", resetFlow(context), [line("privacy_declined")]);
    }
    return retry("privacy_notice", context);
  },
};

/** Valor del campo; `undefined` si es invalido. El correo admite Omitir (`null`). */
function valueFor(
  field: PreRegField,
  input: PatientInput,
  today: string,
): string | null | undefined {
  if (field === "email" && isOption(input, "prereg:skip")) {
    return null;
  }
  if (input.kind !== "text") {
    return undefined;
  }
  return parseField(field, input.text, today) ?? undefined;
}

export const preregField: Step = {
  id: "prereg_field",
  globals: "full",
  echo: "redacted",
  async enter(context) {
    const draft = context.preRegistration;
    if (!draft) {
      return redirect("main_menu", resetFlow(context));
    }
    const options = draft.field === "email" ? [choice("prereg:skip", t("option_skip"))] : [];
    const input = draft.field === "birth_date" ? "date" : "text";
    return prompt(context, [line(PROMPT[draft.field])], options, input);
  },
  async handle(input, context, env) {
    const draft = context.preRegistration;
    if (!draft) {
      return go("main_menu", resetFlow(context));
    }
    const value = valueFor(draft.field, input, localDate(env.now, env.timeZone));
    if (value === undefined) {
      return retry("prereg_field", context, "prereg_invalid");
    }
    const next = nextField(draft.field);
    const updated = { ...draft, [DRAFT_KEY[draft.field]]: value, field: next ?? draft.field };
    return go(next ? "prereg_field" : "prereg_confirm", { ...context, preRegistration: updated });
  },
};

export function completeDraft(draft?: PreRegistrationDraft): PreRegistrationPayload | null {
  if (!draft?.givenNames || !draft.familyNames || !draft.birthDate || !draft.phone) {
    return null;
  }
  if (draft.email === undefined) {
    return null;
  }
  return {
    documentType: draft.documentType,
    documentNumber: draft.documentNumber,
    givenNames: draft.givenNames,
    familyNames: draft.familyNames,
    birthDate: draft.birthDate,
    phone: draft.phone,
    email: draft.email,
  };
}

function afterPreRegister(outcome: EffectOutcome, context: ConversationContext): HandleResult {
  if (outcome.ok && outcome.medicalRecordId) {
    const verified = { ...resetFlow(context), patientId: outcome.medicalRecordId };
    return go("appointments_menu", verified, [line("prereg_done")]);
  }
  if (!outcome.ok && outcome.failure === "document_taken") {
    return go("id_document_type", resetFlow(context), [line("prereg_document_taken")]);
  }
  return go("main_menu", resetFlow(context), [line("generic_error")]);
}

/** Resumen con datos personales: linea redactada en el historial (refinamiento 5). */
export const preregConfirm: Step = {
  id: "prereg_confirm",
  globals: "full",
  echo: "label",
  async enter(context) {
    const data = completeDraft(context.preRegistration);
    if (!data) {
      return redirect("main_menu", resetFlow(context), [line("generic_error")]);
    }
    const summary = line(
      "prereg_confirm_prompt",
      {
        given_names: data.givenNames,
        family_names: data.familyNames,
        birth_date: data.birthDate,
        phone: data.phone,
        email: data.email ?? "—",
      },
      true,
    );
    const options = [
      choice("prereg:confirm", t("option_confirm")),
      choice("prereg:restart", t("option_restart")),
    ];
    return prompt(context, [summary], options);
  },
  async handle(input, context) {
    const draft = context.preRegistration;
    const data = completeDraft(draft);
    if (!draft || !data) {
      return go("main_menu", resetFlow(context));
    }
    if (isOption(input, "prereg:restart")) {
      return go("prereg_field", {
        ...context,
        preRegistration: { ...draft, field: "given_names" },
      });
    }
    if (!isOption(input, "prereg:confirm")) {
      return retry("prereg_confirm", context);
    }
    return {
      goto: "prereg_confirm",
      context,
      lines: [],
      effect: { kind: "pre_register", data },
      onOutcome: (outcome) => afterPreRegister(outcome, context),
    };
  },
};
