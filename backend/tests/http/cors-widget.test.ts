import { beforeEach, describe, expect, it, vi } from "vitest";

const isWidgetOriginRegistered = vi.fn(async (_origin: string) => false);

vi.mock("@/composition-root", () => ({
  getContainer: () => ({ isWidgetOriginRegistered }),
}));

import { assertSessionOrigin, widgetPreflight, withWidgetCors } from "@/http/cors";
import { AuthError } from "@/modules/auth/domain/auth-error";

describe("cors: widget", () => {
  beforeEach(() => {
    isWidgetOriginRegistered.mockReset();
    isWidgetOriginRegistered.mockResolvedValue(false);
  });

  it("withWidgetCors anade Allow-Origin solo si el origen esta registrado", async () => {
    isWidgetOriginRegistered.mockResolvedValue(true);
    const handler = withWidgetCors(async () => new Response("ok", { status: 200 }));
    const response = await handler(
      new Request("http://localhost/api/v1/widget/sessions", {
        headers: { Origin: "https://clinica.test" },
      }),
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://clinica.test");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("withWidgetCors no pone Allow-Origin sin Origin o sin registro", async () => {
    const handler = withWidgetCors(async () => new Response("ok"));
    const without = await handler(new Request("http://localhost/x"));
    expect(without.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const unknown = await handler(
      new Request("http://localhost/x", { headers: { Origin: "https://otra.test" } }),
    );
    expect(unknown.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("preflight 204 declara metodos y cabeceras cuando el origen vale", async () => {
    isWidgetOriginRegistered.mockResolvedValue(true);
    const response = await widgetPreflight(
      new Request("http://localhost/api/v1/widget/sessions", {
        method: "OPTIONS",
        headers: { Origin: "https://clinica.test" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("assertSessionOrigin exige el mismo origen que abrio la sesion", () => {
    expect(() =>
      assertSessionOrigin(
        new Request("http://localhost/x", { headers: { Origin: "https://otra.test" } }),
        { origin: "https://clinica.test" },
      ),
    ).toThrow(AuthError);
    expect(() =>
      assertSessionOrigin(
        new Request("http://localhost/x", { headers: { Origin: "HTTPS://Clinica.TEST" } }),
        { origin: "https://clinica.test" },
      ),
    ).not.toThrow();
    expect(() =>
      assertSessionOrigin(new Request("http://localhost/x"), { origin: "https://clinica.test" }),
    ).not.toThrow();
  });
});
