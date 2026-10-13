"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getTenantSettings, updateTenantSettings } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { useAction } from "@/lib/use-action";
import { useToken } from "@/lib/use-session";

function useSettings() {
  const token = useToken();
  return useQuery({
    queryKey: ["tenant-settings", token?.slice(-16) ?? null],
    queryFn: () => getTenantSettings(),
    enabled: Boolean(token),
    retry: false,
  });
}

function SavedNotice({ days }: { readonly days: number }) {
  return (
    <div className="notice notice-ok" role="status">
      <span className="flap" data-tone="ok">
        GUARDADO
      </span>
      <span>
        El backend aplicó un tope de <strong className="data">{days}</strong> días.
      </span>
    </div>
  );
}

export default function AjustesPage() {
  const settings = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const { pending, error, run } = useAction();
  const current = settings.data?.max_query_range_days;
  const value = draft ?? (current === undefined ? "" : String(current));
  const days = Number.parseInt(value, 10);

  const save = () =>
    run("save", async () => {
      setSaved(null);
      const updated = await updateTenantSettings(
        { max_query_range_days: days },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setDraft(null);
      setSaved(updated.max_query_range_days);
      await settings.refetch();
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ajustes del tenant</h1>
          <p>Solo el rol admin puede guardar. El backend valida el rango permitido (1–366 días).</p>
        </div>
      </div>
      <section className="board" aria-labelledby="range-title">
        <div className="board-head">
          <h2 id="range-title">Consultas de agenda</h2>
          <ErrorBox error={error ?? settings.error} />
          {saved !== null ? <SavedNotice days={saved} /> : null}
        </div>
        <form
          className="board-body controls"
          action={() => {
            if (Number.isFinite(days)) save();
          }}
        >
          <Field
            label="Tope del rango de consulta (días)"
            apiKey="max_query_range_days"
            className="field-setting"
          >
            <input
              className="input data"
              type="number"
              inputMode="numeric"
              min={1}
              max={366}
              value={value}
              disabled={settings.isPending && settings.fetchStatus !== "idle"}
              onChange={(event) => {
                setSaved(null);
                setDraft(event.target.value);
              }}
            />
          </Field>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!Number.isFinite(days) || draft === null || pending !== null}
            aria-busy={pending !== null}
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={draft === null}
            onClick={() => setDraft(null)}
          >
            Descartar
          </button>
        </form>
      </section>
    </>
  );
}
