import type { User } from "oidc-client-ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindManager, completeSignIn, type ManagerLike, toSession } from "@/lib/auth/bind";
import { getSession, renewToken, setAuthStatus, setRenewer } from "@/lib/token";

type Callback = (user?: User) => void;

function user(token: string, profile: Record<string, unknown>, expired = false): User {
  return { access_token: token, profile, expired } as unknown as User;
}

function fakeManager(stored: User | null) {
  const handlers: Record<string, Callback[]> = {};
  const on = (name: string) => (cb: Callback) => {
    handlers[name] = [...(handlers[name] ?? []), cb];
  };
  const off = (name: string) => (cb: Callback) => {
    handlers[name] = (handlers[name] ?? []).filter((item) => item !== cb);
  };
  const manager = {
    getUser: vi.fn(async () => stored),
    signinSilent: vi.fn(async () => user("at-2", { sub: "u", sid: "s-1" })),
    removeUser: vi.fn(async () => undefined),
    events: {
      addUserLoaded: on("loaded"),
      removeUserLoaded: off("loaded"),
      addUserUnloaded: on("unloaded"),
      removeUserUnloaded: off("unloaded"),
      addSilentRenewError: on("renewError"),
      removeSilentRenewError: off("renewError"),
      addAccessTokenExpired: on("expired"),
      removeAccessTokenExpired: off("expired"),
    },
  };
  const emit = (name: string, payload?: User) => {
    for (const cb of handlers[name] ?? []) cb(payload);
  };
  return { manager: manager as unknown as ManagerLike, raw: manager, emit, handlers };
}

beforeEach(() => {
  setAuthStatus("loading");
});

afterEach(() => {
  setRenewer(null);
  vi.unstubAllGlobals();
});

describe("toSession", () => {
  it("usa sid como clave y cae a sub", () => {
    expect(toSession(user("at", { sub: "u", sid: "s-1" }))).toEqual({
      accessToken: "at",
      sessionKey: "s-1",
    });
    expect(toSession(user("at", { sub: "u" }))?.sessionKey).toBe("u");
  });
});

describe("bindManager", () => {
  it("sin usuario guardado queda anonymous", async () => {
    await bindManager(fakeManager(null).manager);
    expect(getSession().status).toBe("anonymous");
  });

  it("un usuario guardado entra como authenticated con clave sid", async () => {
    await bindManager(fakeManager(user("at-1", { sub: "u", sid: "s-1" })).manager);
    expect(getSession()).toEqual({
      status: "authenticated",
      accessToken: "at-1",
      sessionKey: "s-1",
    });
  });

  it("un usuario expirado cuenta como sin sesión", async () => {
    await bindManager(fakeManager(user("at-1", { sub: "u" }, true)).manager);
    expect(getSession().status).toBe("anonymous");
  });

  it("userLoaded con otro token conserva la clave", async () => {
    const fake = fakeManager(user("at-1", { sub: "u", sid: "s-1" }));
    await bindManager(fake.manager);
    fake.emit("loaded", user("at-9", { sub: "u", sid: "s-1" }));
    expect(getSession()).toMatchObject({ accessToken: "at-9", sessionKey: "s-1" });
    fake.emit("unloaded");
    expect(getSession().status).toBe("anonymous");
  });

  it("silentRenewError borra el usuario", async () => {
    const fake = fakeManager(user("at-1", { sub: "u" }));
    await bindManager(fake.manager);
    fake.emit("renewError");
    expect(fake.raw.removeUser).toHaveBeenCalledTimes(1);
  });

  it("el renovador devuelve el token nuevo", async () => {
    await bindManager(fakeManager(user("at-1", { sub: "u" })).manager);
    expect(await renewToken()).toBe("at-2");
  });

  it("si signinSilent falla, el renovador borra y devuelve null", async () => {
    const fake = fakeManager(user("at-1", { sub: "u" }));
    fake.raw.signinSilent.mockRejectedValueOnce(new Error("invalid_grant"));
    await bindManager(fake.manager);
    expect(await renewToken()).toBeNull();
    expect(fake.raw.removeUser).toHaveBeenCalledTimes(1);
  });

  it("la función devuelta quita los suscriptores", async () => {
    const fake = fakeManager(null);
    const unbind = await bindManager(fake.manager);
    unbind();
    expect(Object.values(fake.handlers).every((list) => list.length === 0)).toBe(true);
    expect(await renewToken()).toBeNull();
  });
});

describe("completeSignIn", () => {
  it("completeSignIn canjea una sola vez y vuelve a returnTo", async () => {
    vi.stubGlobal("location", { search: "?code=a&state=1" });
    const manager = {
      signinRedirectCallback: vi.fn(async () => ({ state: { returnTo: "/simulador" } })),
    };
    const [first, second] = await Promise.all([
      completeSignIn(manager as never),
      completeSignIn(manager as never),
    ]);
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect([first, second]).toEqual(["/simulador", "/simulador"]);
  });

  it("completeSignIn sin state vuelve a /", async () => {
    vi.stubGlobal("location", { search: "?code=b&state=2" });
    const manager = { signinRedirectCallback: vi.fn(async () => ({ state: undefined })) };
    expect(await completeSignIn(manager as never)).toBe("/");
  });

  it("completeSignIn no redirige fuera del origen", async () => {
    vi.stubGlobal("location", { search: "?code=c&state=3" });
    const manager = {
      signinRedirectCallback: vi.fn(async () => ({ state: { returnTo: "//evil.example" } })),
    };
    expect(await completeSignIn(manager as never)).toBe("/");
  });
});
