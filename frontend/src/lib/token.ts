/**
 * Sesión de la consola en memoria. La alimenta el adaptador OIDC (`lib/auth/`); aquí no se
 * persiste nada ni se conoce al proveedor. `apiFetcher` y los hooks solo leen de este almacén.
 */
export type AuthStatus = "unconfigured" | "loading" | "anonymous" | "authenticated";

export type SessionSnapshot = {
  readonly status: AuthStatus;
  readonly accessToken: string | null;
  /** Estable mientras dura la sesión del proveedor (no cambia al renovar el token). */
  readonly sessionKey: string | null;
};

export const SERVER_SNAPSHOT: SessionSnapshot = {
  status: "loading",
  accessToken: null,
  sessionKey: null,
};

let current: SessionSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function publish(next: SessionSnapshot): void {
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSession(): SessionSnapshot {
  return current;
}

export function getToken(): string | null {
  return current.accessToken;
}

export function setSession(session: { accessToken: string; sessionKey: string } | null): void {
  publish(
    session
      ? { status: "authenticated", ...session }
      : { status: "anonymous", accessToken: null, sessionKey: null },
  );
}

export function setAuthStatus(status: "unconfigured" | "loading"): void {
  publish({ status, accessToken: null, sessionKey: null });
}

let renewer: (() => Promise<string | null>) | null = null;
let inFlight: Promise<string | null> | null = null;

export function setRenewer(renew: (() => Promise<string | null>) | null): void {
  renewer = renew;
}

/** Una sola renovación en vuelo: varios `401` simultáneos esperan la misma. */
export function renewToken(): Promise<string | null> {
  if (!renewer) {
    return Promise.resolve(null);
  }
  inFlight ??= renewer().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
