"use client";

import { UserManager } from "oidc-client-ts";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { setAuthStatus } from "@/lib/token";
import { bindManager } from "./bind";
import { buildSettings, type OidcConfig } from "./settings";

type AuthActions = {
  readonly manager: UserManager | null;
  readonly signIn: () => Promise<void>;
  readonly signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthActions>({
  manager: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
});

function useManager(config: OidcConfig | null): UserManager | null {
  const [manager, setManager] = useState<UserManager | null>(null);
  const issuer = config?.issuer;
  const clientId = config?.clientId;
  useEffect(() => {
    if (!issuer || !clientId) {
      setAuthStatus("unconfigured");
      return;
    }
    const created = new UserManager(
      buildSettings({ issuer, clientId }, window.location.origin, window.sessionStorage),
    );
    setManager(created);
    let unbind: (() => void) | null = null;
    let active = true;
    void bindManager(created).then((release) => {
      if (active) {
        unbind = release;
      } else {
        release();
      }
    });
    return () => {
      active = false;
      unbind?.();
      created.stopSilentRenew();
    };
  }, [issuer, clientId]);
  return manager;
}

/**
 * Sesión OIDC de la consola. No bloquea a los hijos: `/chat` carga sin sesión y el resto de
 * pantallas leen el estado del almacén (`useAuthStatus`).
 */
export function AuthProvider({
  config,
  children,
}: {
  readonly config: OidcConfig | null;
  readonly children: ReactNode;
}) {
  const manager = useManager(config);
  const actions = useMemo<AuthActions>(
    () => ({
      manager,
      signIn: async () => {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        await manager?.signinRedirect({ state: { returnTo } });
      },
      signOut: async () => {
        await manager?.signoutRedirect();
      },
    }),
    [manager],
  );
  return <AuthContext.Provider value={actions}>{children}</AuthContext.Provider>;
}

export function useAuthActions(): AuthActions {
  return useContext(AuthContext);
}
