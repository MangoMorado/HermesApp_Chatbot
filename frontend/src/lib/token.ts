const TOKEN_KEY = "hermes.jwt";

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getClientSnapshot(): boolean {
  return Boolean(sessionStorage.getItem(TOKEN_KEY));
}

function getServerSnapshot(): boolean {
  return false;
}

/** Lectura reactiva del token en sessionStorage (Fase 2; cookies en Fase 3). */
export function subscribeTokenPresence(listener: () => void): () => void {
  return subscribe(listener);
}

export function getTokenPresenceSnapshot(): boolean {
  return getClientSnapshot();
}

export function getTokenPresenceServerSnapshot(): boolean {
  return getServerSnapshot();
}

export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  emit();
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  emit();
}
