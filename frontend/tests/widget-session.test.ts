import { describe, expect, it, vi } from "vitest";
import { WidgetApiError } from "@/widget/fetcher";
import { createSessionManager, type SessionStorageLike, storageKey } from "@/widget/session";
import type { WidgetApi, WidgetSession } from "@/widget/widget-api";

const NOW = Date.parse("2026-10-13T15:00:00.000Z");
const MINUTE = 60_000;
const KEY = storageKey("wk_demo");

function session(token: string, expiresAt: number): WidgetSession {
  return { session_id: "s1", token, expires_at: new Date(expiresAt).toISOString() };
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

function stored(token: string, expiresAt: number): Record<string, string> {
  return { [KEY]: JSON.stringify({ token, expires_at: new Date(expiresAt).toISOString() }) };
}

function setup(storage: SessionStorageLike | null, overrides: Partial<WidgetApi> = {}) {
  const api = {
    openSession: vi.fn<WidgetApi["openSession"]>(async () => session("opened", NOW + 30 * MINUTE)),
    refreshSession: vi.fn<WidgetApi["refreshSession"]>(async () =>
      session("refreshed", NOW + 30 * MINUTE),
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
    now: () => NOW,
    newKey: () => `key-${++keys}`,
  });
  return { api, manager };
}

describe("sesión del widget", () => {
  it("sin token guardado abre sesión y la guarda", async () => {
    const { data, storage } = memoryStorage();
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledWith("key-1");
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({ token: "opened" });
  });

  it("con token vigente lo restaura sin llamar al backend", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 20 * MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("saved");
    expect(api.openSession).not.toHaveBeenCalled();
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("a menos de un minuto del vencimiento renueva", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("refreshed");
    expect(api.refreshSession).toHaveBeenCalledWith("saved", "key-1");
  });

  it("si la renovación responde 401 abre sesión nueva", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(401, { error: { code: "unauthorized" } }, "HTTP 401");
    });
    const { api, manager } = setup(storage, { refreshSession });
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("si la renovación falla por red conserva el token aún vigente", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(0, null, "Sin conexión");
    });
    const { api, manager } = setup(storage, { refreshSession });
    expect(await manager.token()).toBe("saved");
    expect(api.openSession).not.toHaveBeenCalled();
  });

  it("un token ya vencido (pestaña dormida) abre sesión nueva sin renovar", async () => {
    const { storage } = memoryStorage(stored("saved", NOW - MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("opened");
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("un valor guardado corrupto se trata como si no hubiera sesión", async () => {
    const { storage } = memoryStorage({ [KEY]: "{no es json" });
    const { manager } = setup(storage);
    expect(await manager.token()).toBe("opened");
  });

  it("sin almacenamiento la sesión vive en memoria", async () => {
    const { api, manager } = setup(null);
    expect(await manager.token()).toBe("opened");
    expect(await manager.token()).toBe("opened");
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
    expect(await manager.token()).toBe("opened");
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(() => manager.clear()).not.toThrow();
  });

  it("dos peticiones de token simultáneas abren una sola sesión", async () => {
    const { api, manager } = setup(null);
    const [a, b] = await Promise.all([manager.token(), manager.token()]);
    expect(a).toBe("opened");
    expect(b).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("reopen descarta la sesión guardada y abre otra", async () => {
    const { data, storage } = memoryStorage(stored("saved", NOW + 20 * MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.reopen()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({ token: "opened" });
  });
});
