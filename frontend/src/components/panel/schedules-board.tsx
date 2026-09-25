"use client";

import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { Id } from "@/components/ui/cells";
import { text } from "@/lib/format";

const COLUMNS: readonly Column[] = [
  {
    header: "Agenda",
    width: "1%",
    render: (row) => <Id value={row.id} label={text(row, "identifier_value")} />,
  },
  { header: "Profesional", render: (row) => <Id value={row.practitioner_id} /> },
  {
    header: "Servicio",
    optional: true,
    render: (row) => <Id value={row.healthcare_service_id} />,
  },
];

type Props = {
  readonly rows: readonly Row[] | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly more: boolean;
  readonly pickedId: string;
  readonly onPick: (id: string) => void;
  readonly onReload: () => void;
};

/** Agendas activas del tenant; elegir una fija el filtro del tablero de agenda. */
export function SchedulesBoard({ rows, loading, error, more, pickedId, onPick, onReload }: Props) {
  return (
    <section className="board" aria-labelledby="schedules-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="schedules-title">Agendas activas</h2>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={onReload}
            disabled={loading}
          >
            Recargar
          </button>
        </div>
        <p className="board-hint">
          Elige una fila para filtrar el tablero; otra vez para quitar el filtro.
        </p>
        <ErrorBox error={error} />
      </div>
      <Board
        columns={COLUMNS}
        rows={rows}
        loading={loading}
        more={more}
        onPick={(row) => onPick(pickedId === text(row, "id") ? "" : text(row, "id"))}
        pickedId={pickedId}
        pickLabel="Filtrar por la agenda"
        idle={
          error
            ? { title: "No se pudieron cargar", hint: "Revisa el aviso y pulsa Recargar." }
            : { title: "Sin sesión", hint: "Pega un token para ver las agendas del tenant." }
        }
        empty={{
          title: "No hay agendas activas",
          hint: "Créalas en el simulador (pestaña Agendas).",
        }}
      />
    </section>
  );
}
