"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import {
  createSimPractitioner,
  generateSimSlots,
  listSimPractitioner,
} from "@/sim/default/default";

type PageResult = { data?: Record<string, unknown>[]; next_cursor?: string | null };

export default function SimuladorPage() {
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [list, setList] = useState<PageResult | null>(null);
  const [scheduleId, setScheduleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [createdSlots, setCreatedSlots] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function refresh() {
    setError(null);
    try {
      setList((await listSimPractitioner()) as PageResult);
    } catch (err) {
      setError(err);
    }
  }

  async function createPractitioner() {
    setError(null);
    try {
      await createSimPractitioner({
        body: JSON.stringify({
          name,
          identifier_value: identifier,
        }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setName("");
      setIdentifier("");
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function generate() {
    setError(null);
    try {
      const result = await generateSimSlots(scheduleId, {
        body: JSON.stringify({
          from,
          to,
          duration_minutes: 30,
          windows: [{ weekday: 1, start_time: "08:00", end_time: "12:00" }],
        }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setCreatedSlots(result.created);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="simulador">
      <h1>Simulador Hermes</h1>
      <p className="muted">Requiere HERMES_SIMULATOR_ENABLED=true y rol admin.</p>
      <ErrorBox error={error} />

      <section>
        <h2>Profesionales</h2>
        <div className="stack">
          <label>
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            identifier_value
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" onClick={createPractitioner}>
              Crear
            </button>
            <button type="button" onClick={refresh}>
              Listar
            </button>
          </div>
        </div>
        {list?.data ? (
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>nombre</th>
                <th>identificador</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.id)}</td>
                  <td>{String(row.name)}</td>
                  <td>{String(row.identifier_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section>
        <h2>Generar cupos</h2>
        <div className="row">
          <label>
            Agenda id
            <input value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
          </label>
          <label>
            Desde
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label>
            Hasta
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <button type="button" onClick={generate}>
            Generar (lun 08–12)
          </button>
        </div>
        {createdSlots !== null ? <p>Creados: {createdSlots}</p> : null}
      </section>
    </div>
  );
}
