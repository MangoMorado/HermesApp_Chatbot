"use client";

import { useState } from "react";
import { updateBotConfig } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";

type RowProps = {
  readonly name: string;
  readonly value: number;
  readonly canWrite: boolean;
  readonly onSaved: () => Promise<unknown>;
};

function ParamRow({ name, value, canWrite, onSaved }: RowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  const save = () =>
    run("save", async () => {
      const body = { params: { [name]: Number(draft) } };
      await updateBotConfig(body, idempotent(`bot.param:${name}`, body));
      setDraft(null);
      await onSaved();
    });
  return (
    <div className="setting-row">
      <form
        className="controls"
        action={() => {
          save();
        }}
      >
        <Field label={name} className="field-setting">
          <input
            className="input data"
            type="number"
            inputMode="numeric"
            readOnly={!canWrite}
            value={draft ?? String(value)}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        {canWrite ? (
          <button
            type="submit"
            className="btn btn-small"
            disabled={draft === null || draft.trim() === "" || pending !== null}
          >
            Guardar
          </button>
        ) : null}
      </form>
      <ErrorBox error={error} />
    </div>
  );
}

/** Parámetros del bot. El rango de cada uno lo valida el backend (422 con el rango). */
export function BotParams({ config, canWrite, onSaved }: BotSectionProps) {
  return (
    <section className="board" aria-labelledby="bot-params-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-params-title">Parámetros</h2>
        </div>
      </div>
      <div className="board-body stack">
        {Object.entries(config.params).map(([name, value]) => (
          <ParamRow key={name} name={name} value={value} canWrite={canWrite} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}
