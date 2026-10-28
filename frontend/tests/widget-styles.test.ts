import { describe, expect, it } from "vitest";
import { WIDGET_CSS } from "@/widget/styles";

describe("estilos del widget", () => {
  it("exporta CSS con el prefijo iw- y el acento de marca", () => {
    expect(WIDGET_CSS).toContain(".iw-root");
    expect(WIDGET_CSS).toContain("--iw-accent: #7336f2");
    expect(WIDGET_CSS).toContain(".iw-launcher");
  });
});
