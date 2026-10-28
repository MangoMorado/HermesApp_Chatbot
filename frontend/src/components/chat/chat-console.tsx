"use client";

import { useState } from "react";
import { addAllowedOrigin } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { useBotConfig } from "@/lib/use-bot-config";
import { useOrigin } from "@/lib/use-origin";
import { useIdentity } from "@/lib/use-session";
import { ChatWidget } from "@/widget/chat-widget";
import { browserStorage, clearStoredSession } from "@/widget/session";

type OriginProps = {
  readonly origin: string;
  /** Orígenes del tenant; `undefined` si no hay sesión de panel con la que consultarlos. */
  readonly allowed: readonly string[] | undefined;
  readonly canAdd: boolean;
  readonly onAdded: () => Promise<void>;
};

/** Aviso (no decisión): quien admite o rechaza el origen es el backend al abrir la sesión. */
function OriginNotice({ origin, allowed, canAdd, onAdded }: OriginProps) {
  const { pending, error, run } = useAction();
  if (!origin || !allowed || allowed.includes(origin.toLowerCase())) {
    return null;
  }
  const add = () =>
    run("add", async () => {
      const body = { origin };
      await addAllowedOrigin(body, idempotent("bot.origin.add", body));
      await onAdded();
    });
  return (
    <div className="form-block">
      <h3>Origen sin registrar</h3>
      <p className="hint">
        <span className="data">{origin}</span> no está en los orígenes permitidos del tenant: el
        backend rechazará la sesión del chat.
      </p>
      {canAdd ? (
        <div className="form-actions">
          <button type="button" className="btn" disabled={pending !== null} onClick={add}>
            Añadir este origen
          </button>
        </div>
      ) : (
        <p className="hint">Un admin puede añadirlo en la pantalla Bot.</p>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

/** Consola de pruebas: el mismo widget y el mismo camino CORS que el sitio de un tenant. */
export function ChatConsole({ apiBase }: { readonly apiBase: string }) {
  const config = useBotConfig();
  const identity = useIdentity();
  const origin = useOrigin();
  const [draft, setDraft] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const current = config.data?.widget_keys.current?.key ?? "";
  const widgetKey = (applied ?? current).trim();
  const typed = draft ?? applied ?? current;

  const restart = (key: string) => {
    clearStoredSession(key.trim(), browserStorage());
    setApplied(key);
    setDraft(null);
    setRun((n) => n + 1);
  };

  return (
    <div className="crud">
      <div className="crud-forms">
        <form className="form-block" action={() => restart(typed)}>
          <h3>Clave del widget</h3>
          <Field label="Clave" apiKey="widget_key">
            <input
              className="input data"
              autoComplete="off"
              value={typed}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <p className="hint">
            {current
              ? "Se propone la clave vigente del tenant de la sesión. Puedes pegar otra."
              : "Sin sesión de panel: pega la clave pública de un widget."}
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!typed.trim()}>
              Nueva sesión
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={applied === null && draft === null}
              onClick={() => restart(current)}
            >
              Usar la vigente
            </button>
          </div>
          <ErrorBox error={config.error} />
        </form>
        <OriginNotice
          origin={origin}
          allowed={config.data?.allowed_origins}
          canAdd={identity.data?.role === "admin"}
          onAdded={async () => {
            await config.refetch();
            setRun((n) => n + 1);
          }}
        />
        <p className="hint">
          Backend del chat: <span className="data">{apiBase}</span>
        </p>
      </div>
      <section className="board chat-stage" aria-label="Widget del chat">
        {widgetKey ? (
          <ChatWidget
            key={`${widgetKey}:${run}`}
            apiBase={apiBase}
            widgetKey={widgetKey}
            mode="fill"
          />
        ) : (
          <div className="empty">
            <strong>Sin clave de widget</strong>
            <span>Pega una clave o inicia sesión de panel para usar la vigente.</span>
          </div>
        )}
      </section>
    </div>
  );
}
