import type { ConversationConfig } from "../domain/ports";
import type { BotText } from "../domain/text";
import type { ConversationContext } from "../domain/types";

const PLACEHOLDER = /\{([^{}]*)\}/g;

export type RenderedOption = { readonly id: string; readonly label: string };
export type RenderedMessage = { readonly text: string; readonly redacted: boolean };

/** Texto final: plantilla del tenant (o predeterminada) con sus marcadores; o el literal. */
export function renderText(text: BotText, config: ConversationConfig): string {
  if ("literal" in text) {
    return text.literal;
  }
  const params: Record<string, string> = { clinic_name: config.clinicName, ...text.params };
  const template = config.texts[text.key] ?? text.key;
  const rendered = template.replace(PLACEHOLDER, (match, name: string) => params[name] ?? match);
  return text.append ? `${rendered}: ${text.append}` : rendered;
}

export function renderOptions(
  context: ConversationContext,
  config: ConversationConfig,
): RenderedOption[] {
  return context.options.map((option) => ({
    id: option.id,
    label: renderText(option.label, config),
  }));
}
