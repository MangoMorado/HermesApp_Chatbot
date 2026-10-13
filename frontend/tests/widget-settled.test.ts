import { describe, expect, it } from "vitest";
import { nextSettled, shouldFocus } from "@/widget/settled";

describe("foco y borrador tras un envío", () => {
  it("la carga inicial no pide foco", () => {
    expect(shouldFocus(null, 0)).toBe(false);
  });

  it("un envío resuelto pide foco una sola vez", () => {
    const settled = nextSettled(null, "turn");
    expect(shouldFocus(settled, 0)).toBe(true);
    expect(shouldFocus(settled, settled.seq)).toBe(false);
  });

  it("invalid pide foco pero conserva el borrador", () => {
    const first = nextSettled(null, "turn");
    const second = nextSettled(first, "invalid");
    expect(second.seq).toBe(first.seq + 1);
    expect(second.turns).toBe(first.turns);
  });

  it("turn, stale y reopened vacían el borrador", () => {
    for (const kind of ["turn", "stale", "reopened"] as const) {
      expect(nextSettled(null, kind).turns).toBe(1);
    }
  });
});
