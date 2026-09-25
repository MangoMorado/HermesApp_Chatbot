"use client";

import { useState } from "react";
import { findMedicalRecord, listMedicalRecordAppointments } from "@/api/default/default";
import { FindMedicalRecordBodyDocumentType } from "@/api/models";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { Id, When } from "@/components/ui/cells";
import { Field } from "@/components/ui/field";
import { Flap } from "@/components/ui/flap";
import { text } from "@/lib/format";
import { useAction } from "@/lib/use-action";

type PageResult = { data?: Row[]; next_cursor?: string | null };

const COLUMNS: readonly Column[] = [
  { header: "Cita", width: "1%", render: (row) => <When value={row.start_at} /> },
  { header: "Estado", render: (row, i) => <Flap status={text(row, "status")} row={i} /> },
];

function RecordSummary({
  record,
  history,
  loading,
  failed,
}: {
  readonly record: Row;
  readonly history: PageResult | null;
  readonly loading: boolean;
  readonly failed: boolean;
}) {
  return (
    <>
      <div className="record">
        <p className="record-name">
          {text(record, "given_names")} {text(record, "family_names")}
          <Flap status={text(record, "status")} />
        </p>
        <Id value={record.id} />
      </div>
      <Board
        columns={COLUMNS}
        rows={history ? (history.data ?? []) : null}
        loading={loading && !history}
        more={Boolean(history?.next_cursor)}
        idle={
          failed
            ? {
                title: "No se pudo cargar el historial",
                hint: "Revisa el aviso y vuelve a buscar.",
              }
            : {
                title: "Sin historial",
                hint: "El expediente aún no tiene id para consultar citas.",
              }
        }
        empty={{
          title: "Sin citas registradas",
          hint: "Este expediente no tiene citas en Hermes.",
        }}
      />
    </>
  );
}

/** Búsqueda de expediente por documento y su historial de citas. */
export function RecordLookup() {
  const [docType, setDocType] = useState<FindMedicalRecordBodyDocumentType>("CC");
  const [docNumber, setDocNumber] = useState("");
  const [record, setRecord] = useState<Row | null>(null);
  const [history, setHistory] = useState<PageResult | null>(null);
  const { pending, error, run } = useAction();

  const search = () =>
    run("record", async () => {
      setRecord(null);
      setHistory(null);
      const found = (await findMedicalRecord({
        document_type: docType,
        document_number: docNumber,
      })) as Row;
      setRecord(found);
      const id = text(found, "id");
      if (id) {
        setHistory((await listMedicalRecordAppointments(id)) as PageResult);
      }
    });

  return (
    <section className="board" aria-labelledby="record-title">
      <div className="board-head">
        <h2 id="record-title">Expediente</h2>
        <form
          className="controls"
          action={() => {
            if (docNumber.trim()) search();
          }}
        >
          <Field label="Tipo" apiKey="document_type">
            <select
              className="input"
              value={docType}
              onChange={(e) => setDocType(e.target.value as FindMedicalRecordBodyDocumentType)}
            >
              {Object.values(FindMedicalRecordBodyDocumentType).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Número" apiKey="document_number" className="field-wide">
            <input
              className="input data"
              inputMode="numeric"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!docNumber.trim() || pending !== null}
            aria-busy={pending !== null}
          >
            {pending ? "Buscando…" : "Buscar"}
          </button>
        </form>
        <ErrorBox error={error} />
      </div>
      {record ? (
        <RecordSummary
          record={record}
          history={history}
          loading={pending !== null}
          failed={Boolean(error)}
        />
      ) : (
        <div className="empty">
          <strong>Busca por documento</strong>
          <span>Verás el expediente y su historial de citas.</span>
        </div>
      )}
    </section>
  );
}
