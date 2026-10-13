"use client";

import Link from "next/link";
import { Flap } from "@/components/ui/flap";
import { useIdentity, useToken } from "@/lib/use-session";

const DESTINATIONS = [
  {
    key: "1",
    href: "/panel",
    title: "Panel",
    detail: "Agenda, cupos libres y expediente por documento.",
    roles: "operator · admin",
  },
  {
    key: "2",
    href: "/panel/ajustes",
    title: "Ajustes del tenant",
    detail: "Tope del rango de consulta.",
    roles: "admin",
  },
  {
    key: "3",
    href: "/simulador",
    title: "Simulador Hermes",
    detail: "Maestros y cupos de prueba. Se apaga en producción.",
    roles: "admin",
  },
] as const;

function SessionRow() {
  const token = useToken();
  const identity = useIdentity();
  let status = "session_off";
  let detail = "Pega un JWT en la franja de sesión (tecla 4).";
  if (token && identity.data) {
    status = "session_on";
    detail = `${identity.data.role} en el tenant ${identity.data.tenant_id}`;
  } else if (token && identity.isError) {
    status = "session_rejected";
    detail = "El backend rechazó el token. Firma uno nuevo con token:dev.";
  } else if (token) {
    detail = "Verificando el token con /me…";
  }
  return (
    <div className="departure">
      <span className="departure-key">4</span>
      <div>
        <strong>Sesión</strong>
        <span>{detail}</span>
      </div>
      <Flap status={status} />
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Salidas</h1>
          <p>
            Consola de pruebas del chatbot Ingenius360. Todo lo que ves lo resuelve el backend; esta
            pantalla solo lo muestra.
          </p>
        </div>
      </div>
      <nav className="departures" aria-label="Destinos">
        <SessionRow />
        {DESTINATIONS.map((item) => (
          <Link key={item.href} href={item.href} className="departure">
            <span className="departure-key">{item.key}</span>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            <span className="departure-roles">{item.roles}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
