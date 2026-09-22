"use client";

import { idempotent } from "@/lib/idempotency";
import {
  createSimPatient,
  deleteSimPatient,
  listSimPatient,
  updateSimPatient,
} from "@/sim/default/default";
import { cell, type PageResult, runAction } from "./helpers";

type Props = {
  readonly list: PageResult | null;
  readonly setList: (value: PageResult | null) => void;
  readonly setError: (err: unknown) => void;
  readonly identifier: string;
  readonly setIdentifier: (value: string) => void;
  readonly docType: string;
  readonly setDocType: (value: string) => void;
  readonly docNumber: string;
  readonly setDocNumber: (value: string) => void;
  readonly given: string;
  readonly setGiven: (value: string) => void;
  readonly family: string;
  readonly setFamily: (value: string) => void;
  readonly birth: string;
  readonly setBirth: (value: string) => void;
  readonly editId: string;
  readonly setEditId: (value: string) => void;
  readonly editGiven: string;
  readonly setEditGiven: (value: string) => void;
};

export function PatientsSection(props: Props) {
  return (
    <section>
      <h2>Pacientes</h2>
      <div className="stack">
        <label>
          identifier_value
          <input value={props.identifier} onChange={(e) => props.setIdentifier(e.target.value)} />
        </label>
        <label>
          Tipo
          <select value={props.docType} onChange={(e) => props.setDocType(e.target.value)}>
            {["CC", "TI", "CE", "PA", "RC"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Número
          <input value={props.docNumber} onChange={(e) => props.setDocNumber(e.target.value)} />
        </label>
        <label>
          Nombres
          <input value={props.given} onChange={(e) => props.setGiven(e.target.value)} />
        </label>
        <label>
          Apellidos
          <input value={props.family} onChange={(e) => props.setFamily(e.target.value)} />
        </label>
        <label>
          Nacimiento
          <input
            value={props.birth}
            onChange={(e) => props.setBirth(e.target.value)}
            placeholder="YYYY-MM-DD"
          />
        </label>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await createSimPatient(
                  idempotent("patient.create", {
                    identifier_value: props.identifier,
                    document_type: props.docType,
                    document_number: props.docNumber,
                    given_names: props.given,
                    family_names: props.family,
                    birth_date: props.birth,
                  }),
                );
                props.setList((await listSimPatient()) as PageResult);
              })
            }
          >
            Crear
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () =>
                props.setList((await listSimPatient()) as PageResult),
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
            nuevos nombres
            <input value={props.editGiven} onChange={(e) => props.setEditGiven(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await updateSimPatient(
                  props.editId,
                  idempotent(`patient.update:${props.editId}`, { given_names: props.editGiven }),
                );
                props.setList((await listSimPatient()) as PageResult);
              })
            }
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await deleteSimPatient(
                  props.editId,
                  idempotent(`patient.delete:${props.editId}`, {}),
                );
                props.setList((await listSimPatient()) as PageResult);
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
              <th>documento</th>
              <th>nombre</th>
            </tr>
          </thead>
          <tbody>
            {props.list.data.map((row) => (
              <tr key={cell(row, "id")}>
                <td>{cell(row, "id")}</td>
                <td>
                  {cell(row, "document_type")} {cell(row, "document_number")}
                </td>
                <td>
                  {cell(row, "given_names")} {cell(row, "family_names")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
