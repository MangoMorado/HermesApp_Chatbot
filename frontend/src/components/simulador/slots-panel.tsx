"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { shortId, text } from "@/lib/format";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { useToken } from "@/lib/use-session";
import { generateSimSlots, listSimSchedule } from "@/sim/default/default";
import { SLOT_HORIZONS, upcomingRange, WEEKDAY_MORNING } from "./slot-offer";

function labelOf(row: Record<string, unknown>): string {
  const id = text(row, "id");
  const identifier = text(row, "identifier_value");
  return identifier ? `${identifier} · ${shortId(id)}` : shortId(id);
}

export function SlotsPanel() {
  const [schedules, setSchedules] = useState<Record<string, unknown>[] | null>(null);
  const [scheduleId, setScheduleId] = useState("");
  const [days, setDays] = useState<number>(SLOT_HORIZONS[1].days);
  const [created, setCreated] = useState<number | null>(null);
  const token = useToken();
  const { pending, error, run } = useAction();

  const load = useCallback(() => {
    if (!token) {
      setSchedules(null);
      return Promise.resolve();
    }
    return run("load", async () => {
      const page = (await listSimSchedule()) as { data?: Record<string, unknown>[] };
      const rows = page.data ?? [];
      setSchedules(rows);
      setScheduleId((current) => current || text(rows[0] ?? {}, "id"));
    });
  }, [run, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = () =>
    run("generate", async () => {
      setCreated(null);
      const range = upcomingRange(new Date(), days);
      const result = await generateSimSlots(
        scheduleId,
        idempotent(`schedule.generate-slots:${scheduleId}:${days}`, {
          ...range,
          ...WEEKDAY_MORNING,
        }),
      );
      setCreated(result.created);
    });

  return (
    <SlotsForm
      schedules={schedules}
      scheduleId={scheduleId}
      days={days}
      created={created}
      pending={pending}
      error={error}
      hasSession={Boolean(token)}
      onSchedule={setScheduleId}
      onDays={setDays}
      onReload={load}
      onGenerate={generate}
    />
  );
}

function SlotsForm({
  schedules,
  scheduleId,
  days,
  created,
  pending,
  error,
  hasSession,
  onSchedule,
  onDays,
  onReload,
  onGenerate,
}: {
  readonly schedules: Record<string, unknown>[] | null;
  readonly scheduleId: string;
  readonly days: number;
  readonly created: number | null;
  readonly pending: string | null;
  readonly error: unknown;
  readonly hasSession: boolean;
  readonly onSchedule: (id: string) => void;
  readonly onDays: (days: number) => void;
  readonly onReload: () => void;
  readonly onGenerate: () => void;
}) {
  const busy = pending !== null;
  const ready = Boolean(scheduleId);
  return (
    <section className="board" aria-labelledby="slots-title">
      <div className="board-head">
        <div className="board-title">
          <div>
            <h2 id="slots-title">Agregar cupos</h2>
            <p>Lunes a viernes, 08:00–12:00, cupos de 30 min.</p>
          </div>
          <button type="button" className="btn btn-small" onClick={onReload} disabled={busy}>
            {schedules ? "Recargar agendas" : "Cargar agendas"}
          </button>
        </div>
        <ErrorBox error={error} />
        {created !== null ? (
          <output className="notice notice-ok">
            <span className="flap" data-tone="ok">
              {created} CREADOS
            </span>
            <span>Consúltalos en el panel con «Ver agenda».</span>
          </output>
        ) : null}
      </div>
      <form
        className="board-body controls"
        action={() => {
          if (ready) onGenerate();
        }}
      >
        <ScheduleField
          schedules={schedules}
          scheduleId={scheduleId}
          hasSession={hasSession}
          failed={Boolean(error)}
          onSchedule={onSchedule}
        />
        <Field label="Plazo" apiKey="from · to" className="field-narrow">
          <select
            className="input"
            value={days}
            onChange={(event) => onDays(Number(event.target.value))}
          >
            {SLOT_HORIZONS.map((horizon) => (
              <option key={horizon.days} value={horizon.days}>
                {horizon.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!ready || busy}
          aria-busy={pending === "generate"}
        >
          {pending === "generate" ? "Agregando…" : "Agregar cupos"}
        </button>
      </form>
    </section>
  );
}

function ScheduleField({
  schedules,
  scheduleId,
  hasSession,
  failed,
  onSchedule,
}: {
  readonly schedules: Record<string, unknown>[] | null;
  readonly scheduleId: string;
  readonly hasSession: boolean;
  readonly failed: boolean;
  readonly onSchedule: (id: string) => void;
}) {
  if (!hasSession) {
    return <p className="hint">Hace falta una sesión de admin para listar las agendas.</p>;
  }
  if (failed && !schedules) {
    return (
      <p className="hint">
        No se pudieron cargar las agendas. Recarga cuando la sesión esté lista.
      </p>
    );
  }
  if (schedules?.length === 0) {
    return <p className="hint">No hay agendas. Crea una en la pestaña Agendas y recarga.</p>;
  }
  return (
    <Field label="Agenda" apiKey="schedule_id" className="field-wide">
      <select
        className="input"
        value={scheduleId}
        onChange={(event) => onSchedule(event.target.value)}
        disabled={!schedules}
      >
        {schedules ? null : <option value="">Cargando agendas…</option>}
        {schedules?.map((row) => {
          const id = text(row, "id");
          return (
            <option key={id} value={id}>
              {labelOf(row)}
            </option>
          );
        })}
      </select>
    </Field>
  );
}
