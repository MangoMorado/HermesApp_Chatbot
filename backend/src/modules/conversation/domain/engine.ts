import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { maskDocument, normalizeDocument } from "./format";
import { resetFlow } from "./step-kit";
import { type BotLine, type BotText, line, REDACTED, t } from "./text";
import type {
  ConversationContext,
  ConversationState,
  Effect,
  EffectOutcome,
  HandleResult,
  IncomingMessage,
  OptionSpec,
  PatientInput,
  Step,
  StepEnv,
  StepId,
  StepRegistry,
} from "./types";

/** Opciones globales que el motor resuelve antes que el paso. */
export const NAV = { menu: "nav:menu", advisor: "nav:advisor", cancel: "nav:cancel" } as const;

const MAX_HOPS = 8;
/** Solo un documento con forma plausible se ecoa (enmascarado); lo demas va redactado. */
const DOCUMENT_SHAPE = /^[A-Z0-9]{5,20}$/;

export type Echo = { readonly text: BotText; readonly redacted: boolean };
export type TurnOutput = {
  readonly state: ConversationState;
  readonly echo: Echo | null;
  readonly lines: readonly BotLine[];
};
export type RunEffect = (effect: Effect) => Promise<EffectOutcome>;

function initialContext(): ConversationContext {
  return { turn: 0, options: [], input: "none" };
}

export function startConversation(env: StepEnv, steps: StepRegistry): Promise<TurnOutput> {
  return settle(steps, "main_menu", initialContext(), [line("welcome")], env, null);
}

/** Un turno: resuelve la entrada, aplica el paso (y su efecto) y entra al siguiente. */
export async function runTurn(
  state: ConversationState,
  message: IncomingMessage,
  env: StepEnv,
  runEffect: RunEffect,
  steps: StepRegistry,
): Promise<TurnOutput> {
  const step = steps[state.step];
  const input = resolveInput(state.context, message);
  const echo = echoOf(step, input, state.context);
  const handled = await dispatch(step, input, state.context, env, runEffect);
  return settle(steps, handled.goto, handled.context, handled.lines, env, echo);
}

function resolveInput(context: ConversationContext, message: IncomingMessage): PatientInput {
  if ("text" in message) {
    return { kind: "text", text: message.text };
  }
  const found = context.options.find((option) => option.id === message.optionId);
  if (!found) {
    throw new ConflictError("La opcion ya no esta vigente", { reason: "stale_option" });
  }
  return { kind: "option", value: found.value, label: found.label };
}

/** Texto libre siempre redactado salvo el documento, que va enmascarado (refinamiento 5). */
function echoOf(step: Step, input: PatientInput, context: ConversationContext): Echo {
  const redacted: Echo = { text: { literal: REDACTED }, redacted: true };
  if (input.kind === "option") {
    return step.echo === "redacted" ? redacted : { text: input.label, redacted: false };
  }
  if (step.echo === "document" && DOCUMENT_SHAPE.test(normalizeDocument(input.text))) {
    return { text: { literal: maskDocument(context.documentType, input.text) }, redacted: false };
  }
  return redacted;
}

async function dispatch(
  step: Step,
  input: PatientInput,
  context: ConversationContext,
  env: StepEnv,
  runEffect: RunEffect,
): Promise<HandleResult> {
  if (input.kind === "option" && input.value.startsWith("nav:")) {
    return navigate(input.value, context, runEffect);
  }
  if (input.kind === "text" && context.input === "none") {
    return { goto: step.id, context, lines: [line("invalid_option")] };
  }
  const result = await step.handle(input, context, env);
  if (!result.effect) {
    return result;
  }
  const outcome = await runEffect(result.effect);
  const next = result.onOutcome ? result.onOutcome(outcome) : result;
  if (result.onOutcome && next.effect) {
    throw new Error(`El paso ${step.id} declaro un efecto en su continuacion`);
  }
  return next;
}

async function navigate(
  value: string,
  context: ConversationContext,
  runEffect: RunEffect,
): Promise<HandleResult> {
  if (value !== NAV.advisor) {
    return { goto: "main_menu", context: resetFlow(context), lines: [] };
  }
  if (!context.handoffRequested) {
    await runEffect({
      kind: "handoff",
      reason: context.handoffReason ?? "requested",
      medicalRecordId: context.patientId ?? null,
    });
  }
  const closed = { ...resetFlow(context), handoffRequested: true };
  return { goto: "closed", context: closed, lines: [line("handoff_created")] };
}

function withGlobals(step: Step, options: readonly OptionSpec[]): OptionSpec[] {
  if (step.globals === "cancel_only") {
    return [...options, { value: NAV.cancel, label: t("option_cancel") }];
  }
  const menu = step.id === "main_menu" ? [] : [{ value: NAV.menu, label: t("option_menu") }];
  return [...options, ...menu, { value: NAV.advisor, label: t("option_advisor") }];
}

/** Entra al paso destino siguiendo redirecciones hasta un turno con opciones. */
async function settle(
  steps: StepRegistry,
  goto: StepId,
  context: ConversationContext,
  lines: readonly BotLine[],
  env: StepEnv,
  echo: Echo | null,
): Promise<TurnOutput> {
  const said = [...lines];
  let target = goto;
  let current = context;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const entered = await steps[target].enter(current, env);
    said.push(...entered.lines);
    if (entered.kind === "goto") {
      target = entered.goto;
      current = entered.context;
      continue;
    }
    const turn = entered.context.turn + 1;
    const options = withGlobals(steps[target], entered.options).map((option, index) => ({
      ...option,
      id: `${turn}.${index + 1}`,
    }));
    const next = { ...entered.context, turn, options, input: entered.input };
    return { state: { step: target, context: next }, echo, lines: said };
  }
  throw new Error(`El flujo no se estabilizo al entrar a ${goto}`);
}
