"use client";

import Link from "next/link";
import { PLATFORMS, SESSION_SHORTCUT } from "@/components/shell/platforms";
import { Flap } from "@/components/ui/flap";
import { useIdentity, useToken } from "@/lib/use-session";

function SessionRow() {
  const token = useToken();
  const identity = useIdentity();
  let status = "session_off";
  let detail = `Inicia sesión en la franja de sesión (tecla ${SESSION_SHORTCUT}).`;
  if (token && identity.data) {
    status = "session_on";
    const me = identity.data;
    detail =
      me.kind === "tenant" ? `${me.role} en el tenant ${me.tenantId}` : "platform, sin clínica";
  } else if (token && identity.isError) {
    status = "session_rejected";
    detail = "El backend rechazó la sesión. Ciérrala y vuelve a iniciarla.";
  } else if (token) {
    detail = "Verificando la sesión con /me…";
  }
  return (
    <div className="departure">
      <span className="departure-key">{SESSION_SHORTCUT}</span>
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
        {PLATFORMS.map((item) => (
          <Link key={item.href} href={item.href} className="departure">
            <span className="departure-key">{item.key}</span>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <span className="departure-roles">{item.roles}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
