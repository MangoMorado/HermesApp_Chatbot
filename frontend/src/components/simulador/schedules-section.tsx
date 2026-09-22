"use client";

import { idempotent } from "@/lib/idempotency";
import {
  createSimSchedule,
  deleteSimSchedule,
  listSimSchedule,
  updateSimSchedule,
} from "@/sim/default/default";
import { cell, type PageResult, runAction } from "./helpers";

type Props = {
  readonly list: PageResult | null;
  readonly setList: (value: PageResult | null) => void;
  readonly setError: (err: unknown) => void;
  readonly identifier: string;
  readonly setIdentifier: (value: string) => void;
  readonly practitionerId: string;
  readonly setPractitionerId: (value: string) => void;
  readonly serviceId: string;
  readonly setServiceId: (value: string) => void;
  readonly editId: string;
  readonly setEditId: (value: string) => void;
};

export function SchedulesSection(props: Props) {
  return (
    <section>
      <h2>Agendas</h2>
      <div className="stack">
        <label>
          identifier_value
          <input value={props.identifier} onChange={(e) => props.setIdentifier(e.target.value)} />
        </label>
        <label>
          practitioner_id
          <input
            value={props.practitionerId}
            onChange={(e) => props.setPractitionerId(e.target.value)}
          />
        </label>
        <label>
          healthcare_service_id
          <input value={props.serviceId} onChange={(e) => props.setServiceId(e.target.value)} />
        </label>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await createSimSchedule(
                  idempotent("schedule.create", {
                    identifier_value: props.identifier,
                    practitioner_id: props.practitionerId,
                    healthcare_service_id: props.serviceId,
                  }),
                );
                props.setIdentifier("");
                props.setList((await listSimSchedule()) as PageResult);
              })
            }
          >
            Crear
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () =>
                props.setList((await listSimSchedule()) as PageResult),
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
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await updateSimSchedule(
                  props.editId,
                  idempotent(`schedule.update:${props.editId}`, { active: false }),
                );
                props.setList((await listSimSchedule()) as PageResult);
              })
            }
          >
            Desactivar
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(props.setError, async () => {
                await deleteSimSchedule(
                  props.editId,
                  idempotent(`schedule.delete:${props.editId}`, {}),
                );
                props.setList((await listSimSchedule()) as PageResult);
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
              <th>profesional</th>
              <th>servicio</th>
              <th>activo</th>
            </tr>
          </thead>
          <tbody>
            {props.list.data.map((row) => (
              <tr key={cell(row, "id")}>
                <td>{cell(row, "id")}</td>
                <td>{cell(row, "practitioner_id")}</td>
                <td>{cell(row, "healthcare_service_id")}</td>
                <td>{cell(row, "active")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
