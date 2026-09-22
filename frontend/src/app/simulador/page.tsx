"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { idempotent, type PageResult, runAction } from "@/components/simulador/helpers";
import { PatientsSection } from "@/components/simulador/patients-section";
import { PractitionersSection } from "@/components/simulador/practitioners-section";
import { SchedulesSection } from "@/components/simulador/schedules-section";
import { ServicesSection } from "@/components/simulador/services-section";
import { generateSimSlots } from "@/sim/default/default";

export default function SimuladorPage() {
  const [error, setError] = useState<unknown>(null);
  const [practitioners, setPractitioners] = useState<PageResult | null>(null);
  const [services, setServices] = useState<PageResult | null>(null);
  const [schedules, setSchedules] = useState<PageResult | null>(null);
  const [patients, setPatients] = useState<PageResult | null>(null);

  const [pracName, setPracName] = useState("");
  const [pracIdValue, setPracIdValue] = useState("");
  const [pracEditId, setPracEditId] = useState("");
  const [pracEditName, setPracEditName] = useState("");

  const [svcName, setSvcName] = useState("");
  const [svcIdValue, setSvcIdValue] = useState("");
  const [svcEditId, setSvcEditId] = useState("");
  const [svcEditName, setSvcEditName] = useState("");

  const [schIdValue, setSchIdValue] = useState("");
  const [schPractitionerId, setSchPractitionerId] = useState("");
  const [schServiceId, setSchServiceId] = useState("");
  const [schEditId, setSchEditId] = useState("");

  const [patIdValue, setPatIdValue] = useState("");
  const [patDocType, setPatDocType] = useState("CC");
  const [patDocNumber, setPatDocNumber] = useState("");
  const [patGiven, setPatGiven] = useState("");
  const [patFamily, setPatFamily] = useState("");
  const [patBirth, setPatBirth] = useState("");
  const [patEditId, setPatEditId] = useState("");
  const [patEditGiven, setPatEditGiven] = useState("");

  const [scheduleId, setScheduleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [createdSlots, setCreatedSlots] = useState<number | null>(null);

  return (
    <div className="simulador">
      <h1>Simulador Hermes</h1>
      <p className="muted">Requiere HERMES_SIMULATOR_ENABLED=true y rol admin.</p>
      <ErrorBox error={error} />

      <PractitionersSection
        list={practitioners}
        setList={setPractitioners}
        setError={setError}
        name={pracName}
        setName={setPracName}
        identifier={pracIdValue}
        setIdentifier={setPracIdValue}
        editId={pracEditId}
        setEditId={setPracEditId}
        editName={pracEditName}
        setEditName={setPracEditName}
      />

      <ServicesSection
        list={services}
        setList={setServices}
        setError={setError}
        name={svcName}
        setName={setSvcName}
        identifier={svcIdValue}
        setIdentifier={setSvcIdValue}
        editId={svcEditId}
        setEditId={setSvcEditId}
        editName={svcEditName}
        setEditName={setSvcEditName}
      />

      <SchedulesSection
        list={schedules}
        setList={setSchedules}
        setError={setError}
        identifier={schIdValue}
        setIdentifier={setSchIdValue}
        practitionerId={schPractitionerId}
        setPractitionerId={setSchPractitionerId}
        serviceId={schServiceId}
        setServiceId={setSchServiceId}
        editId={schEditId}
        setEditId={setSchEditId}
      />

      <PatientsSection
        list={patients}
        setList={setPatients}
        setError={setError}
        identifier={patIdValue}
        setIdentifier={setPatIdValue}
        docType={patDocType}
        setDocType={setPatDocType}
        docNumber={patDocNumber}
        setDocNumber={setPatDocNumber}
        given={patGiven}
        setGiven={setPatGiven}
        family={patFamily}
        setFamily={setPatFamily}
        birth={patBirth}
        setBirth={setPatBirth}
        editId={patEditId}
        setEditId={setPatEditId}
        editGiven={patEditGiven}
        setEditGiven={setPatEditGiven}
      />

      <section>
        <h2>Generar cupos</h2>
        <div className="row">
          <label>
            Agenda id
            <input value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
          </label>
          <label>
            Desde
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label>
            Hasta
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <button
            type="button"
            onClick={() =>
              runAction(setError, async () => {
                const result = await generateSimSlots(
                  scheduleId,
                  idempotent({
                    from,
                    to,
                    duration_minutes: 30,
                    windows: [{ weekday: 1, start_time: "08:00", end_time: "12:00" }],
                  }),
                );
                setCreatedSlots(result.created);
              })
            }
          >
            Generar (lun 08–12)
          </button>
        </div>
        {createdSlots !== null ? <p>Creados: {createdSlots}</p> : null}
      </section>
    </div>
  );
}
