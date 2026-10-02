/**
 * Referencias a textos del bot. El motor nunca escribe texto propio: usa claves de bot-config
 * (renderizadas en application), contenido de la KB o datos de dominio (`literal`).
 */
export const REDACTED = "[redactado]";

export const CONVERSATION_TEXT_KEYS = [
  "welcome",
  "kb_see_more_label",
  "menu_prompt",
  "option_appointments",
  "option_kb",
  "option_advisor",
  "option_menu",
  "option_cancel",
  "option_confirm",
  "option_accept",
  "option_decline",
  "option_skip",
  "option_restart",
  "option_more",
  "invalid_option",
  "generic_error",
  "kb_prompt",
  "kb_no_results",
  "kb_results_prompt",
  "kb_another",
  "handoff_created",
  "closed_prompt",
  "id_document_type_prompt",
  "doc_type_cc",
  "doc_type_ti",
  "doc_type_ce",
  "doc_type_pa",
  "doc_type_rc",
  "id_document_number_prompt",
  "id_document_number_invalid",
  "verify_intro",
  "verify_q_birth_day",
  "verify_q_birth_month",
  "verify_q_birth_year",
  "verify_q_phone_last_4",
  "verify_q_phone_first_3",
  "verify_q_email_hint",
  "verify_success",
  "verify_failed",
  "verify_locked",
  "verify_unverifiable",
  "prereg_not_found",
  "privacy_notice",
  "privacy_declined",
  "prereg_given_names_prompt",
  "prereg_family_names_prompt",
  "prereg_birth_date_prompt",
  "prereg_phone_prompt",
  "prereg_email_prompt",
  "prereg_invalid",
  "prereg_confirm_prompt",
  "prereg_done",
  "prereg_document_taken",
  "appointments_menu_prompt",
  "option_book",
  "option_reschedule",
  "option_cancel_appointment",
  "book_service_prompt",
  "book_no_services",
  "book_practitioner_prompt",
  "option_any_practitioner",
  "book_day_prompt",
  "book_no_days",
  "book_slot_prompt",
  "book_confirm_prompt",
  "request_created",
  "slot_taken",
  "pending_limit",
  "change_pending",
  "appointment_unavailable",
  "no_upcoming_appointments",
  "pick_appointment_prompt",
  "cancel_confirm_prompt",
  "cancel_request_created",
] as const;

export type ConversationTextKey = (typeof CONVERSATION_TEXT_KEYS)[number];

export type BotText =
  | {
      readonly key: ConversationTextKey;
      readonly params?: Readonly<Record<string, string>>;
      /** Dato de dominio que sigue al texto (p. ej. «Ver más: <pregunta>»). */
      readonly append?: string;
    }
  | { readonly literal: string };

/** Mensaje del bot. `redacted`: se guarda como [redactado] (lleva datos personales). */
export type BotLine = { readonly text: BotText; readonly redacted?: boolean };

export function t(key: ConversationTextKey, params?: Readonly<Record<string, string>>): BotText {
  return params ? { key, params } : { key };
}

export function literal(text: string): BotText {
  return { literal: text };
}

export function line(
  key: ConversationTextKey,
  params?: Readonly<Record<string, string>>,
  redacted = false,
): BotLine {
  return redacted ? { text: t(key, params), redacted } : { text: t(key, params) };
}
