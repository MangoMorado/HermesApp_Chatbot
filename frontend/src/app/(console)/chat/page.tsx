import type { Metadata } from "next";
import { ChatConsole } from "@/components/chat/chat-console";
import { publicBackendUrl } from "@/config/env";

// `PUBLIC_BACKEND_URL` se lee en cada petición, no en el build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chat</h1>
          <p>
            Consola de pruebas del widget. Habla directo con el backend por CORS, igual que el sitio
            de un tenant: no usa el token del panel, sino una sesión de widget.
          </p>
        </div>
      </div>
      <ChatConsole apiBase={publicBackendUrl()} />
    </>
  );
}
