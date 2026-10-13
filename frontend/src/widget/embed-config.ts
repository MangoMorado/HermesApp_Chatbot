import type { WidgetConfig } from "./widget-api";

/** Id del elemento anfitrión: su presencia indica que el widget ya está montado. */
export const HOST_ID = "ingenius360-widget";

export type EmbedDataset = { readonly key?: string; readonly api?: string };

function backendOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Lee `data-key` y `data-api` del `<script>`; `null` si falta alguno o el backend no es http(s). */
export function readEmbedConfig(dataset: EmbedDataset): WidgetConfig | null {
  const widgetKey = dataset.key?.trim() ?? "";
  const apiBase = backendOrigin(dataset.api?.trim() ?? "");
  return widgetKey && apiBase ? { apiBase, widgetKey } : null;
}

/** El fragmento pegado dos veces (plantilla + gestor de etiquetas) monta un solo widget. */
export function alreadyMounted(doc: Pick<Document, "getElementById">): boolean {
  return doc.getElementById(HOST_ID) !== null;
}
