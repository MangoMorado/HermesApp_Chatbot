import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSession,
  getToken,
  renewToken,
  SERVER_SNAPSHOT,
  setAuthStatus,
  setRenewer,
  setSession,
  subscribeSession,
} from "@/lib/token";

afterEach(() => {
  setRenewer(null);
  setAuthStatus("loading");
});

describe("almacén de sesión de la consola", () => {
  it("sin sesión el estado es anonymous y no hay token", () => {
    setSession(null);
    expect(getSession()).toEqual({ status: "anonymous", accessToken: null, sessionKey: null });
    expect(getToken()).toBeNull();
  });

  it("setSession publica token y clave, y avisa", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    setSession({ accessToken: "at-1", sessionKey: "sid-1" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getToken()).toBe("at-1");
    expect(getSession()).toEqual({
      status: "authenticated",
      accessToken: "at-1",
      sessionKey: "sid-1",
    });
    unsubscribe();
    setSession(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("getSession conserva la referencia si nada cambia", () => {
    setSession({ accessToken: "at-1", sessionKey: "sid-1" });
    expect(getSession()).toBe(getSession());
  });

  it("renovar con la misma sesión cambia el token pero no la clave", () => {
    setSession({ accessToken: "at-1", sessionKey: "sid-1" });
    setSession({ accessToken: "at-2", sessionKey: "sid-1" });
    expect(getSession().sessionKey).toBe("sid-1");
    expect(getToken()).toBe("at-2");
  });

  it("setAuthStatus fija loading o unconfigured sin token", () => {
    setSession({ accessToken: "at-1", sessionKey: "sid-1" });
    setAuthStatus("unconfigured");
    expect(getSession()).toEqual({ status: "unconfigured", accessToken: null, sessionKey: null });
  });

  it("el snapshot de servidor está cargando y sin token", () => {
    expect(SERVER_SNAPSHOT).toEqual({ status: "loading", accessToken: null, sessionKey: null });
  });
});

describe("renovación ante 401", () => {
  it("renewToken comparte una sola renovación", async () => {
    const renew = vi.fn(async () => {
      await Promise.resolve();
      return "at-2";
    });
    setRenewer(renew);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => renewToken()));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["at-2", "at-2", "at-2", "at-2", "at-2"]);
    await renewToken();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("renewToken sin renovador devuelve null", async () => {
    expect(await renewToken()).toBeNull();
  });
});
