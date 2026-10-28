"use client";

import { useState } from "react";
import { addAllowedOrigin, removeAllowedOrigin } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";

/** Sitios desde los que el widget puede abrir sesión. Alta y baja de uno en uno. */
export function BotOrigins({ config, canWrite, onSaved }: BotSectionProps) {
  const [draft, setDraft] = useState("");
  const { pending, error, run } = useAction();
  const add = () =>
    run("add", async () => {
      const body = { origin: draft.trim() };
      await addAllowedOrigin(body, idempotent("bot.origin.add", body));
      setDraft("");
      await onSaved();
    });
  const remove = (origin: string) =>
    run(`remove:${origin}`, async () => {
      // El origen viaja en la ruta: va codificado, como pide el contrato.
      const scope = `bot.origin.remove:${origin}`;
      await removeAllowedOrigin(encodeURIComponent(origin), idempotent(scope, {}));
      await onSaved();
    });
  return (
    <section className="board" aria-labelledby="bot-origins-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-origins-title">Orígenes permitidos</h2>
          <p>{config.allowed_origins.length} registrados</p>
        </div>
        <ErrorBox error={error} />
      </div>
      <div className="board-body stack">
        {config.allowed_origins.length === 0 ? (
          <p className="hint">Sin orígenes: ningún sitio puede abrir el chat de este tenant.</p>
        ) : (
          <ul className="origin-list">
            {config.allowed_origins.map((origin) => (
              <li key={origin}>
                <span className="data">{origin}</span>
                {canWrite ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={pending !== null}
                    onClick={() => remove(origin)}
                  >
                    Quitar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form
            className="controls"
            action={() => {
              void add();
            }}
          >
            <Field label="Origen nuevo" apiKey="origin" className="field-wide">
              <input
                className="input data"
                aria-label="Origen nuevo"
                placeholder="https://www.clinica.co"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!draft.trim() || pending !== null}
            >
              Añadir
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
