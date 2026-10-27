import { describe, expect, it } from "vitest";
import { dayOf, shortId, splitDateTime, text } from "@/lib/format";

describe("formato del tablero", () => {
  it("parte un ISO válido en día corto y hora 24h", () => {
    const parts = splitDateTime("2026-09-22T14:30:00.000Z");
    expect(parts).not.toBeNull();
    expect(parts?.iso).toBe("2026-09-22T14:30:00.000Z");
    expect(parts?.day).toMatch(/\S+ \d{2} \S+/);
    expect(parts?.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("rechaza vacío, no-string e ISO inválido", () => {
    expect(splitDateTime("")).toBeNull();
    expect(splitDateTime(null)).toBeNull();
    expect(splitDateTime(42)).toBeNull();
    expect(splitDateTime("no-es-fecha")).toBeNull();
  });

  it("text convierte null/undefined en cadena vacía y el resto a String", () => {
    const row = { name: "Ana", empty: null, missing: undefined, n: 7 };
    expect(text(row, "name")).toBe("Ana");
    expect(text(row, "empty")).toBe("");
    expect(text(row, "missing")).toBe("");
    expect(text(row, "n")).toBe("7");
    expect(text(row, "ausente")).toBe("");
  });

  it("shortId deja ids cortos y abrevia los largos", () => {
    expect(shortId("abc")).toBe("abc");
    expect(shortId("1234567890123")).toBe("1234567890123");
    expect(shortId("12345678901234")).toBe("12345678…1234");
  });

  it("dayOf usa el día del ISO o «Sin fecha»", () => {
    expect(dayOf("2026-09-22T14:30:00.000Z")).toMatch(/\S+ \d{2} \S+/);
    expect(dayOf(undefined)).toBe("Sin fecha");
    expect(dayOf("x")).toBe("Sin fecha");
  });
});
