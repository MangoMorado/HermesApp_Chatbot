"use client";

import { useState } from "react";
import {
  findMedicalRecord,
  getTenantSettings,
  listAvailability,
  listMedicalRecordAppointments,
  listScheduleSlots,
  listSchedules,
} from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";

type PageResult = { data?: unknown[]; next_cursor?: string | null };

export default function PanelPage() {
  const [maxDays, setMaxDays] = useState(31);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [docType, setDocType] = useState("CC");
  const [docNumber, setDocNumber] = useState("");
  const [availability, setAvailability] = useState<PageResult | null>(null);
  const [slots, setSlots] = useState<PageResult | null>(null);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<PageResult | null>(null);
  const [schedules, setSchedules] = useState<PageResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function loadSettings() {
    setError(null);
    try {
      const settings = await getTenantSettings();
      setMaxDays(settings.max_query_range_days);
    } catch (err) {
      setError(err);
    }
  }

  async function loadSchedules() {
    setError(null);
    try {
      setSchedules((await listSchedules({ active: true })) as PageResult);
    } catch (err) {
      setError(err);
    }
  }

  async function searchAvailability() {
    setError(null);
    try {
      setAvailability(
        (await listAvailability({
          from,
          to,
          ...(scheduleId ? { schedule_id: scheduleId } : {}),
        })) as PageResult,
      );
    } catch (err) {
      setError(err);
    }
  }

  async function searchAgenda() {
    setError(null);
    try {
      setSlots((await listScheduleSlots(scheduleId, { from, to })) as PageResult);
    } catch (err) {
      setError(err);
    }
  }

  async function searchRecord() {
    setError(null);
    try {
      const found = (await findMedicalRecord({
        document_type: docType,
        document_number: docNumber,
      })) as Record<string, unknown>;
      setRecord(found);
      const id = String(found.id ?? "");
      if (id) {
        setHistory((await listMedicalRecordAppointments(id)) as PageResult);
      }
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="panel">
      <h1>Panel</h1>
      <ErrorBox error={error} />

      <section>
        <h2>Ajustes del tenant (lectura)</h2>
        <p className="muted">Tope de rango: {maxDays} días (el backend valida).</p>
        <button type="button" onClick={loadSettings}>
          Cargar tope
        </button>
      </section>

      <section>
        <h2>Agendas</h2>
        <button type="button" onClick={loadSchedules}>
          Listar agendas activas
        </button>
        {schedules?.data ? (
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>profesional</th>
                <th>servicio</th>
              </tr>
            </thead>
            <tbody>
              {(schedules.data as Record<string, string>[]).map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.practitioner_id}</td>
                  <td>{row.healthcare_service_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section>
        <h2>Disponibilidad y agenda</h2>
        <div className="row">
          <label>
            Desde
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label>
            Hasta (exclusivo)
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <label>
            Agenda id
            <input value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
          </label>
          <button type="button" onClick={searchAvailability}>
            Buscar libres
          </button>
          <button type="button" onClick={searchAgenda}>
            Ver agenda
          </button>
        </div>
        {availability?.data ? (
          <table>
            <thead>
              <tr>
                <th>inicio</th>
                <th>fin</th>
                <th>estado</th>
              </tr>
            </thead>
            <tbody>
              {(availability.data as Record<string, string>[]).map((row) => (
                <tr key={row.id}>
                  <td>{row.start_at}</td>
                  <td>{row.end_at}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {slots?.data ? (
          <table>
            <thead>
              <tr>
                <th>inicio</th>
                <th>fin</th>
                <th>estado</th>
              </tr>
            </thead>
            <tbody>
              {(slots.data as Record<string, string>[]).map((row) => (
                <tr key={row.id}>
                  <td>{row.start_at}</td>
                  <td>{row.end_at}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section>
        <h2>Expediente</h2>
        <div className="row">
          <label>
            Tipo
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {["CC", "TI", "CE", "PA", "RC"].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Número
            <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </label>
          <button type="button" onClick={searchRecord}>
            Buscar
          </button>
        </div>
        {record ? (
          <p>
            {String(record.given_names)} {String(record.family_names)} · {String(record.status)}
          </p>
        ) : null}
        {history?.data ? (
          <table>
            <thead>
              <tr>
                <th>inicio</th>
                <th>estado</th>
              </tr>
            </thead>
            <tbody>
              {(history.data as Record<string, string>[]).map((row) => (
                <tr key={row.id}>
                  <td>{row.start_at}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
