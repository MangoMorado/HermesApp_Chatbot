import { choice, go, prompt, retry } from "../step-kit";
import { line, t } from "../text";
import type { Step } from "../types";

export const mainMenu: Step = {
  id: "main_menu",
  globals: "full",
  echo: "label",
  enter(context) {
    return prompt(
      context,
      [line("menu_prompt")],
      [choice("menu:appointments", t("option_appointments")), choice("menu:kb", t("option_kb"))],
    );
  },
  handle(input, context) {
    if (input.kind === "option" && input.value === "menu:appointments") {
      return go(context.patientId ? "appointments_menu" : "id_document_type", context);
    }
    if (input.kind === "option" && input.value === "menu:kb") {
      return go("kb_query", context);
    }
    return retry("main_menu", context);
  },
};

/** Tras crear un handoff: solo Menu y Asesor (globales). */
export const closed: Step = {
  id: "closed",
  globals: "full",
  echo: "label",
  enter(context) {
    return prompt(context, [line("closed_prompt")], []);
  },
  handle(_input, context) {
    return retry("closed", context);
  },
};

/** Verificacion bloqueada o imposible: el contexto lleva `handoffReason` para el ticket. */
export const verificationBlocked: Step = {
  id: "verification_blocked",
  globals: "full",
  echo: "label",
  enter(context) {
    return prompt(context, [line("menu_prompt")], []);
  },
  handle(_input, context) {
    return retry("verification_blocked", context);
  },
};
