"use client";

import type { KnowledgeEntry } from "@/api/models";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { Flap } from "@/components/ui/flap";
import { text } from "@/lib/format";
import { formatKeywords } from "@/lib/knowledge-draft";
import { useIdentity } from "@/lib/use-session";
import { KnowledgeForm } from "./knowledge-form";
import { useKnowledge } from "./use-knowledge";

const COLUMNS: readonly Column[] = [
  { header: "Pregunta", render: (row) => text(row, "question") },
  {
    header: "Palabras clave",
    optional: true,
    render: (row) => (
      <span className="cell-muted">{formatKeywords((row.keywords as string[]) ?? [])}</span>
    ),
  },
  {
    header: "Pos.",
    width: "1%",
    render: (row) => <span className="data">{text(row, "position")}</span>,
  },
  {
    header: "Estado",
    width: "1%",
    render: (row, index) => <Flap status={text(row, "active")} row={index} />,
  },
];

/** Orden de presentación: por categoría y, dentro de ella, por posición. */
function toRows(entries: readonly KnowledgeEntry[]): Row[] {
  return [...entries]
    .sort((a, b) => a.category.localeCompare(b.category, "es") || a.position - b.position)
    .map((entry) => ({ ...entry }));
}

/** Base de conocimiento: formulario a la izquierda (solo admin) y tablero por categoría. */
export function KnowledgeBoard() {
  const kb = useKnowledge();
  const identity = useIdentity();
  const canWrite = identity.data?.role === "admin";
  const { list } = kb;
  const picking = canWrite
    ? {
        onPick: (row: Row) => kb.pick(text(row, "id")),
        pickedId: kb.picked,
        pickLabel: "Editar",
      }
    : {};
  return (
    <div className={canWrite ? "crud" : undefined}>
      {canWrite ? (
        <div className="crud-forms">
          <KnowledgeForm kb={kb} />
        </div>
      ) : null}
      <section className="board" aria-label="Entradas de la base de conocimiento">
        <div className="board-head">
          <div className="board-title">
            <h2>Entradas</h2>
            {list.hasNextPage ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </button>
            ) : null}
          </div>
          <ErrorBox error={kb.error ?? list.error} />
        </div>
        <Board
          columns={COLUMNS}
          rows={kb.entries ? toRows(kb.entries) : null}
          loading={list.isLoading}
          more={Boolean(list.hasNextPage)}
          groupBy={(row) => text(row, "category")}
          {...picking}
          idle={{
            title: "Sin sesión",
            hint: "Inicia sesión en la franja de sesión (tecla 0) para ver la base de conocimiento.",
          }}
          empty={{
            title: "Sin entradas",
            hint: "Un admin puede crear la primera con el formulario.",
          }}
        />
      </section>
    </div>
  );
}
