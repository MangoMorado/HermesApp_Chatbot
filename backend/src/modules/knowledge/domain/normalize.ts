/** Palabras vacias en espanol: no ayudan a distinguir una entrada de otra. */
const STOPWORDS = new Set([
  "a",
  "al",
  "como",
  "con",
  "cual",
  "cuales",
  "cuando",
  "de",
  "del",
  "donde",
  "el",
  "en",
  "es",
  "hay",
  "la",
  "las",
  "lo",
  "los",
  "me",
  "mi",
  "o",
  "para",
  "por",
  "puedo",
  "que",
  "quiero",
  "se",
  "su",
  "sus",
  "te",
  "tu",
  "un",
  "una",
  "y",
]);

/**
 * Normalizacion determinista para buscar en la KB: minusculas, sin diacriticos, todo lo
 * que no sea alfanumerico a espacio, sin stopwords y sin duplicados (en orden de aparicion).
 */
export function normalizeTokens(text: string): string[] {
  const plain = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ");
  const tokens = plain.split(" ").filter((token) => token !== "" && !STOPWORDS.has(token));
  return [...new Set(tokens)];
}
