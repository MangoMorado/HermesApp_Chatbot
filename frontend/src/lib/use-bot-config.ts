"use client";

import { useQuery } from "@tanstack/react-query";
import { getBotConfig } from "@/api/default/default";
import type { BotConfig } from "@/api/models";
import { useToken } from "./use-session";

/** Lo que recibe cada tablero de la configuración del bot. */
export type BotSectionProps = {
  readonly config: BotConfig;
  /** Solo `admin` escribe; con `operator` los controles de escritura no se muestran. */
  readonly canWrite: boolean;
  /** Recarga la configuración tras una escritura. */
  readonly onSaved: () => Promise<unknown>;
};

/** Configuración efectiva del bot del tenant de la sesión del panel. */
export function useBotConfig() {
  const token = useToken();
  return useQuery({
    queryKey: ["bot-config", token?.slice(-16) ?? null],
    queryFn: () => getBotConfig(),
    enabled: Boolean(token),
    retry: false,
  });
}
