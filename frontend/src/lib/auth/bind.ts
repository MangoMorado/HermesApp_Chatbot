import type { User, UserManager } from "oidc-client-ts";
import { setRenewer, setSession } from "@/lib/token";

export type ManagerLike = Pick<UserManager, "getUser" | "signinSilent" | "removeUser" | "events">;

/** Sesión que ve la consola. La clave es el `sid` del proveedor: no cambia al renovar. */
export function toSession(user: User | null): { accessToken: string; sessionKey: string } | null {
  if (!user || user.expired) {
    return null;
  }
  return {
    accessToken: user.access_token,
    sessionKey: String(user.profile.sid ?? user.profile.sub),
  };
}

function renewerFor(manager: ManagerLike): () => Promise<string | null> {
  return async () => {
    try {
      const user = await manager.signinSilent();
      return user?.access_token ?? null;
    } catch {
      await manager.removeUser();
      return null;
    }
  };
}

/** Conecta el `UserManager` con el almacén de sesión. Devuelve la función que lo desconecta. */
export async function bindManager(manager: ManagerLike): Promise<() => void> {
  const onLoaded = (user: User) => setSession(toSession(user));
  const onUnloaded = () => setSession(null);
  const drop = () => {
    void manager.removeUser();
  };
  const { events } = manager;
  events.addUserLoaded(onLoaded);
  events.addUserUnloaded(onUnloaded);
  events.addSilentRenewError(drop);
  events.addAccessTokenExpired(drop);
  setRenewer(renewerFor(manager));
  setSession(toSession(await manager.getUser()));
  return () => {
    events.removeUserLoaded(onLoaded);
    events.removeUserUnloaded(onUnloaded);
    events.removeSilentRenewError(drop);
    events.removeAccessTokenExpired(drop);
    setRenewer(null);
  };
}

const exchanges = new Map<string, Promise<string>>();

function returnTo(state: unknown): string {
  const target = (state as { returnTo?: unknown } | undefined)?.returnTo;
  // Solo rutas propias: `//otro.dominio` sería una redirección abierta.
  const local = typeof target === "string" && /^\/(?![/\\])/.test(target);
  return local ? target : "/";
}

/**
 * Canje del `code` de vuelta del proveedor. Memoizado por URL: el modo estricto de React monta
 * dos veces la página y un segundo canje fallaría con `invalid_grant`.
 */
export function completeSignIn(
  manager: Pick<UserManager, "signinRedirectCallback">,
): Promise<string> {
  const key = location.search;
  let exchange = exchanges.get(key);
  if (!exchange) {
    exchange = manager.signinRedirectCallback().then((user) => returnTo(user.state));
    exchanges.set(key, exchange);
  }
  return exchange;
}
