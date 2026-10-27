import { WidgetApiError } from "./fetcher";
import type { WidgetApi, WidgetCredentials } from "./widget-api";

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredSession = {
  readonly accessToken: string;
  /** Vence el token del proveedor. */
  readonly expiresAt: number;
  readonly conversationSecret: string;
  /** Vence la conversación (TTL del tenant); el token se renueva mientras siga viva. */
  readonly sessionExpiresAt: number;
  readonly obtainedAt: number;
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

function instant(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

/** El formato anterior (token propio con `session_id`, sin secreto) se descarta: `null`. */
function parseStored(raw: string | null): StoredSession | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    const session = {
      accessToken: value?.access_token,
      expiresAt: instant(value?.expires_at),
      conversationSecret: value?.conversation_secret,
      sessionExpiresAt: instant(value?.session_expires_at),
      obtainedAt: value?.obtained_at,
    };
    const valid =
      typeof session.accessToken === "string" &&
      typeof session.conversationSecret === "string" &&
      typeof session.obtainedAt === "number" &&
      Number.isFinite(session.expiresAt) &&
      Number.isFinite(session.sessionExpiresAt);
    return valid ? (session as StoredSession) : null;
  } catch {
    return null;
  }
}

function serialize(session: StoredSession): string {
  return JSON.stringify({
    access_token: session.accessToken,
    expires_at: new Date(session.expiresAt).toISOString(),
    conversation_secret: session.conversationSecret,
    session_expires_at: new Date(session.sessionExpiresAt).toISOString(),
    obtained_at: session.obtainedAt,
  });
}

/** Guarda en el almacenamiento y en memoria: si el primero falla, la sesión no se pierde. */
function createStore(widgetKey: string, storage: SessionStorageLike | null) {
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
    write(session: StoredSession): void {
      memory = serialize(session);
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

function credentialsOf(session: StoredSession): WidgetCredentials {
  return { accessToken: session.accessToken, conversationSecret: session.conversationSecret };
}

/** Un `401` (clave) o `404` (conversación vencida o desconocida): hay que abrir otra. */
function conversationLost(error: unknown): boolean {
  return error instanceof WidgetApiError && (error.status === 401 || error.status === 404);
}

export type SessionDeps = {
  readonly api: WidgetApi;
  readonly widgetKey: string;
  readonly storage: SessionStorageLike | null;
  readonly now: () => number;
  readonly newKey: () => string;
};

export type SessionManager = {
  /** Credenciales vigentes: restaura, renueva el token o abre conversación según haga falta. */
  credentials(): Promise<WidgetCredentials>;
  /** Descarta la sesión guardada y abre una nueva (tras un `401` o `404`). */
  reopen(): Promise<WidgetCredentials>;
  /** `true` si hay conversación guardada y ya venció (se trata como un `404`). */
  expired(): boolean;
  clear(): void;
};

export function createSessionManager(deps: SessionDeps): SessionManager {
  const store = createStore(deps.widgetKey, deps.storage);
  let inFlight: Promise<WidgetCredentials> | null = null;

  async function open(): Promise<WidgetCredentials> {
    const opened = await deps.api.openSession(deps.newKey());
    const session: StoredSession = {
      accessToken: opened.access_token,
      expiresAt: Date.parse(opened.expires_at),
      conversationSecret: opened.conversation_secret,
      sessionExpiresAt: Date.parse(opened.session_expires_at),
      obtainedAt: deps.now(),
    };
    store.write(session);
    return credentialsOf(session);
  }

  async function refresh(current: StoredSession): Promise<WidgetCredentials> {
    try {
      const renewed = await deps.api.refreshSession(current.conversationSecret, deps.newKey());
      const session: StoredSession = {
        ...current,
        accessToken: renewed.access_token,
        expiresAt: Date.parse(renewed.expires_at),
        sessionExpiresAt: Date.parse(renewed.session_expires_at),
        obtainedAt: deps.now(),
      };
      store.write(session);
      return credentialsOf(session);
    } catch (error) {
      if (conversationLost(error)) {
        return open();
      }
      // Fallo pasajero: el token actual sirve mientras no venza; vencido, se reintenta luego.
      if (current.expiresAt - deps.now() > 0) {
        return credentialsOf(current);
      }
      throw error;
    }
  }

  function needsRefresh(current: StoredSession, now: number): boolean {
    if (current.expiresAt - now < REFRESH_MARGIN_MS) {
      return true;
    }
    return now - current.obtainedAt >= (current.expiresAt - current.obtainedAt) / 2;
  }

  function resolve(): Promise<WidgetCredentials> {
    const current = store.read();
    const now = deps.now();
    if (!current || current.sessionExpiresAt - now <= 0) {
      return open();
    }
    return needsRefresh(current, now) ? refresh(current) : Promise.resolve(credentialsOf(current));
  }

  /** Varias llamadas a la vez comparten una sola apertura o renovación. */
  function once(task: () => Promise<WidgetCredentials>): Promise<WidgetCredentials> {
    inFlight ??= task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    credentials: () => once(resolve),
    reopen: () =>
      once(() => {
        store.clear();
        return open();
      }),
    expired() {
      const current = store.read();
      return current !== null && current.sessionExpiresAt - deps.now() <= 0;
    },
    clear: () => store.clear(),
  };
}
