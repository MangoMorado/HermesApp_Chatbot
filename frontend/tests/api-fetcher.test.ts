import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiFetcher } from "@/lib/api-fetcher";
import { IDEMPOTENCY_HEADER, idempotent, settleIdempotencyKey } from "@/lib/idempotency";
import { setRenewer, setSession } from "@/lib/token";

beforeEach(() => {
  setSession(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setRenewer(null);
  setSession(null);
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
  it("añade Bearer de la sesión y Content-Type si hay body", async () => {
    setSession({ accessToken: "panel-jwt", sessionKey: "s" });
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

describe("apiFetcher ante 401", () => {
  function sequence(...responses: Response[]) {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
      const next = responses.shift();
      if (!next) {
        throw new Error("fetch de más");
      }
      return next;
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  const unauthorized = () =>
    Response.json(
      { error: { code: "unauthorized", message: "no", request_id: "r" } },
      { status: 401 },
    );

  it("un 401 renueva y reintenta una vez con el token nuevo", async () => {
    setSession({ accessToken: "at-1", sessionKey: "s" });
    setRenewer(async () => "at-2");
    const mock = sequence(unauthorized(), Response.json({ ok: true }));
    const init = idempotent("retry:1", { a: 1 });
    await apiFetcher("/api/v1/x", { method: "POST", ...init });
    expect(mock).toHaveBeenCalledTimes(2);
    const first = new Headers(mock.mock.calls[0]?.[1]?.headers);
    const second = new Headers(mock.mock.calls[1]?.[1]?.headers);
    expect(second.get("Authorization")).toBe("Bearer at-2");
    expect(second.get(IDEMPOTENCY_HEADER)).toBe(first.get(IDEMPOTENCY_HEADER));
    expect(mock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("si la renovación falla, lanza el 401 sin reintentar", async () => {
    setSession({ accessToken: "at-1", sessionKey: "s" });
    setRenewer(async () => null);
    const mock = sequence(unauthorized());
    const error = await failure(apiFetcher("/api/v1/x"));
    expect(error.status).toBe(401);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("un segundo 401 tras renovar no vuelve a renovar", async () => {
    setSession({ accessToken: "at-1", sessionKey: "s" });
    const renew = vi.fn(async () => "at-2");
    setRenewer(renew);
    sequence(unauthorized(), unauthorized());
    const error = await failure(apiFetcher("/api/v1/x"));
    expect(error.status).toBe(401);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
