"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { getIdentity } from "@/api/default/default";
import { getPlatformIdentity } from "@/platform/default/default";
import { resolveIdentity, type SessionIdentity } from "./identity";
import { type AuthStatus, getSession, SERVER_SNAPSHOT, subscribeSession } from "./token";

function useSessionSnapshot() {
  return useSyncExternalStore(subscribeSession, getSession, () => SERVER_SNAPSHOT);
}

/** Access token vigente de la sesión del proveedor (cambia al renovarse). */
export function useToken(): string | null {
  return useSessionSnapshot().accessToken;
}

/** Clave estable de la sesión: va en las `queryKey` para que renovar no vacíe la caché. */
export function useSessionKey(): string | null {
  return useSessionSnapshot().sessionKey;
}

export function useAuthStatus(): AuthStatus {
  return useSessionSnapshot().status;
}

/**
 * Identidad que el backend resolvió del JWT (`/api/v1/me` o `/api/platform/v1/me`). El
 * frontend no decodifica el token: muestra lo que el backend confirma.
 */
export function useIdentity() {
  const token = useToken();
  const sessionKey = useSessionKey();
  return useQuery<SessionIdentity>({
    queryKey: ["identity", sessionKey],
    queryFn: () => resolveIdentity(getIdentity, getPlatformIdentity),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });
}
