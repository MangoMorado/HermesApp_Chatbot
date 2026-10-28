"use client";

import { ErrorBox } from "@/components/error-box";
import { useBotConfig } from "@/lib/use-bot-config";
import { useIdentity, useToken } from "@/lib/use-session";
import { BotKeys } from "./bot-keys";
import { BotOrigins } from "./bot-origins";
import { BotParams } from "./bot-params";
import { BotTexts } from "./bot-texts";

/** Configuración del bot en cuatro tableros sobre un solo `GET /bot-config`. */
export function BotConfigScreen({ apiBase }: { readonly apiBase: string }) {
  const token = useToken();
  const config = useBotConfig();
  const identity = useIdentity();
  if (!token) {
    return (
      <div className="empty">
        <strong>Sin sesión</strong>
        <span>
          Inicia sesión en la franja de sesión (tecla 0) para ver la configuración del bot.
        </span>
      </div>
    );
  }
  if (config.isError) {
    return <ErrorBox error={config.error} />;
  }
  if (!config.data) {
    return <p className="hint">Cargando la configuración…</p>;
  }
  const section = {
    config: config.data,
    canWrite: identity.data?.role === "admin",
    onSaved: () => config.refetch(),
  };
  return (
    <div className="column">
      <BotKeys {...section} apiBase={apiBase} />
      <BotOrigins {...section} />
      <BotParams {...section} />
      <BotTexts {...section} />
    </div>
  );
}
