import { describe, expect, it } from "vitest";
import { embedSnippets } from "@/lib/embed-snippets";

describe("fragmentos para incrustar el widget", () => {
  const snippets = embedSnippets({
    frontendOrigin: "https://chat.ingenius360.co",
    apiBase: "https://api.ingenius360.co",
    widgetKey: "wk_abc123",
  });

  it("el script apunta a widget.js del frontend y lleva clave y backend", () => {
    expect(snippets.script).toBe(
      '<script src="https://chat.ingenius360.co/widget.js" data-key="wk_abc123" data-api="https://api.ingenius360.co" async></script>',
    );
  });

  it("el iframe apunta a /widget con la clave codificada", () => {
    expect(snippets.iframe).toContain('src="https://chat.ingenius360.co/widget?key=wk_abc123"');
    expect(
      embedSnippets({ frontendOrigin: "https://f", apiBase: "https://b", widgetKey: "a b&c" })
        .iframe,
    ).toContain("key=a%20b%26c");
  });
});
