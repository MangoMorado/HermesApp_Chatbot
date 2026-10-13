"use client";

import { useState } from "react";
import { updateBotConfig } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";

type EffectiveText = { readonly value: string; readonly overridden: boolean };

type RowProps = {
  readonly name: string;
  readonly text: EffectiveText;
  readonly canWrite: boolean;
  readonly onSaved: () => Promise<unknown>;
};

function TextRow({ name, text, canWrite, onSaved }: RowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  /** `null` devuelve el texto a su predeterminado. */
  const patch = (value: string | null) =>
    run("save", async () => {
      const body = { texts: { [name]: value } };
      await updateBotConfig(body, idempotent(`bot.text:${name}`, body));
      setDraft(null);
      await onSaved();
    });
  return (
    <div className="setting-row">
      <Field label={name} apiKey={text.overridden ? "personalizado" : undefined}>
        <textarea
          className="input input-area"
          rows={2}
          maxLength={1000}
          readOnly={!canWrite}
          value={draft ?? text.value}
          onChange={(event) => setDraft(event.target.value)}
        />
      </Field>
      {canWrite ? (
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={draft === null || pending !== null}
            onClick={() => patch(draft)}
          >
            Guardar
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={!text.overridden || pending !== null}
            onClick={() => patch(null)}
          >
            Predeterminado
          </button>
        </div>
      ) : null}
      <ErrorBox error={error} />
    </div>
  );
}

/** Textos del bot: el valor efectivo de cada clave y si el tenant lo personalizó. */
export function BotTexts({ config, canWrite, onSaved }: BotSectionProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const all = Object.entries(config.texts);
  const rows = all.filter(
    ([name, text]) =>
      !needle || name.toLowerCase().includes(needle) || text.value.toLowerCase().includes(needle),
  );
  return (
    <section className="board" aria-labelledby="bot-texts-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-texts-title">Textos</h2>
          <p>
            {rows.length} de {all.length}
          </p>
        </div>
        <Field label="Filtrar por clave o contenido" className="field-setting">
          <input
            className="input"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </Field>
      </div>
      <div className="board-body stack">
        {rows.map(([name, text]) => (
          <TextRow key={name} name={name} text={text} canWrite={canWrite} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}
