import { describe, expect, it } from "vitest";
import { DEFAULT_KNOWLEDGE_ENTRIES } from "@/modules/knowledge/domain/default-entries";
import {
  KNOWLEDGE_LIMITS,
  mergeEntryPatch,
  parseEntryDraft,
} from "@/modules/knowledge/domain/knowledge-entry";
import { normalizeTokens } from "@/modules/knowledge/domain/normalize";
import { searchEntries } from "@/modules/knowledge/domain/search";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const VALID = {
  category: "Citas",
  question: "¿Cómo agendo?",
  answer: "Desde este chat.",
  keywords: ["Agendar", "cita médica"],
};

describe("conocimiento-config: normalizacion", () => {
  it("quita tildes, signos, mayusculas, stopwords y duplicados", () => {
    expect(normalizeTokens("¿Cuál es el HORARIO de atención? ¡Horario!")).toEqual([
      "horario",
      "atencion",
    ]);
  });

  it("la eñe pierde la virgulilla", () => {
    expect(normalizeTokens("Mañana")).toEqual(["manana"]);
  });

  it("un texto sin tokens utiles queda vacio", () => {
    expect(normalizeTokens("¿de la?")).toEqual([]);
  });
});

describe("conocimiento-config: entradas", () => {
  it("aplica predeterminados y normaliza las keywords", () => {
    expect(parseEntryDraft(VALID)).toEqual({
      category: "Citas",
      question: "¿Cómo agendo?",
      answer: "Desde este chat.",
      detail: null,
      keywords: ["agendar", "cita", "medica"],
      position: 0,
      active: true,
    });
  });

  it("recorta espacios de los textos", () => {
    expect(parseEntryDraft({ ...VALID, category: "  Citas  " }).category).toBe("Citas");
  });

  it.each([
    [{ ...VALID, category: "" }, "category"],
    [{ ...VALID, category: "x".repeat(61) }, "category"],
    [{ ...VALID, question: "x".repeat(201) }, "question"],
    [{ ...VALID, answer: undefined }, "answer"],
    [{ ...VALID, detail: "x".repeat(4001) }, "detail"],
    [{ ...VALID, keywords: "agendar" }, "keywords"],
    [{ ...VALID, keywords: [1] }, "keywords"],
    [{ ...VALID, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }, "keywords"],
    [{ ...VALID, position: -1 }, "position"],
    [{ ...VALID, position: 1.5 }, "position"],
    [{ ...VALID, active: "si" }, "active"],
  ])("rechaza %j", (raw, field) => {
    try {
      parseEntryDraft(raw);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });

  it("el parche solo cambia lo que trae y revalida el conjunto", () => {
    const existing = parseEntryDraft(VALID);
    expect(mergeEntryPatch(existing, { active: false, detail: "Mas info" })).toEqual({
      ...existing,
      active: false,
      detail: "Mas info",
    });
    expect(mergeEntryPatch(existing, { detail: null }).detail).toBeNull();
    expect(() => mergeEntryPatch(existing, { question: "" })).toThrow(ValidationError);
  });

  it("el tope por tenant es 500", () => {
    expect(KNOWLEDGE_LIMITS.entriesPerTenant).toBe(500);
  });
});

describe("conocimiento-config: busqueda por tokens", () => {
  const entries = [
    { id: "b", keywords: ["cita", "agendar"], position: 2, active: true },
    { id: "a", keywords: ["cita"], position: 1, active: true },
    { id: "c", keywords: ["horario"], position: 0, active: true },
    { id: "d", keywords: ["cita", "agendar"], position: 0, active: false },
  ];

  it("ordena por coincidencias, luego posicion y luego id; excluye inactivas", () => {
    expect(searchEntries(entries, "Quiero agendar una cita", 3).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("respeta el maximo de resultados", () => {
    expect(searchEntries(entries, "cita", 1).map((e) => e.id)).toEqual(["a"]);
  });

  it("sin coincidencias o sin tokens no devuelve nada", () => {
    expect(searchEntries(entries, "parqueadero", 3)).toEqual([]);
    expect(searchEntries(entries, "¿de la?", 3)).toEqual([]);
  });
});

describe("alta-chatbot: entradas de ejemplo", () => {
  it("son tres y ya estan validadas y normalizadas", () => {
    expect(DEFAULT_KNOWLEDGE_ENTRIES).toHaveLength(3);
    for (const entry of DEFAULT_KNOWLEDGE_ENTRIES) {
      expect(parseEntryDraft(entry)).toEqual(entry);
    }
  });
});
