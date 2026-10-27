import type { KnowledgeEntry, KnowledgeEntryInput } from "@/api/models";

/**
 * Forma del formulario de una entrada de la base de conocimiento. Solo da forma al envío
 * (recortar, separar la lista); la validación de contenido es del backend.
 */
export type KnowledgeDraft = {
  readonly category: string;
  readonly question: string;
  readonly answer: string;
  readonly detail: string;
  /** Lista escrita con comas. */
  readonly keywords: string;
  readonly position: string;
  readonly active: boolean;
};

export const EMPTY_DRAFT: KnowledgeDraft = {
  category: "",
  question: "",
  answer: "",
  detail: "",
  keywords: "",
  position: "0",
  active: true,
};

/** «horario, ,Horario,citas» → `["horario", "citas"]`: sin vacíos ni repetidos. */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(",")) {
    const word = part.trim();
    const id = word.toLowerCase();
    if (word && !seen.has(id)) {
      seen.add(id);
      keywords.push(word);
    }
  }
  return keywords;
}

export function formatKeywords(list: readonly string[]): string {
  return list.join(", ");
}

export function draftOf(entry: KnowledgeEntry): KnowledgeDraft {
  return {
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    detail: entry.detail ?? "",
    keywords: formatKeywords(entry.keywords),
    position: String(entry.position),
    active: entry.active,
  };
}

export function inputOf(draft: KnowledgeDraft): KnowledgeEntryInput {
  const detail = draft.detail.trim();
  return {
    category: draft.category.trim(),
    question: draft.question.trim(),
    answer: draft.answer.trim(),
    detail: detail || null,
    keywords: parseKeywords(draft.keywords),
    position: Number(draft.position),
    active: draft.active,
  };
}
