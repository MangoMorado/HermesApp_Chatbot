import type { Metadata } from "next";
import { publicBackendUrl } from "@/config/env";
import { ChatWidget } from "@/widget/chat-widget";

// `PUBLIC_BACKEND_URL` se lee en cada petición, no en el build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chat" };

type Props = { searchParams: Promise<{ key?: string | string[] }> };

/** Página para incrustar por iframe: el widget a marco completo, sin cabecera de panel. */
export default async function WidgetPage({ searchParams }: Props) {
  const { key } = await searchParams;
  const widgetKey = (Array.isArray(key) ? key[0] : key)?.trim() ?? "";
  if (!widgetKey) {
    return (
      <main className="embed-frame embed-empty">
        <strong>Falta la clave del widget</strong>
        <span>
          Usa <code>/widget?key=&lt;clave&gt;</code> con la clave vigente del tenant.
        </span>
      </main>
    );
  }
  return (
    <main className="embed-frame">
      <ChatWidget apiBase={publicBackendUrl()} widgetKey={widgetKey} mode="fill" />
    </main>
  );
}
