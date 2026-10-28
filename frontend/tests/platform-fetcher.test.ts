import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { platformFetcher } from "@/lib/api-fetcher";

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("fetcher de plataforma", () => {
  it("manda el secreto que le pasan y no el JWT de la sesión", async () => {
    sessionStorage.setItem("hermes.jwt", "jwt-de-sesion");
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", mock);

    await platformFetcher("/api/platform/v1/tenants", {
      method: "POST",
      headers: { Authorization: "Bearer secreto-de-plataforma" },
    });

    const [, init] = mock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secreto-de-plataforma");
  });
});
