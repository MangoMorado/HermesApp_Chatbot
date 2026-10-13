"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatClient,
  type ChatView,
  createChatClient,
  EMPTY_VIEW,
  type Outgoing,
  type SendOutcome,
} from "./chat-client";
import { describeFailure, type Failure } from "./failure";
import { browserStorage, createSessionManager } from "./session";
import { type ConversationOption, createWidgetApi, type WidgetConfig } from "./widget-api";

export type ChatState = {
  readonly phase: "loading" | "ready" | "sending" | "failed";
  readonly view: ChatView;
  /** Aviso del turno (dato inválido, opción caducada, sesión vencida). */
  readonly notice: string | null;
  readonly failure: Failure | null;
};

const INITIAL: ChatState = { phase: "loading", view: EMPTY_VIEW, notice: null, failure: null };

const NOTICES = {
  stale: "Esa opción ya no estaba vigente. Estas son las opciones actuales.",
  reopened: "La sesión venció. Empezamos de nuevo.",
} as const;

function buildClient(config: WidgetConfig): ChatClient {
  const api = createWidgetApi(config);
  const newKey = () => crypto.randomUUID();
  const session = createSessionManager({
    api,
    widgetKey: config.widgetKey,
    storage: browserStorage(),
    now: () => Date.now(),
    newKey,
  });
  return createChatClient({ api, session, newKey });
}

function afterSend(outcome: SendOutcome, previous: ChatView): ChatState {
  if (outcome.kind === "invalid") {
    return { phase: "ready", view: previous, notice: outcome.message, failure: null };
  }
  const notice = outcome.kind === "turn" ? null : NOTICES[outcome.kind];
  return { phase: "ready", view: outcome.view, notice, failure: null };
}

/** Estado de React sobre el cliente del chat. El cliente se crea una vez por montaje. */
export function useChat(config: WidgetConfig) {
  const [client] = useState(() => buildClient(config));
  const [state, setState] = useState<ChatState>(INITIAL);
  const lastSend = useRef<Outgoing | null>(null);

  const fail = useCallback((error: unknown) => {
    setState((s) => ({ ...s, phase: "failed", failure: describeFailure(error) }));
  }, []);

  const load = useCallback(async () => {
    lastSend.current = null;
    setState((s) => ({ ...s, phase: "loading", failure: null }));
    try {
      const view = await client.load();
      setState({ phase: "ready", view, notice: null, failure: null });
    } catch (error) {
      fail(error);
    }
  }, [client, fail]);

  const send = useCallback(
    async (outgoing: Outgoing) => {
      lastSend.current = outgoing;
      setState((s) => ({ ...s, phase: "sending", notice: null, failure: null }));
      try {
        const outcome = await client.send(outgoing);
        lastSend.current = null;
        setState((s) => afterSend(outcome, s.view));
      } catch (error) {
        fail(error);
      }
    },
    [client, fail],
  );

  useEffect(() => {
    load();
  }, [load]);

  return {
    state,
    choose: (option: ConversationOption) => {
      send({ kind: "option", option });
    },
    submit: (text: string) => {
      send({ kind: "text", text });
    },
    /** Repite el envío que falló (misma `Idempotency-Key`) o, si falló la carga, recarga. */
    retry: () => {
      if (lastSend.current) {
        send(lastSend.current);
      } else {
        load();
      }
    },
  };
}
