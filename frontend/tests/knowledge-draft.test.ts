import { describe, expect, it } from "vitest";
import {
  draftOf,
  EMPTY_DRAFT,
  formatKeywords,
  inputOf,
  parseKeywords,
} from "@/lib/knowledge-draft";

describe("borrador de una entrada de conocimiento", () => {
  it("limpia comas sobrantes, espacios y repetidos de las palabras clave", () => {
    expect(parseKeywords(" horario, ,Horario,citas ,")).toEqual(["horario", "citas"]);
  });

  it("sin palabras clave envía una lista vacía, no una entrada vacía", () => {
    expect(parseKeywords("")).toEqual([]);
    expect(parseKeywords(" , ,, ")).toEqual([]);
  });

  it("formatKeywords es legible y reversible", () => {
    expect(formatKeywords(["horario", "citas"])).toBe("horario, citas");
    expect(parseKeywords(formatKeywords(["horario", "citas"]))).toEqual(["horario", "citas"]);
  });

  it("inputOf recorta, convierte la posición y manda detail nulo si está vacío", () => {
    const input = inputOf({
      ...EMPTY_DRAFT,
      category: " Horarios ",
      question: " ¿Cuándo abren? ",
      answer: " De 8 a 5 ",
      detail: "   ",
      keywords: "horario, abren",
      position: "3",
      active: false,
    });
    expect(input).toEqual({
      category: "Horarios",
      question: "¿Cuándo abren?",
      answer: "De 8 a 5",
      detail: null,
      keywords: ["horario", "abren"],
      position: 3,
      active: false,
    });
  });

  it("draftOf carga una entrada existente en el formulario", () => {
    const draft = draftOf({
      id: "e1",
      category: "Horarios",
      question: "¿Cuándo abren?",
      answer: "De 8 a 5",
      detail: null,
      keywords: ["horario", "abren"],
      position: 3,
      active: true,
    });
    expect(draft).toEqual({
      category: "Horarios",
      question: "¿Cuándo abren?",
      answer: "De 8 a 5",
      detail: "",
      keywords: "horario, abren",
      position: "3",
      active: true,
    });
  });
});
