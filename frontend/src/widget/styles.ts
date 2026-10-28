/**
 * Estilos del widget como cadena: el mismo `<style>` sirve dentro del Shadow DOM del script
 * y en las páginas del frontend. Prefijo `iw-`, sin fuentes externas ni dependencia de
 * `globals.css`. Morado de marca Ingenius360 sobre superficie clara.
 */
export const WIDGET_CSS = `
.iw-root {
  --iw-accent: #7336f2;
  --iw-accent-hi: #5f25d9;
  --iw-ink: #1d1840;
  --iw-ink-2: #5b557a;
  --iw-ground: #ffffff;
  --iw-soft: #f3f0fc;
  --iw-rule: #ddd6f3;
  --iw-danger: #a3261f;
  box-sizing: border-box;
  color: var(--iw-ink);
  font: 400 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.iw-root *, .iw-root *::before, .iw-root *::after { box-sizing: inherit; }
.iw-root[data-mode="fill"] { height: 100%; }
.iw-root[data-mode="floating"] {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  display: grid;
  justify-items: end;
  gap: 12px;
}
.iw-popup {
  width: min(380px, calc(100vw - 24px));
  height: min(600px, calc(100dvh - 96px));
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(29, 24, 64, 0.28);
}
.iw-launcher, .iw-send, .iw-retry {
  border: 0;
  border-radius: 999px;
  background: var(--iw-accent);
  color: #ffffff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.iw-launcher { min-height: 48px; padding: 0 20px; box-shadow: 0 6px 20px rgba(29, 24, 64, 0.3); }
.iw-send, .iw-retry { min-height: 40px; padding: 0 16px; }
.iw-launcher:hover, .iw-send:hover, .iw-retry:hover { background: var(--iw-accent-hi); }
.iw-panel { display: flex; flex-direction: column; height: 100%; background: var(--iw-ground); }
.iw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--iw-accent);
  color: #ffffff;
}
.iw-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.iw-close:hover { background: rgba(255, 255, 255, 0.18); }
.iw-log {
  flex: 1 1 0;
  min-height: 0;
  margin: 0;
  padding: 16px;
  overflow-y: auto;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.iw-msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.iw-msg[data-author="bot"] { align-self: flex-start; background: var(--iw-soft); }
.iw-msg[data-author="patient"] {
  align-self: flex-end;
  background: var(--iw-accent);
  color: #ffffff;
}
.iw-status { color: var(--iw-ink-2); }
.iw-notice, .iw-failure { display: block; margin: 0; padding: 8px 16px; font-size: 14px; }
.iw-notice { background: var(--iw-soft); color: var(--iw-ink-2); }
.iw-failure { display: grid; gap: 8px; justify-items: start; color: var(--iw-danger); }
.iw-controls { display: grid; gap: 8px; padding: 12px 16px 16px; border-top: 1px solid var(--iw-rule); }
.iw-options { display: flex; flex-wrap: wrap; gap: 8px; }
.iw-option {
  min-height: 40px;
  padding: 6px 14px;
  border: 1px solid var(--iw-accent);
  border-radius: 999px;
  background: var(--iw-ground);
  color: var(--iw-accent);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.iw-option:hover { background: var(--iw-soft); }
.iw-form { display: flex; gap: 8px; }
.iw-input {
  flex: 1 1 0;
  min-width: 0;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--iw-rule);
  border-radius: 10px;
  background: var(--iw-ground);
  color: var(--iw-ink);
  font: inherit;
}
.iw-root button:disabled, .iw-input:disabled { opacity: 0.55; cursor: not-allowed; }
.iw-root :focus-visible { outline: 2px solid var(--iw-ink); outline-offset: 2px; }
.iw-head :focus-visible { outline-color: #ffffff; }
`;
