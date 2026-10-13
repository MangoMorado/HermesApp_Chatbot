import type { Metadata } from "next";
import { BotConfigScreen } from "@/components/panel/bot-config-screen";
import { publicBackendUrl } from "@/config/env";

// `PUBLIC_BACKEND_URL` (para los fragmentos de incrustación) se lee en cada petición.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bot" };

export default function BotPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configuración del bot</h1>
          <p>
            Clave del widget, sitios permitidos, parámetros y textos. Lee operator y admin; solo
            admin guarda. Los rangos y formatos los valida el backend.
          </p>
        </div>
      </div>
      <BotConfigScreen apiBase={publicBackendUrl()} />
    </>
  );
}
