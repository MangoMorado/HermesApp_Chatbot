import { choice, go, isOption, optionValue, prompt, retry } from "../step-kit";
import { line, literal, t } from "../text";
import type { Step } from "../types";

/** Consulta libre contra la KB (busqueda determinista por keywords, sin IA). */
export const kbQuery: Step = {
  id: "kb_query",
  globals: "full",
  echo: "redacted",
  enter(context) {
    return prompt(context, [line("kb_prompt")], [], "text");
  },
  async handle(input, context, env) {
    if (input.kind !== "text") {
      return retry("kb_query", context);
    }
    const hits = await env.reads.searchKnowledge(env.tenantId, input.text, env.params.kbMaxResults);
    if (hits.length === 0) {
      return go("kb_results", { ...context, kbResults: [] }, [line("kb_no_results")]);
    }
    const kbResults = hits
      .filter((hit) => hit.detail !== null)
      .map((hit) => ({ id: hit.id, question: hit.question }));
    const lines = hits.map((hit) => ({ text: literal(`${hit.question}\n${hit.answer}`) }));
    return go("kb_results", { ...context, kbResults }, lines);
  },
};

export const kbResults: Step = {
  id: "kb_results",
  globals: "full",
  echo: "label",
  enter(context) {
    const details = (context.kbResults ?? []).map((result) =>
      choice(`kb:detail:${result.id}`, { key: "kb_see_more_label", append: result.question }),
    );
    return prompt(
      context,
      [line("kb_results_prompt")],
      [...details, choice("kb:another", t("kb_another"))],
    );
  },
  async handle(input, context, env) {
    const id = optionValue(input, "kb:detail:");
    if (id !== null) {
      const hit = await env.reads.getKnowledge(env.tenantId, id);
      const detail = hit?.detail ? { text: literal(hit.detail) } : line("kb_no_results");
      return go("kb_results", context, [detail]);
    }
    if (isOption(input, "kb:another")) {
      return go("kb_query", { ...context, kbResults: [] });
    }
    return retry("kb_results", context);
  },
};
