import { createRoot } from "react-dom/client";
import { ChatWidget } from "./chat-widget";
import { alreadyMounted, HOST_ID, readEmbedConfig } from "./embed-config";

/**
 * Entrada del script incrustable (`widget.js`). El tenant lo pega en su página con
 * `data-key` y `data-api`; el widget se dibuja en un Shadow DOM para que los estilos del
 * sitio y los del widget no se pisen.
 */

// `currentScript` solo existe mientras el script se ejecuta: se lee antes de cualquier espera.
const script = document.currentScript;

function mount(): void {
  const config = readEmbedConfig(script instanceof HTMLScriptElement ? script.dataset : {});
  if (!config) {
    console.error("[Ingenius360] El script del chat necesita data-key y data-api (http o https).");
    return;
  }
  if (alreadyMounted(document)) {
    return;
  }
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);
  createRoot(host.attachShadow({ mode: "open" })).render(
    <ChatWidget {...config} mode="floating" />,
  );
}

if (document.body) {
  mount();
} else {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
}
