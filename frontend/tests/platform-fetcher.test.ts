import { afterEach, describe, expect, it, vi } from "vitest";
import { platformFetcher } from "@/lib/api-fetcher";
import { setSession } from "@/lib/token";

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe("fetcher de plataforma", () => {
  it("usa el token de la sesión", async () => {
    setSession({ accessToken: "at-p", sessionKey: "s" });
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", mock);

    await platformFetcher("/api/platform/v1/tenants", { method: "POST", body: "{}" });

    const [, init] = mock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer at-p");
  });
});
