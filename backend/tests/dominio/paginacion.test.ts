import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
  parseLimit,
  toPage,
} from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("dominio: paginacion", () => {
  it("usa 50 por defecto", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("")).toBe(50);
  });

  it("acepta limites entre 1 y 200", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("200")).toBe(MAX_PAGE_LIMIT);
  });

  it.each(["0", "201", "-3", "abc", "1.5"])("rechaza limit=%s", (raw) => {
    expect(() => parseLimit(raw)).toThrow(ValidationError);
  });

  it("el cursor ida y vuelta conserva la posicion", () => {
    const position = {
      key: "2026-03-02T13:00:00.000Z",
      id: "0192a3f0-aaaa-7bbb-8ccc-000000000001",
    };
    const raw = encodeCursor(position);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(raw)).toEqual(position);
  });

  const toBase64Url = (text: string): string =>
    btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it.each([
    "",
    "%%%",
    "bm90LWpzb24",
    btoa(JSON.stringify({ a: 1 })),
    // base64url y JSON validos, pero con forma equivocada (arreglo de un solo elemento):
    // ejercita el chequeo de forma/tipo de decodeCursor, no el charset ni el JSON.parse.
    toBase64Url(JSON.stringify(["solo"])),
  ])("rechaza cursor malformado %s", (raw) => {
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("toPage corta en limit y emite cursor solo si hay mas", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id-${n}`, at: `k-${n}` }));
    const position = (row: { id: string; at: string }) => ({ key: row.at, id: row.id });

    const full = toPage(rows, 2, position);
    expect(full.data).toHaveLength(2);
    expect(full.nextCursor).not.toBeNull();
    expect(decodeCursor(full.nextCursor as string)).toEqual({ key: "k-2", id: "id-2" });

    const last = toPage(rows.slice(0, 2), 2, position);
    expect(last.data).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
  });
});
