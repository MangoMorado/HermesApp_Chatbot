import type { Random } from "@/modules/shared/domain/ports/random";
import { QUESTION_BANK, questionById, type VerifiableRecord } from "./questions";

export type QuestionPair = readonly [string, string];

function pick<T>(items: readonly T[], random: Random): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items[random.int(items.length)];
}

/**
 * Dos preguntas disponibles para el expediente, de fuentes distintas si se puede
 * (dia y mes de la misma fecha valen casi como una). `null` si no hay dos.
 */
export function drawPair(record: VerifiableRecord, random: Random): QuestionPair | null {
  const available = QUESTION_BANK.filter((question) => question.isAvailable(record));
  const first = pick(available, random);
  if (!first) {
    return null;
  }
  const others = available.filter((question) => question.id !== first.id);
  const otherSource = others.filter((question) => question.source !== first.source);
  const second = pick(otherSource.length > 0 ? otherSource : others, random);
  return second ? [first.id, second.id] : null;
}

/** El par guardado sigue sirviendo si ambas preguntas existen y aplican al expediente. */
export function pairUsable(pair: readonly string[], record: VerifiableRecord): boolean {
  return pair.length === 2 && pair.every((id) => questionById(id)?.isAvailable(record) === true);
}
