import { describe, expect, it, vi } from "vitest";
import { WidgetApiError } from "@/widget/fetcher";
import { createSessionManager, type SessionStorageLike, storageKey } from "@/widget/session";
import type { WidgetApi, WidgetSessionOpened, WidgetSessionRefreshed } from "@/widget/widget-api";

const NOW = Date.parse("2026-10-13T15:00:00.000Z");
const MINUTE = 60_000;
const KEY = storageKey("wk_demo");
const iso = (at: number) => new Date(at).toISOString();

function opened(token: string, expiresAt: number, secret = "secret-1"): WidgetSessionOpened {
  return {
    access_token: token,
    expires_at: iso(expiresAt),
    conversation_secret: secret,
    session_expires_at: iso(NOW + 30 * MINUTE),
  };
}

function refreshed(token: string, expiresAt: number): WidgetSessionRefreshed {
  return {
    access_token: token,
    expires_at: iso(expiresAt),
    session_expires_at: iso(NOW + 30 * MINUTE),
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: SessionStorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}

/** Sesión guardada: el token vence en `expiresAt`; la conversación, en `sessionExpiresAt`. */
function stored(
  token: string,
  expiresAt: number,
  options: { obtainedAt?: number; sessionExpiresAt?: number; secret?: string } = {},
): Record<string, string> {
  return {
    [KEY]: JSON.stringify({
      access_token: token,
      expires_at: iso(expiresAt),
      conversation_secret: options.secret ?? "saved-secret",
      session_expires_at: iso(options.sessionExpiresAt ?? NOW + 20 * MINUTE),
      obtained_at: options.obtainedAt ?? NOW - MINUTE,
    }),
  };
}

function setup(
  storage: SessionStorageLike | null,
  overrides: Partial<WidgetApi> = {},
  now: () => number = () => NOW,
) {
  const api = {
    openSession: vi.fn<WidgetApi["openSession"]>(async () => opened("opened", NOW + 5 * MINUTE)),
    refreshSession: vi.fn<WidgetApi["refreshSession"]>(async () =>
      refreshed("refreshed", NOW + 5 * MINUTE),
    ),
    getConversation: vi.fn<WidgetApi["getConversation"]>(),
    sendMessage: vi.fn<WidgetApi["sendMessage"]>(),
    ...overrides,
  };
  let keys = 0;
  const manager = createSessionManager({
    api,
    widgetKey: "wk_demo",
    storage,
    now,
    newKey: () => `key-${++keys}`,
  });
  return { api, manager };
}

const token = async (manager: ReturnType<typeof setup>["manager"]) =>
  (await manager.credentials()).accessToken;

describe("sesión del widget", () => {
  it("sin sesión guardada abre y guarda token y secreto de la conversación", async () => {
    const { data, storage } = memoryStorage();
    const { api, manager } = setup(storage);
    expect(await manager.credentials()).toEqual({
      accessToken: "opened",
      conversationSecret: "secret-1",
    });
    expect(api.openSession).toHaveBeenCalledWith("key-1");
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({
      access_token: "opened",
      conversation_secret: "secret-1",
      obtained_at: NOW,
    });
  });

  it("con token vigente lo restaura sin llamar al backend", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 4 * MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.credentials()).toEqual({
      accessToken: "saved",
      conversationSecret: "saved-secret",
    });
    expect(api.openSession).not.toHaveBeenCalled();
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("pasada la mitad de la vida del token, renueva con el secreto y conserva la conversación", async () => {
    const { data, storage } = memoryStorage(
      stored("saved", NOW + 2 * MINUTE, { obtainedAt: NOW - 3 * MINUTE }),
    );
    const { api, manager } = setup(storage);
    expect(await manager.credentials()).toEqual({
      accessToken: "refreshed",
      conversationSecret: "saved-secret",
    });
    expect(api.refreshSession).toHaveBeenCalledWith("saved-secret", "key-1");
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({
      access_token: "refreshed",
      conversation_secret: "saved-secret",
      obtained_at: NOW,
    });
  });

  it("antes de la mitad de la vida del token, no renueva", async () => {
    const { storage } = memoryStorage(
      stored("saved", NOW + 3 * MINUTE, { obtainedAt: NOW - 2 * MINUTE }),
    );
    const { api, manager } = setup(storage);
    expect(await token(manager)).toBe("saved");
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("token vencido con la conversación viva: renueva sin abrir otra", async () => {
    const { storage } = memoryStorage(stored("saved", NOW - MINUTE));
    const { api, manager } = setup(storage);
    expect(await token(manager)).toBe("refreshed");
    expect(api.openSession).not.toHaveBeenCalled();
  });

  it("a menos de un minuto del vencimiento del token renueva", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const { api, manager } = setup(storage);
    expect(await token(manager)).toBe("refreshed");
    expect(api.refreshSession).toHaveBeenCalledWith("saved-secret", "key-1");
  });

  it.each([401, 404])("si la renovación responde %i abre sesión nueva", async (status) => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(status, { error: { code: "x" } }, `HTTP ${status}`);
    });
    const { api, manager } = setup(storage, { refreshSession });
    expect(await token(manager)).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("si la renovación falla por red conserva el token aún vigente", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(0, null, "Sin conexión");
    });
    const { api, manager } = setup(storage, { refreshSession });
    expect(await token(manager)).toBe("saved");
    expect(api.openSession).not.toHaveBeenCalled();
  });

  it("si la renovación falla por red con el token ya vencido, propaga el error", async () => {
    const { storage } = memoryStorage(stored("saved", NOW - MINUTE));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(503, null, "HTTP 503");
    });
    const { api, manager } = setup(storage, { refreshSession });
    await expect(manager.credentials()).rejects.toMatchObject({ status: 503 });
    expect(api.openSession).not.toHaveBeenCalled();
  });

  it("expired: sin sesión guardada es false", () => {
    const { manager } = setup(memoryStorage().storage);
    expect(manager.expired()).toBe(false);
  });

  it("expired: con la conversación viva es false aunque el token haya vencido", () => {
    const { manager } = setup(memoryStorage(stored("saved", NOW - MINUTE)).storage);
    expect(manager.expired()).toBe(false);
  });

  it("expired: con la conversación vencida es true", () => {
    const saved = stored("saved", NOW - MINUTE, { sessionExpiresAt: NOW - 1 });
    const { manager } = setup(memoryStorage(saved).storage);
    expect(manager.expired()).toBe(true);
  });

  it("una conversación vencida (pestaña dormida) abre sesión nueva sin renovar", async () => {
    const saved = stored("saved", NOW - MINUTE, { sessionExpiresAt: NOW - 1 });
    const { api, manager } = setup(memoryStorage(saved).storage);
    expect(await token(manager)).toBe("opened");
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("el formato anterior (token de sesión sin secreto) se descarta y abre sesión nueva", async () => {
    const legacy = {
      [KEY]: JSON.stringify({ token: "old", expires_at: iso(NOW + 20 * MINUTE), obtained_at: NOW }),
    };
    const { api, manager } = setup(memoryStorage(legacy).storage);
    expect(await token(manager)).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("un valor guardado corrupto se trata como si no hubiera sesión", async () => {
    const { storage } = memoryStorage({ [KEY]: "{no es json" });
    const { manager } = setup(storage);
    expect(await token(manager)).toBe("opened");
  });

  it("sin almacenamiento la sesión vive en memoria", async () => {
    const { api, manager } = setup(null);
    expect(await token(manager)).toBe("opened");
    expect(await token(manager)).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("si el almacenamiento lanza al leer y al escribir, sigue funcionando en memoria", async () => {
    const blocked: SessionStorageLike = {
      getItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    };
    const { api, manager } = setup(blocked);
    expect(await token(manager)).toBe("opened");
    expect(await token(manager)).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(() => manager.clear()).not.toThrow();
  });

  it("dos peticiones simultáneas abren una sola sesión", async () => {
    const { api, manager } = setup(null);
    const [a, b] = await Promise.all([manager.credentials(), manager.credentials()]);
    expect(a.accessToken).toBe("opened");
    expect(b.accessToken).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("reopen descarta la sesión guardada y abre otra", async () => {
    const { data, storage } = memoryStorage(stored("saved", NOW + 4 * MINUTE));
    const { api, manager } = setup(storage);
    expect((await manager.reopen()).accessToken).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({ access_token: "opened" });
  });
});
