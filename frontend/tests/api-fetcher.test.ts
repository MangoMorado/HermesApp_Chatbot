import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiFetcher } from "@/lib/api-fetcher";
import { IDEMPOTENCY_HEADER, idempotent, settleIdempotencyKey } from "@/lib/idempotency";

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function stubFetch(result: Response) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => result);
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function failure(run: Promise<unknown>): Promise<ApiClientError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiClientError)) {
    throw new Error("se esperaba un ApiClientError");
  }
  return error;
}

describe("apiFetcher", () => {
  it("añade Bearer desde sessionStorage y Content-Type si hay body", async () => {
    sessionStorage.setItem("hermes.jwt", "panel-jwt");
    const mock = stubFetch(Response.json({ ok: true }));
    await apiFetcher("/api/v1/me", { method: "POST", body: "{}" });
    const [, init] = mock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer panel-jwt");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("sin token no manda Authorization ni Content-Type en GET", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    await apiFetcher("/api/v1/health");
    const [, init] = mock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("204 ok con Idempotency-Key libera la clave y devuelve undefined", async () => {
    const init = idempotent("delete:1", {});
    const key = new Headers(init.headers).get(IDEMPOTENCY_HEADER) ?? "";
    stubFetch(new Response(null, { status: 204 }));
    const data = await apiFetcher<undefined>("/api/v1/x", { method: "DELETE", ...init });
    expect(data).toBeUndefined();
    // Tras settle, el mismo envío obtiene otra clave.
    expect(new Headers(idempotent("delete:1", {}).headers).get(IDEMPOTENCY_HEADER)).not.toBe(key);
  });

  it("2xx con HTML lanza ApiClientError sin cuerpo", async () => {
    stubFetch(new Response("<html>proxy</html>", { status: 200 }));
    const error = await failure(apiFetcher("/api/v1/x"));
    expect(error.status).toBe(200);
    expect(error.body).toBeNull();
    expect(error.message).toMatch(/sin JSON/);
  });

  it("2xx con cuerpo vacío acepta null", async () => {
    stubFetch(new Response("", { status: 200 }));
    await expect(apiFetcher("/api/v1/x")).resolves.toBeNull();
  });

  it("error REST con envoltura expone code y message", async () => {
    stubFetch(
      Response.json(
        {
          error: {
            code: "not_found",
            message: "no está",
            request_id: "r1",
          },
        },
        { status: 404 },
      ),
    );
    const error = await failure(apiFetcher("/api/v1/x"));
    expect(error.status).toBe(404);
    expect(error.message).toBe("no está");
    expect(error.body?.error.code).toBe("not_found");
  });

  it("error sin envoltura usa el fallback HTTP", async () => {
    stubFetch(Response.json({ oops: true }, { status: 500 }));
    const error = await failure(apiFetcher("/api/v1/x"));
    expect(error.message).toBe("HTTP 500");
    expect(error.body).toBeNull();
  });

  it("settle con clave desconocida no rompe", () => {
    expect(() => settleIdempotencyKey("clave-que-no-existe")).not.toThrow();
  });
});
