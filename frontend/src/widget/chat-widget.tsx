"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatInputMode, ChatMessage, ChatView } from "./chat-client";
import type { Failure } from "./failure";
import { type Settled, shouldFocus } from "./settled";
import { WIDGET_CSS } from "./styles";
import { useChat } from "./use-chat";
import type { ConversationOption, WidgetConfig } from "./widget-api";

/** Tope del contrato para el texto de un turno (`ConversationMessageInput.text`). */
const MAX_TEXT_LENGTH = 500;

export type ChatWidgetProps = WidgetConfig & { readonly mode: "floating" | "fill" };

function MessageList({
  messages,
  loading,
}: {
  readonly messages: readonly ChatMessage[];
  readonly loading: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  const count = messages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: baja al final cada vez que llega un mensaje
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return (
    <ol className="iw-log" aria-live="polite" aria-label="Conversación">
      {messages.map((message) => (
        <li key={message.id} className="iw-msg" data-author={message.author}>
          {message.text}
        </li>
      ))}
      {loading ? <li className="iw-status">Cargando…</li> : null}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

function InputForm({
  mode,
  disabled,
  onSubmit,
}: {
  readonly mode: Exclude<ChatInputMode, "none">;
  readonly disabled: boolean;
  readonly onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="iw-form"
      action={() => {
        const value = draft.trim();
        if (value) {
          onSubmit(value);
        }
      }}
    >
      <input
        className="iw-input"
        type={mode === "date" ? "date" : "text"}
        aria-label={mode === "date" ? "Fecha" : "Tu respuesta"}
        autoComplete="off"
        maxLength={MAX_TEXT_LENGTH}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="iw-send" disabled={disabled || !draft.trim()}>
        Enviar
      </button>
    </form>
  );
}

function Controls({
  view,
  settled,
  disabled,
  onChoose,
  onSubmit,
}: {
  readonly view: ChatView;
  readonly settled: Settled | null;
  readonly disabled: boolean;
  readonly onChoose: (option: ConversationOption) => void;
  readonly onSubmit: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(settled?.seq ?? 0);
  // El foco vuelve al primer control tras un envío resuelto (también `invalid`); nunca por la
  // carga inicial ni por recargar, para no robárselo a la página.
  useEffect(() => {
    if (shouldFocus(settled, seen.current)) {
      seen.current = settled?.seq ?? 0;
      box.current?.querySelector<HTMLElement>("input, button")?.focus();
    }
  }, [settled]);
  return (
    <div className="iw-controls" ref={box}>
      {view.input === "none" ? null : (
        <InputForm
          key={settled?.turns ?? 0}
          mode={view.input}
          disabled={disabled}
          onSubmit={onSubmit}
        />
      )}
      {view.options.length > 0 ? (
        <div className="iw-options">
          {view.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="iw-option"
              disabled={disabled}
              onClick={() => onChoose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FailureBox({
  failure,
  onRetry,
}: {
  readonly failure: Failure;
  readonly onRetry: () => void;
}) {
  const [waiting, setWaiting] = useState(failure.waitSeconds > 0);
  useEffect(() => {
    if (failure.waitSeconds <= 0) {
      return;
    }
    const timer = setTimeout(() => setWaiting(false), failure.waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [failure.waitSeconds]);
  return (
    <div className="iw-failure" role="alert">
      <span>{failure.text}</span>
      {failure.terminal ? null : (
        <button type="button" className="iw-retry" disabled={waiting} onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

function ChatPanel({
  config,
  onClose,
}: {
  readonly config: WidgetConfig;
  readonly onClose?: () => void;
}) {
  const chat = useChat(config);
  const { state } = chat;
  return (
    <section className="iw-panel" aria-label="Chat de atención">
      <header className="iw-head">
        <strong>Asistente virtual</strong>
        {onClose ? (
          <button type="button" className="iw-close" onClick={onClose} aria-label="Cerrar chat">
            ×
          </button>
        ) : null}
      </header>
      <MessageList messages={state.view.messages} loading={state.phase === "loading"} />
      {state.notice ? (
        <p className="iw-notice" role="status">
          {state.notice}
        </p>
      ) : null}
      {state.failure ? (
        <FailureBox key={state.failure.text} failure={state.failure} onRetry={chat.retry} />
      ) : (
        <Controls
          view={state.view}
          settled={state.settled}
          disabled={state.phase !== "ready"}
          onChoose={chat.choose}
          onSubmit={chat.submit}
        />
      )}
    </section>
  );
}

function Floating({ config }: { readonly config: WidgetConfig }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      {open ? (
        <div className="iw-popup">
          <ChatPanel config={config} onClose={() => setOpen(false)} />
        </div>
      ) : null}
      <button
        type="button"
        className="iw-launcher"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Cerrar chat" : "Chat"}
      </button>
    </>
  );
}

/**
 * Widget del chat. Pinta solo lo que el backend devuelve; no decide ningún paso del flujo.
 * Crea su cliente una vez: para otra clave u otra sesión, el padre lo remonta con otra `key`.
 */
export function ChatWidget({ mode, apiBase, widgetKey }: ChatWidgetProps) {
  const config: WidgetConfig = { apiBase, widgetKey };
  return (
    <div className="iw-root" data-mode={mode}>
      <style>{WIDGET_CSS}</style>
      {mode === "floating" ? <Floating config={config} /> : <ChatPanel config={config} />}
    </div>
  );
}
