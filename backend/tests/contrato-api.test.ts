import { describe, expect, it } from "vitest";
import { createCheckHealth } from "@/modules/health/application/check-health";

describe("contrato-api: health", () => {
  it("reporta ok con el instante que entrega el puerto de reloj", () => {
    const fixed = new Date("2026-01-15T10:00:00.000Z");
    const checkHealth = createCheckHealth({ now: () => fixed });

    expect(checkHealth()).toEqual({
      status: "ok",
      checkedAt: "2026-01-15T10:00:00.000Z",
    });
  });
});
