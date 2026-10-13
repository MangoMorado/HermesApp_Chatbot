import { describe, expect, it } from "vitest";
import { PLATFORMS, SESSION_SHORTCUT } from "@/components/shell/platforms";

describe("destinos de la consola", () => {
  it("son siete, en el orden de la spec", () => {
    expect(PLATFORMS.map((item) => item.href)).toEqual([
      "/panel",
      "/panel/conocimiento",
      "/panel/bot",
      "/panel/ajustes",
      "/chat",
      "/simulador",
      "/simulador/bandeja",
    ]);
  });

  it("cada atajo es una tecla distinta del 1 al 7 y ninguna pisa la de sesión", () => {
    const keys = PLATFORMS.map((item) => item.key);
    expect(keys).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(keys).not.toContain(SESSION_SHORTCUT);
    expect(SESSION_SHORTCUT).toBe("0");
  });
});
