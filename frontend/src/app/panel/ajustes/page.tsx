"use client";

import { useState } from "react";
import { getTenantSettings, updateTenantSettings } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";

export default function AjustesPage() {
  const [days, setDays] = useState(31);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function load() {
    setError(null);
    try {
      const settings = await getTenantSettings();
      setDays(settings.max_query_range_days);
    } catch (err) {
      setError(err);
    }
  }

  async function save() {
    setError(null);
    setMessage(null);
    try {
      const updated = await updateTenantSettings(
        { max_query_range_days: days },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setDays(updated.max_query_range_days);
      setMessage("Guardado");
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="panel">
      <h1>Ajustes del tenant</h1>
      <p className="muted">Solo rol admin. El backend valida el rango 1–366.</p>
      <ErrorBox error={error} />
      {message ? <p>{message}</p> : null}
      <div className="stack">
        <label>
          max_query_range_days
          <input
            type="number"
            min={1}
            max={366}
            value={days}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(next)) {
                setDays(next);
              }
            }}
          />
        </label>
        <div className="row">
          <button type="button" onClick={load}>
            Cargar
          </button>
          <button type="button" onClick={save}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
