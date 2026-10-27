import { describe, expect, it } from "vitest";
import { SLOT_HORIZONS, upcomingRange, WEEKDAY_MORNING } from "@/components/simulador/slot-offer";

describe("rango de cupos", () => {
  it("cuenta los días en calendario local y deja el hasta exclusivo", () => {
    const range = upcomingRange(new Date(2026, 9, 13, 23, 30), 14);
    expect(range).toEqual({ from: "2026-10-13", to: "2026-10-27" });
  });

  it("la mañana entre semana son cinco ventanas de 30 minutos", () => {
    expect(WEEKDAY_MORNING.duration_minutes).toBe(30);
    expect(WEEKDAY_MORNING.windows.map((w) => w.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(WEEKDAY_MORNING.windows[0]).toMatchObject({
      start_time: "08:00",
      end_time: "12:00",
    });
  });

  it("los horizontes son 2, 4 y 8 semanas", () => {
    expect(SLOT_HORIZONS.map((h) => h.days)).toEqual([14, 28, 56]);
  });
});
