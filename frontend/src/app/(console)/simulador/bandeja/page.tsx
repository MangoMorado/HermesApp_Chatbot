import type { Metadata } from "next";
import { InboxBoard } from "@/components/simulador/inbox-board";

export const metadata: Metadata = { title: "Bandeja" };

export default function BandejaPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bandeja del simulador</h1>
          <p>
            Solicitudes de pre-agenda que el chat originó. Aprobar confirma la cita en el simulador
            de Hermes; rechazar libera el cupo. Rol admin; se apaga en producción.
          </p>
        </div>
      </div>
      <InboxBoard />
    </>
  );
}
