import { describe, expect, it } from "vitest";
import { describeFailure } from "@/widget/failure";
import { WidgetApiError } from "@/widget/fetcher";

function apiError(status: number, details?: Record<string, unknown>) {
  const body = { error: { code: "x", message: "detalle interno r-123", details } };
  return new WidgetApiError(status, body, `HTTP ${status}`);
}

describe("fallos que ve el paciente", () => {
  it("backend inalcanzable: aviso reintentable, sin detalle técnico", () => {
    const failure = describeFailure(new WidgetApiError(0, null, "Sin conexión con el servidor"));
    expect(failure.terminal).toBe(false);
    expect(failure.waitSeconds).toBe(0);
    expect(failure.text).toBe("No pudimos conectar con el chat. Inténtalo de nuevo en un momento.");
  });

  it("403: el sitio no está autorizado y no hay reintento", () => {
    const failure = describeFailure(apiError(403));
    expect(failure.terminal).toBe(true);
    expect(failure.text).toBe("Este sitio no está autorizado para el chat.");
  });

  it("401 al abrir sesión (clave inválida): terminal", () => {
    expect(describeFailure(apiError(401)).terminal).toBe(true);
  });

  it("429: espera los segundos que dice el backend", () => {
    const failure = describeFailure(apiError(429, { retry_after_seconds: 42 }));
    expect(failure.waitSeconds).toBe(42);
    expect(failure.text).toContain("42");
    expect(failure.terminal).toBe(false);
  });

  it("429 sin segundos espera un minuto", () => {
    expect(describeFailure(apiError(429)).waitSeconds).toBe(60);
  });

  it("nunca muestra el mensaje interno ni códigos", () => {
    for (const error of [apiError(500), apiError(409), new Error("boom r-123")]) {
      const failure = describeFailure(error);
      expect(failure.text).not.toMatch(/r-123|HTTP|\d{3}/);
      expect(failure.terminal).toBe(false);
    }
  });
});
