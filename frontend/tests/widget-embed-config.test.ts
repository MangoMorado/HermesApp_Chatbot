import { describe, expect, it } from "vitest";
import { alreadyMounted, HOST_ID, readEmbedConfig } from "@/widget/embed-config";

describe("configuración del script incrustable", () => {
  it("lee la clave y el origen del backend", () => {
    expect(readEmbedConfig({ key: " wk_demo ", api: "https://api.clinica.co/" })).toEqual({
      apiBase: "https://api.clinica.co",
      widgetKey: "wk_demo",
    });
  });

  it("se queda con el origen aunque data-api traiga ruta", () => {
    expect(readEmbedConfig({ key: "wk", api: "http://localhost:3001/api/v1" })?.apiBase).toBe(
      "http://localhost:3001",
    );
  });

  it("sin clave o sin backend no hay configuración", () => {
    expect(readEmbedConfig({ api: "https://api.clinica.co" })).toBeNull();
    expect(readEmbedConfig({ key: "wk" })).toBeNull();
    expect(readEmbedConfig({ key: "   ", api: "https://api.clinica.co" })).toBeNull();
  });

  it("rechaza un data-api que no es http(s)", () => {
    expect(readEmbedConfig({ key: "wk", api: "javascript:alert(1)" })).toBeNull();
    expect(readEmbedConfig({ key: "wk", api: "api.clinica.co" })).toBeNull();
  });

  it("el fragmento pegado dos veces monta un solo widget", () => {
    const empty = { getElementById: () => null };
    const mounted = {
      getElementById: (id: string) => (id === HOST_ID ? ({} as HTMLElement) : null),
    };
    expect(alreadyMounted(empty)).toBe(false);
    expect(alreadyMounted(mounted)).toBe(true);
  });
});
