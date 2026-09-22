"use client";

import {
  createSimPractitioner,
  deleteSimPractitioner,
  listSimPractitioner,
  updateSimPractitioner,
} from "@/sim/default/default";
import { cell, idempotent, type PageResult, runAction } from "./helpers";

type Props = {
  readonly list: PageResult | null;
  readonly setList: (value: PageResult | null) => void;
  readonly setError: (err: unknown) => void;
  readonly name: string;
  readonly setName: (value: string) => void;
  readonly identifier: string;
  readonly setIdentifier: (value: string) => void;
  readonly editId: string;
  readonly setEditId: (value: string) => void;
  readonly editName: string;
  readonly setEditName: (value: string) => void;
};

export function PractitionersSection(props: Props) {
  return (
    <section>
      <h2>Profesionales</h2>
      <div className="stack">
        <label>
          Nombre
          <input value={props.name} onChange={(e) => props.setName(e.target.value)} />
        </label>
        <label>
          identifier_value
          <input value={props.identifier} onChange={(e) => props.setIdentifier(e.target.value)} />
        </label>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await createSimPractitioner(
                  idempotent({ name: props.name, identifier_value: props.identifier }),
                );
                props.setName("");
                props.setIdentifier("");
                props.setList((await listSimPractitioner()) as PageResult);
              })
            }
          >
            Crear
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () =>
                props.setList((await listSimPractitioner()) as PageResult),
              )
            }
          >
            Listar
          </button>
        </div>
        <div className="row">
          <label>
            id
            <input value={props.editId} onChange={(e) => props.setEditId(e.target.value)} />
          </label>
          <label>
            nuevo nombre
            <input value={props.editName} onChange={(e) => props.setEditName(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await updateSimPractitioner(props.editId, idempotent({ name: props.editName }));
                props.setList((await listSimPractitioner()) as PageResult);
              })
            }
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await deleteSimPractitioner(props.editId, idempotent({}));
                props.setList((await listSimPractitioner()) as PageResult);
              })
            }
          >
            Borrar
          </button>
        </div>
      </div>
      {props.list?.data ? (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>nombre</th>
              <th>identificador</th>
            </tr>
          </thead>
          <tbody>
            {props.list.data.map((row) => (
              <tr key={cell(row, "id")}>
                <td>{cell(row, "id")}</td>
                <td>{cell(row, "name")}</td>
                <td>{cell(row, "identifier_value")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
