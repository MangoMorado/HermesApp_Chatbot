import { describe, expect, it } from "vitest";
import {
  isKeyAccepted,
  planRotation,
  splitKeys,
  WIDGET_KEY_PATTERN,
  type WidgetKey,
} from "@/modules/bot-config/domain/widget-key";
import { cryptoWidgetKeyGenerator } from "@/modules/bot-config/infrastructure/crypto-widget-key-generator";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const HOUR = 3_600_000;

function key(overrides: Partial<WidgetKey> = {}): WidgetKey {
  return {
    id: "k1",
    tenantId: toTenantId("tenant-a"),
    key: `wk_${"a".repeat(43)}`,
    createdAt: new Date(NOW.getTime() - 10 * HOUR),
    retiredAt: null,
    graceUntil: null,
    ...overrides,
  };
}

describe("conocimiento-config: aceptacion de claves del widget", () => {
  it("la vigente se acepta", () => {
    expect(isKeyAccepted(key(), NOW)).toBe(true);
  });

  it("la retirada se acepta solo antes de que venza su gracia", () => {
    const retired = { retiredAt: new Date(NOW.getTime() - HOUR) };
    expect(isKeyAccepted(key({ ...retired, graceUntil: new Date(NOW.getTime() + 1) }), NOW)).toBe(
      true,
    );
    expect(isKeyAccepted(key({ ...retired, graceUntil: NOW }), NOW)).toBe(false);
    expect(isKeyAccepted(key({ ...retired, graceUntil: null }), NOW)).toBe(false);
  });
});

describe("conocimiento-config: rotacion de claves", () => {
  it("la vigente pasa a gracia por las horas del tenant", () => {
    expect(planRotation([key()], NOW, 24)).toEqual([
      { id: "k1", retiredAt: NOW, graceUntil: new Date(NOW.getTime() + 24 * HOUR) },
    ]);
  });

  it("la que ya estaba en gracia muere al instante", () => {
    const inGrace = key({
      id: "k0",
      retiredAt: new Date(NOW.getTime() - HOUR),
      graceUntil: new Date(NOW.getTime() + HOUR),
    });
    expect(planRotation([key(), inGrace], NOW, 24)).toEqual([
      { id: "k1", retiredAt: NOW, graceUntil: new Date(NOW.getTime() + 24 * HOUR) },
      { id: "k0", retiredAt: inGrace.retiredAt, graceUntil: NOW },
    ]);
  });

  it("gracia de 0 horas retira la vigente sin ventana", () => {
    expect(planRotation([key()], NOW, 0)).toEqual([{ id: "k1", retiredAt: NOW, graceUntil: NOW }]);
  });

  it("separa la vigente de la que esta en gracia", () => {
    const inGrace = key({ id: "k0", retiredAt: NOW, graceUntil: new Date(NOW.getTime() + HOUR) });
    expect(splitKeys([inGrace, key()])).toEqual({ current: key(), grace: inGrace });
    expect(splitKeys([])).toEqual({ current: null, grace: null });
  });
});

describe("conocimiento-config: generador de claves", () => {
  it("produce wk_ + 43 caracteres base64url, distintos cada vez", () => {
    const first = cryptoWidgetKeyGenerator.next();
    const second = cryptoWidgetKeyGenerator.next();
    expect(first).toMatch(WIDGET_KEY_PATTERN);
    expect(second).toMatch(WIDGET_KEY_PATTERN);
    expect(first).not.toBe(second);
  });
});
