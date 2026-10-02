import type { BotLine, BotText, ConversationTextKey } from "./text";
import { line } from "./text";
import type {
  ConversationContext,
  EnterResult,
  HandleResult,
  InputMode,
  OptionSpec,
  PatientInput,
  StepId,
} from "./types";

/** Utilidades de los pasos: construir turnos y transiciones sin repetir forma. */
export function prompt(
  context: ConversationContext,
  lines: readonly BotLine[],
  options: readonly OptionSpec[],
  input: InputMode = "none",
): EnterResult {
  return { kind: "prompt", lines, options, input, context };
}

export function redirect(
  goto: StepId,
  context: ConversationContext,
  lines: readonly BotLine[] = [],
): EnterResult {
  return { kind: "goto", goto, context, lines };
}

export function go(
  goto: StepId,
  context: ConversationContext,
  lines: readonly BotLine[] = [],
): HandleResult {
  return { goto, context, lines };
}

/** Repite el paso con un aviso (por defecto «elige una de las opciones»). */
export function retry(
  step: StepId,
  context: ConversationContext,
  key: ConversationTextKey = "invalid_option",
): HandleResult {
  return go(step, context, [line(key)]);
}

export function choice(value: string, label: BotText): OptionSpec {
  return { value, label };
}

/** Sale de cualquier flujo: conserva solo el turno, las opciones y al paciente verificado. */
export function resetFlow(context: ConversationContext): ConversationContext {
  return {
    turn: context.turn,
    options: context.options,
    input: context.input,
    ...(context.patientId ? { patientId: context.patientId } : {}),
  };
}

/** Valor de una opcion con prefijo (`svc:abc` → `abc`); `null` si no aplica. */
export function optionValue(input: PatientInput, prefix: string): string | null {
  return input.kind === "option" && input.value.startsWith(prefix)
    ? input.value.slice(prefix.length)
    : null;
}

export function isOption(input: PatientInput, value: string): boolean {
  return input.kind === "option" && input.value === value;
}
