import { describe, expect, it } from "vitest";
import { forward, targetUrl } from "@/lib/backend-proxy";

const BASE = "http://backend:3001";

describe("proxy al backend", () => {
  it("arma la URL bajo /api/ conservando el query string", () => {
    expect(targetUrl(BASE, ["v1", "schedules"], "?limit=5")?.toString()).toBe(
      "http://backend:3001/api/v1/schedules?limit=5",
    );
  });

  it("no deja salir de /api/ ni cambiar de host", () => {
    expect(targetUrl(BASE, ["..", "..", "etc"], "")).toBeNull();
    expect(targetUrl(BASE, ["//evil.test", "x"], "")?.origin).toBe("http://backend:3001");
  });

  it("un camino que sale de /api/ responde 404 sin llamar al backend", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response(null);
    }) as unknown as typeof fetch;
    const response = await forward(
      new Request("http://front/api/x"),
      BASE,
      ["..", "admin"],
      fakeFetch,
    );
    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });

  it("reenvía solo las cabeceras permitidas y devuelve la respuesta tal cual", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      seen = { url: url.toString(), init };
      return new Response('{"ok":true}', {
        status: 201,
        headers: { "content-type": "application/json", "x-request-id": "r-1", "set-cookie": "a=b" },
      });
    }) as unknown as typeof fetch;

    const request = new Request("http://front/api/v1/tenant-settings", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer t",
        "Idempotency-Key": "k-1",
        Cookie: "secreta=1",
      },
      body: '{"max_query_range_days":10}',
    });
    const response = await forward(request, BASE, ["v1", "tenant-settings"], fakeFetch);

    expect(seen).not.toBeNull();
    const sent = seen as unknown as { url: string; init: RequestInit };
    const headers = new Headers(sent.init.headers);
    expect(sent.url).toBe("http://backend:3001/api/v1/tenant-settings");
    expect(headers.get("authorization")).toBe("Bearer t");
    expect(headers.get("idempotency-key")).toBe("k-1");
    expect(headers.get("cookie")).toBeNull();
    expect(new TextDecoder().decode(sent.init.body as ArrayBuffer)).toBe(
      '{"max_query_range_days":10}',
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("r-1");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });
});
