"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { getIdentity } from "@/api/default/default";
import { getToken, subscribeTokenPresence } from "./token";

/** Token pegado en la barra de sesión, reactivo a guardar/borrar. */
export function useToken(): string | null {
  return useSyncExternalStore(subscribeTokenPresence, getToken, () => null);
}

/**
 * Identidad que el backend resolvió del JWT (`/me`). El frontend no decodifica
 * el token: muestra lo que el backend confirma.
 */
export function useIdentity() {
  const token = useToken();
  return useQuery({
    // El sufijo del token distingue sesiones sin guardar el JWT completo en la caché.
    queryKey: ["identity", token?.slice(-16) ?? null],
    queryFn: () => getIdentity(),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });
}
