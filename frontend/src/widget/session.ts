import { WidgetApiError } from "./fetcher";
import type { WidgetApi, WidgetSession } from "./widget-api";

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredSession = {
  readonly token: string;
  readonly expiresAt: number;
  /** `null` en sesiones guardadas con el formato anterior. */
  readonly obtainedAt: number | null;
};

/** Se renueva a la mitad de la vida del token o, como mínimo, con menos de un minuto restante. */
export const REFRESH_MARGIN_MS = 60_000;

export function storageKey(widgetKey: string): string {
  return `ingenius.widget.${widgetKey}`;
}

/** `sessionStorage` si el navegador deja usarlo; en un iframe con almacenamiento bloqueado, `null`. */
export function browserStorage(): SessionStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearStoredSession(widgetKey: string, storage: SessionStorageLike | null): void {
  try {
    storage?.removeItem(storageKey(widgetKey));
  } catch {
    // Almacenamiento bloqueado: no hay nada que borrar.
  }
}

function parseStored(raw: string | null): StoredSession | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as {
      token?: unknown;
      expires_at?: unknown;
      obtained_at?: unknown;
    } | null;
    const expiresAt =
      typeof value?.expires_at === "string" ? Date.parse(value.expires_at) : Number.NaN;
    return typeof value?.token === "string" && Number.isFinite(expiresAt)
      ? {
          token: value.token,
          expiresAt,
          obtainedAt: typeof value.obtained_at === "number" ? value.obtained_at : null,
        }
      : null;
  } catch {
    return null;
  }
}

/** Guarda en el almacenamiento y en memoria: si el primero falla, la sesión no se pierde. */
function createStore(widgetKey: string, storage: SessionStorageLike | null, now: () => number) {
  const key = storageKey(widgetKey);
  let memory: string | null = null;
  return {
    read(): StoredSession | null {
      try {
        return parseStored(storage?.getItem(key) ?? memory);
      } catch {
        return parseStored(memory);
      }
    },
    write(session: WidgetSession): void {
      memory = JSON.stringify({
        token: session.token,
        expires_at: session.expires_at,
        obtained_at: now(),
      });
      try {
        storage?.setItem(key, memory);
      } catch {
        // Queda en memoria: funciona, pero no sobrevive a la recarga.
      }
    },
    clear(): void {
      memory = null;
      clearStoredSession(widgetKey, storage);
    },
  };
}

export type SessionDeps = {
  readonly api: WidgetApi;
  readonly widgetKey: string;
  readonly storage: SessionStorageLike | null;
  readonly now: () => number;
  readonly newKey: () => string;
};

export type SessionManager = {
  /** Token vigente: restaura, renueva o abre sesión según haga falta. */
  token(): Promise<string>;
  /** Descarta la sesión guardada y abre una nueva (tras un `401`). */
  reopen(): Promise<string>;
  /** `true` si hay sesión guardada y ya venció (se trata como un `401`). */
  expired(): boolean;
  clear(): void;
};

export function createSessionManager(deps: SessionDeps): SessionManager {
  const store = createStore(deps.widgetKey, deps.storage, deps.now);
  let inFlight: Promise<string> | null = null;

  async function open(): Promise<string> {
    const session = await deps.api.openSession(deps.newKey());
    store.write(session);
    return session.token;
  }

  async function refresh(current: StoredSession): Promise<string> {
    try {
      const session = await deps.api.refreshSession(current.token, deps.newKey());
      store.write(session);
      return session.token;
    } catch (error) {
      if (error instanceof WidgetApiError && error.status === 401) {
        return open();
      }
      // Fallo pasajero: el token actual sigue sirviendo hasta que venza.
      return current.token;
    }
  }

  function needsRefresh(current: StoredSession, now: number): boolean {
    const remaining = current.expiresAt - now;
    if (remaining < REFRESH_MARGIN_MS) {
      return true;
    }
    return (
      current.obtainedAt !== null &&
      now - current.obtainedAt >= (current.expiresAt - current.obtainedAt) / 2
    );
  }

  function resolve(): Promise<string> {
    const current = store.read();
    const now = deps.now();
    if (!current || current.expiresAt - now <= 0) {
      return open();
    }
    return needsRefresh(current, now) ? refresh(current) : Promise.resolve(current.token);
  }

  /** Varias llamadas a la vez comparten una sola apertura o renovación. */
  function once(task: () => Promise<string>): Promise<string> {
    inFlight ??= task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    token: () => once(resolve),
    reopen: () =>
      once(() => {
        store.clear();
        return open();
      }),
    expired() {
      const current = store.read();
      return current !== null && current.expiresAt - deps.now() <= 0;
    },
    clear: () => store.clear(),
  };
}
