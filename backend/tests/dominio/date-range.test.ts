import { describe, expect, it } from "vitest";
import { parseQueryRange, startOfDayInZone } from "@/modules/shared/domain/date-range";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("dominio: rango de fechas", () => {
  it("interpreta fechas sin hora como inicio del dia en la zona", () => {
    const range = parseQueryRange("2026-03-01", "2026-03-02", "America/Bogota", 31);
    expect(range.from).toEqual(startOfDayInZone("2026-03-01", "America/Bogota"));
    expect(range.to).toEqual(startOfDayInZone("2026-03-02", "America/Bogota"));
  });

  it("acepta instantes con offset tal cual", () => {
    const range = parseQueryRange(
      "2026-03-01T05:00:00.000Z",
      "2026-03-02T05:00:00.000Z",
      "America/Bogota",
      31,
    );
    expect(range.from.toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-03-02T05:00:00.000Z");
  });

  it("rechaza un rango mayor al tope del tenant", () => {
    expect(() => parseQueryRange("2026-01-01", "2026-03-01", "America/Bogota", 31)).toThrow(
      ValidationError,
    );
    try {
      parseQueryRange("2026-01-01", "2026-03-01", "America/Bogota", 31);
    } catch (error) {
      expect((error as ValidationError).details).toEqual(
        expect.objectContaining({ max_query_range_days: 31 }),
      );
    }
  });
});
