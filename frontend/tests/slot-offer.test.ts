import { describe, expect, it } from "vitest";
import { upcomingRange } from "@/components/simulador/slot-offer";

describe("rango de cupos", () => {
  it("cuenta los días en calendario local y deja el hasta exclusivo", () => {
    const range = upcomingRange(new Date(2026, 9, 13, 23, 30), 14);
    expect(range).toEqual({ from: "2026-10-13", to: "2026-10-27" });
  });
});
