"use client";

import { useState } from "react";
import { listAvailability, listScheduleSlots } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { Id, Time } from "@/components/ui/cells";
import { Field } from "@/components/ui/field";
import { Flap } from "@/components/ui/flap";
import { dayOf, text } from "@/lib/format";
import { useAction } from "@/lib/use-action";

type PageResult = { data?: Row[]; next_cursor?: string | null };
type Result = { title: string; rows: Row[]; more: boolean; run: number };

/** Columnas del tablero; la agenda se nombra con su código Hermes (SCH-002). */
function columns(codes: ReadonlyMap<string, string>): readonly Column[] {
  return [
    { header: "Sale", width: "1%", render: (row) => <Time value={row.start_at} /> },
    { header: "Llega", width: "1%", render: (row) => <Time value={row.end_at} /> },
    {
      header: "Agenda",
      width: "1%",
      render: (row) => <Id value={row.schedule_id} label={codes.get(text(row, "schedule_id"))} />,
    },
    { header: "Estado", render: (row, i) => <Flap status={text(row, "status")} row={i} /> },
  ];
}

const byDay = (row: Row) => dayOf(row.start_at);

type Props = {
  readonly schedules: readonly Row[];
  readonly scheduleId: string;
  readonly onScheduleChange: (id: string) => void;
  readonly maxDays: number | null;
};

function scheduleLabel(row: Row): string {
  return text(row, "identifier_value") || text(row, "id").slice(0, 8);
}

/** Tablero principal: rango de fechas en el encabezado y filas de cupos debajo. */
export function AgendaBoard({ schedules, scheduleId, onScheduleChange, maxDays }: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const { pending, error, run } = useAction();
  const codes = new Map(schedules.map((row) => [text(row, "id"), scheduleLabel(row)]));
  // Solo se exige que haya fechas; el tope y el orden los valida el backend.
  const rangeReady = Boolean(from && to);

  function show(title: string, page: PageResult) {
    setResult((prev) => ({
      title,
      rows: page.data ?? [],
      more: Boolean(page.next_cursor),
      run: (prev?.run ?? 0) + 1,
    }));
  }

  const searchFree = () =>
    run("free", async () => {
      const params = { from, to, ...(scheduleId ? { schedule_id: scheduleId } : {}) };
      show("Cupos libres", (await listAvailability(params)) as PageResult);
    });

  const searchAgenda = () =>
    run("agenda", async () => {
      show("Agenda completa", (await listScheduleSlots(scheduleId, { from, to })) as PageResult);
    });

  return (
    <section className="board" aria-labelledby="agenda-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="agenda-title">{result?.title ?? "Agenda"}</h2>
          <p>{maxDays ? `Rango máximo ${maxDays} días · ` : ""}«Hasta» no se incluye</p>
        </div>
        <form
          className="controls"
          action={() => {
            if (rangeReady) void searchFree();
          }}
        >
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
          <Field label="Agenda" apiKey="schedule_id" className="field-wide">
            <select
              className="input"
              value={scheduleId}
              onChange={(e) => onScheduleChange(e.target.value)}
            >
              <option value="">Todas las agendas</option>
              {schedules.map((row) => (
                <option key={text(row, "id")} value={text(row, "id")}>
                  {scheduleLabel(row)}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!rangeReady || pending !== null}
              aria-busy={pending === "free"}
            >
              {pending === "free" ? "Buscando…" : "Buscar libres"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={searchAgenda}
              disabled={!rangeReady || !scheduleId || pending !== null}
              aria-busy={pending === "agenda"}
              title={scheduleId ? undefined : "Elige una agenda para ver todos sus cupos"}
            >
              {pending === "agenda" ? "Cargando…" : "Ver agenda"}
            </button>
          </div>
        </form>
        <ErrorBox error={error} />
      </div>
      <Board
        key={result?.run ?? 0}
        columns={columns(codes)}
        groupBy={byDay}
        rows={result?.rows ?? null}
        loading={pending !== null}
        more={result?.more}
        idle={{
          title: "Elige un rango de fechas",
          hint: "«Buscar libres» lista cupos disponibles; «Ver agenda» muestra todos los cupos de una agenda.",
        }}
        empty={{
          title: "Sin cupos en ese rango",
          hint: "Amplía las fechas o genera cupos en el simulador.",
        }}
      />
    </section>
  );
}
