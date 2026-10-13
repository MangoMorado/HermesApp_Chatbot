"use client";

import { useState } from "react";
import { rotateWidgetKey } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { When } from "@/components/ui/cells";
import { embedSnippets } from "@/lib/embed-snippets";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";
import { useOrigin } from "@/lib/use-origin";

function Snippet({ title, code }: { readonly title: string; readonly code: string }) {
  return (
    <div className="stack">
      <div className="board-title">
        <h3>{title}</h3>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => navigator.clipboard?.writeText(code)}
        >
          Copiar
        </button>
      </div>
      <pre className="snippet data">{code}</pre>
    </div>
  );
}

function Snippets({
  widgetKey,
  apiBase,
}: {
  readonly widgetKey: string;
  readonly apiBase: string;
}) {
  const frontendOrigin = useOrigin();
  const snippets = embedSnippets({ frontendOrigin, apiBase, widgetKey });
  return (
    <>
      <Snippet title="Script (recomendado)" code={snippets.script} />
      <p className="hint">Añade el origen del sitio donde lo pegues a los orígenes permitidos.</p>
      <Snippet title="Iframe" code={snippets.iframe} />
      <p className="hint">
        El iframe habla con el backend desde <span className="data">{frontendOrigin}</span>: ese
        origen debe estar en los orígenes permitidos. En este modo no se controla qué sitio lo
        incrusta.
      </p>
    </>
  );
}

type Props = BotSectionProps & { readonly apiBase: string };

/** Clave pública del widget, su rotación con gracia y cómo incrustarlo. */
export function BotKeys({ config, canWrite, onSaved, apiBase }: Props) {
  const [armed, setArmed] = useState(false);
  const { pending, error, run } = useAction();
  const { current, grace } = config.widget_keys;
  const rotate = () =>
    run("rotate", async () => {
      await rotateWidgetKey(idempotent("bot.key.rotate", { from: current?.key ?? null }));
      setArmed(false);
      await onSaved();
    });
  return (
    <section className="board" aria-labelledby="bot-keys-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-keys-title">Clave del widget</h2>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-danger btn-small"
              data-armed={armed}
              disabled={pending !== null}
              onClick={() => (armed ? rotate() : setArmed(true))}
            >
              {armed ? "Confirmar rotación" : "Rotar clave"}
            </button>
          ) : null}
        </div>
        <ErrorBox error={error} />
      </div>
      <div className="board-body stack">
        {current ? (
          <p>
            Vigente: <span className="data">{current.key}</span>
          </p>
        ) : (
          <p className="hint">Este tenant no tiene clave vigente.</p>
        )}
        {grace ? (
          <p className="hint">
            Clave anterior en gracia: <span className="data">{grace.key}</span>, válida hasta{" "}
            <When value={grace.grace_until} />. Los sitios que aún la usan siguen funcionando hasta
            entonces.
          </p>
        ) : null}
        {current ? <Snippets widgetKey={current.key} apiBase={apiBase} /> : null}
      </div>
    </section>
  );
}
