import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetApiError, widgetFetcher } from "@/widget/fetcher";

function stubFetch(result: Response | Error) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function failure(run: Promise<unknown>): Promise<WidgetApiError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof WidgetApiError)) {
    throw new Error("se esperaba un WidgetApiError");
  }
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetcher del widget", () => {
  it("usa la URL absoluta del backend y solo el token del widget", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    const data = await widgetFetcher<{ ok: boolean }>("/api/v1/widget/conversation", {
      apiBase: "https://api.test",
      token: "w-token",
      method: "GET",
    });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(data).toEqual({ ok: true });
    expect(url).toBe("https://api.test/api/v1/widget/conversation");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer w-token");
    expect(init?.credentials).toBe("omit");
    expect(init).not.toHaveProperty("apiBase");
    expect(init).not.toHaveProperty("token");
  });

  it("sin token no manda Authorization", async () => {
    const mock = stubFetch(Response.json({}, { status: 201 }));
    await widgetFetcher("/api/v1/widget/sessions", { apiBase: "https://api.test", method: "POST" });
    const [, init] = mock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("traduce el error del contrato con su motivo", async () => {
    const body = {
      error: {
        code: "conflict",
        message: "La opcion ya no esta vigente",
        request_id: "r1",
        details: { reason: "stale_option" },
      },
    };
    stubFetch(Response.json(body, { status: 409 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(error.reason).toBe("stale_option");
    expect(error.message).toBe("La opcion ya no esta vigente");
    expect(error.retryable).toBe(false);
  });

  it("el 429 expone los segundos de espera del cuerpo", async () => {
    const body = {
      error: { code: "rate_limited", message: "x", details: { retry_after_seconds: 42 } },
    };
    stubFetch(Response.json(body, { status: 429 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.retryAfterSeconds).toBe(42);
  });

  it("un fallo de red es status 0 y reintentable", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.mal-escrito" }));
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });

  it("una respuesta de error que no es JSON no rompe y es reintentable", async () => {
    stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.retryable).toBe(true);
  });

  it("un 2xx con cuerpo que no es JSON lanza WidgetApiError con ese status", async () => {
    stubFetch(new Response("<html>ok</html>", { status: 200 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.status).toBe(200);
    expect(error.code).toBeNull();
  });

  it("un 2xx con cuerpo vacío acepta null", async () => {
    stubFetch(new Response("", { status: 200 }));
    await expect(widgetFetcher("/x", { apiBase: "https://api.test" })).resolves.toBeNull();
  });
});
