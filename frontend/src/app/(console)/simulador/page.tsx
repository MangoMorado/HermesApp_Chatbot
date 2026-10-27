"use client";

import { type KeyboardEvent, useRef, useState } from "react";
import { SimCrud } from "@/components/simulador/sim-crud";
import { SlotsPanel } from "@/components/simulador/slots-panel";
import { PATIENTS, PRACTITIONERS, SCHEDULES, SERVICES } from "@/components/simulador/specs";
import { TenantsPanel } from "@/components/simulador/tenants-panel";

const TABS = [
  { id: "practitioners", label: "Profesionales", body: <SimCrud spec={PRACTITIONERS} /> },
  { id: "services", label: "Servicios", body: <SimCrud spec={SERVICES} /> },
  { id: "schedules", label: "Agendas", body: <SimCrud spec={SCHEDULES} /> },
  { id: "patients", label: "Pacientes", body: <SimCrud spec={PATIENTS} /> },
  { id: "slots", label: "Cupos", body: <SlotsPanel /> },
  { id: "tenants", label: "Tenants", body: <TenantsPanel /> },
] as const;

export default function SimuladorPage() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Flechas izquierda/derecha recorren las pestañas (patrón tablist de WAI-ARIA).
  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    const next = (active + step + TABS.length) % TABS.length;
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Simulador Hermes</h1>
          <p>
            Maestros de prueba en <code>hermes_sim</code>. Requiere{" "}
            <code>HERMES_SIMULATOR_ENABLED=true</code> y rol admin; en producción se apaga.
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Maestros del simulador">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            className="tab"
            aria-selected={active === index}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Todas las pestañas quedan montadas: cambiar de pestaña no borra lo escrito. */}
      {TABS.map((tab, index) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== index}
        >
          {tab.body}
        </div>
      ))}
    </>
  );
}
