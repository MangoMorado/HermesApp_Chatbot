import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearToken,
  getToken,
  getTokenPresenceServerSnapshot,
  getTokenPresenceSnapshot,
  setToken,
  subscribeTokenPresence,
} from "@/lib/token";

beforeEach(() => {
  // getToken exige `window`; en Vitest node hay sessionStorage global pero no window.
  vi.stubGlobal("window", { sessionStorage });
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("token de sesión del panel", () => {
  it("getToken lee sessionStorage cuando hay window", () => {
    expect(getToken()).toBeNull();
    setToken("jwt-1");
    expect(getToken()).toBe("jwt-1");
    expect(getTokenPresenceSnapshot()).toBe(true);
  });

  it("sin window getToken es null", () => {
    vi.stubGlobal("window", undefined);
    sessionStorage.setItem("hermes.jwt", "jwt");
    expect(getToken()).toBeNull();
  });

  it("clearToken borra y avisa a los suscriptores", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeTokenPresence(() => {
      seen.push(getTokenPresenceSnapshot());
    });
    setToken("jwt-2");
    clearToken();
    expect(getToken()).toBeNull();
    expect(seen).toEqual([true, false]);
    unsubscribe();
    setToken("jwt-3");
    expect(seen).toEqual([true, false]);
  });

  it("el snapshot de servidor siempre es false", () => {
    setToken("jwt");
    expect(getTokenPresenceServerSnapshot()).toBe(false);
  });
});
