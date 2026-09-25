"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { generateSimSlots } from "@/sim/default/default";

/** Ventana fija de la Fase 2: lunes de 08:00 a 12:00 en cupos de 30 minutos. */
const WINDOW = {
  duration_minutes: 30,
  windows: [{ weekday: 1, start_time: "08:00", end_time: "12:00" }],
};

export function SlotsPanel() {
  const [scheduleId, setScheduleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [created, setCreated] = useState<number | null>(null);
  const { pending, error, run } = useAction();
  const ready = Boolean(scheduleId.trim() && from && to);

  const generate = () =>
    run("generate", async () => {
      setCreated(null);
      const result = await generateSimSlots(
        scheduleId,
        idempotent(`schedule.generate-slots:${scheduleId}`, { from, to, ...WINDOW }),
      );
      setCreated(result.created);
    });

  return (
    <section className="board" aria-labelledby="slots-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="slots-title">Generar cupos</h2>
          <p>Lunes 08:00–12:00 · cupos de 30 min</p>
        </div>
        <ErrorBox error={error} />
        {created !== null ? (
          <div className="notice notice-ok" role="status">
            <span className="flap" data-tone="ok">
              {created} CREADOS
            </span>
            <span>Consúltalos en el panel con «Ver agenda».</span>
          </div>
        ) : null}
      </div>
      <form
        className="board-body controls"
        action={() => {
          if (ready) generate();
        }}
      >
        <Field label="Agenda" apiKey="schedule_id" className="field-wide">
          <input
            className="input data"
            value={scheduleId}
            onChange={(e) => setScheduleId(e.target.value)}
          />
        </Field>
        <Field label="Desde" apiKey="from" className="field-narrow">
          <input
            className="input data"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Hasta" apiKey="to" className="field-narrow">
          <input
            className="input data"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!ready || pending !== null}
          aria-busy={pending !== null}
        >
          {pending ? "Generando…" : "Generar cupos"}
        </button>
      </form>
    </section>
  );
}
