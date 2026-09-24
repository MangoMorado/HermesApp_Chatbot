import type { KnowledgeEntry } from "./knowledge-entry";
import { normalizeTokens } from "./normalize";

type Searchable = Pick<KnowledgeEntry, "id" | "keywords" | "position" | "active">;

/**
 * Busqueda determinista (sin IA): score = tokens de la consulta presentes en las keywords.
 * Solo entradas activas con score > 0; orden score desc, position asc, id asc.
 */
export function searchEntries<T extends Searchable>(
  entries: readonly T[],
  query: string,
  maxResults: number,
): T[] {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) {
    return [];
  }
  return entries
    .filter((entry) => entry.active)
    .map((entry) => ({
      entry,
      score: tokens.filter((t) => entry.keywords.includes(t)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.position - b.entry.position ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, maxResults)
    .map(({ entry }) => entry);
}
