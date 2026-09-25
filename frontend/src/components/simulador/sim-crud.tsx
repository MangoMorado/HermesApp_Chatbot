"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { Field } from "@/components/ui/field";
import { ApiClientError } from "@/lib/api-fetcher";
import { text } from "@/lib/format";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";

export type FieldSpec = {
  readonly name: string;
  readonly label: string;
  readonly type?: "text" | "date";
  readonly options?: readonly string[];
};

type Values = Record<string, string>;
type PageResult = { data?: Row[]; next_cursor?: string | null };

export type CrudSpec = {
  /** Prefijo del alcance de idempotencia (`practitioner.create`, …). */
  readonly scope: string;
  readonly noun: string;
  readonly createFields: readonly FieldSpec[];
  /** Campos que se editan sobre la fila elegida; sin campos, la acción es fija. */
  readonly update: {
    readonly label: string;
    readonly fields: readonly FieldSpec[];
    readonly body: (v: Values) => object;
  };
  readonly columns: readonly Column[];
  readonly list: () => Promise<unknown>;
  readonly create: (init: RequestInit) => Promise<unknown>;
  readonly patch: (id: string, init: RequestInit) => Promise<unknown>;
  readonly remove: (id: string, init: RequestInit) => Promise<unknown>;
};

function initial(fields: readonly FieldSpec[]): Values {
  return Object.fromEntries(fields.map((f) => [f.name, f.options?.[0] ?? ""]));
}

function Inputs({
  fields,
  values,
  onChange,
}: {
  readonly fields: readonly FieldSpec[];
  readonly values: Values;
  readonly onChange: (v: Values) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <Field key={f.name} label={f.label} apiKey={f.name}>
          {f.options ? (
            <select
              className="input"
              value={values[f.name]}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
            >
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              type={f.type ?? "text"}
              value={values[f.name] ?? ""}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </>
  );
}

/** Estado y acciones de un maestro del simulador; cada escritura lleva su Idempotency-Key. */
function useCrud(spec: CrudSpec) {
  const [list, setList] = useState<PageResult | null>(null);
  const [draft, setDraft] = useState(() => initial(spec.createFields));
  const [edit, setEdit] = useState(() => initial(spec.update.fields));
  const [picked, setPicked] = useState("");
  const [armed, setArmed] = useState(false);
  const action = useAction();
  const reload = async () => setList((await spec.list()) as PageResult);

  return {
    list,
    draft,
    setDraft,
    edit,
    setEdit,
    picked,
    armed,
    setArmed,
    ...action,
    pick: (id: string) => {
      setPicked(id === picked ? "" : id);
      setArmed(false);
    },
    load: () => action.run("list", reload),
    create: () =>
      action.run("create", async () => {
        await spec.create(idempotent(`${spec.scope}.create`, draft));
        setDraft(initial(spec.createFields));
        await reload();
      }),
    patch: () =>
      action.run("update", async () => {
        await spec.patch(
          picked,
          idempotent(`${spec.scope}.update:${picked}`, spec.update.body(edit)),
        );
        await reload();
      }),
    remove: () =>
      action.run("delete", async () => {
        await spec.remove(picked, idempotent(`${spec.scope}.delete:${picked}`, {}));
        setPicked("");
        setArmed(false);
        await reload();
      }),
  };
}

function EditBlock({
  spec,
  crud,
}: {
  readonly spec: CrudSpec;
  readonly crud: ReturnType<typeof useCrud>;
}) {
  const busy = crud.pending !== null;
  if (!crud.picked) {
    return (
      <div className="form-block">
        <h3>Editar</h3>
        <p className="hint">Elige una fila del tablero para editarla o borrarla.</p>
      </div>
    );
  }
  return (
    <form
      className="form-block"
      action={() => {
        crud.patch();
      }}
    >
      <h3>
        Editar <span className="field-key">{crud.picked}</span>
      </h3>
      <Inputs fields={spec.update.fields} values={crud.edit} onChange={crud.setEdit} />
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy} aria-busy={crud.pending === "update"}>
          {spec.update.label}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-armed={crud.armed}
          disabled={busy}
          onClick={() => (crud.armed ? crud.remove() : crud.setArmed(true))}
        >
          {crud.armed ? `Confirmar borrado` : "Borrar"}
        </button>
      </div>
    </form>
  );
}

/** Sin lista todavía: o no se ha pedido, o la petición falló (y el aviso ya dice por qué). */
function idleMessage(error: unknown): { title: string; hint: string } {
  if (error instanceof ApiClientError && error.status === 404) {
    return {
      title: "El simulador no responde",
      hint: "Comprueba HERMES_SIMULATOR_ENABLED=true en el backend y vuelve a listar.",
    };
  }
  if (error) {
    return { title: "No se pudo listar", hint: "Revisa el aviso de arriba y vuelve a intentarlo." };
  }
  return { title: "Aún no se ha listado", hint: "«Listar» trae los registros del simulador." };
}

/** Pestaña de un maestro: crear y editar a la izquierda, tablero a la derecha. */
export function SimCrud({ spec }: { readonly spec: CrudSpec }) {
  const crud = useCrud(spec);
  const busy = crud.pending !== null;
  return (
    <div className="crud">
      <div className="crud-forms">
        <form
          className="form-block"
          action={() => {
            crud.create();
          }}
        >
          <h3>Crear {spec.noun}</h3>
          <Inputs fields={spec.createFields} values={crud.draft} onChange={crud.setDraft} />
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              aria-busy={crud.pending === "create"}
            >
              {crud.pending === "create" ? "Creando…" : "Crear"}
            </button>
          </div>
        </form>
        <EditBlock spec={spec} crud={crud} />
      </div>
      <section className="board" aria-label={`Tablero de ${spec.noun}`}>
        <div className="board-head">
          <div className="board-title">
            <h2>Registros</h2>
            <button type="button" className="btn btn-small" onClick={crud.load} disabled={busy}>
              {crud.list ? "Recargar" : "Listar"}
            </button>
          </div>
          <ErrorBox error={crud.error} />
        </div>
        <Board
          columns={spec.columns}
          rows={crud.list ? (crud.list.data ?? []) : null}
          loading={crud.pending === "list"}
          more={Boolean(crud.list?.next_cursor)}
          onPick={(row) => crud.pick(text(row, "id"))}
          pickedId={crud.picked}
          pickLabel="Editar"
          idle={idleMessage(crud.error)}
          empty={{ title: "Sin registros", hint: `Crea el primer ${spec.noun} con el formulario.` }}
        />
      </section>
    </div>
  );
}
