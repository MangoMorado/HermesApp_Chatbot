import { WidgetApiError } from "./fetcher";
import type { SessionManager } from "./session";
import type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  WidgetApi,
  WidgetCredentials,
} from "./widget-api";

export type ChatMessage = {
  readonly id: string;
  readonly author: "bot" | "patient";
  readonly text: string;
};
export type ChatInputMode = "none" | "text" | "date";
export type ChatView = {
  readonly messages: readonly ChatMessage[];
  readonly options: readonly ConversationOption[];
  readonly input: ChatInputMode;
};
export const EMPTY_VIEW: ChatView = { messages: [], options: [], input: "none" };

export type Outgoing =
  | { readonly kind: "option"; readonly option: ConversationOption }
  | { readonly kind: "text"; readonly text: string };

export type SendOutcome =
  | { readonly kind: "turn" | "stale" | "reopened"; readonly view: ChatView }
  | { readonly kind: "invalid"; readonly message: string };

export type ChatClient = {
  view(): ChatView;
  load(): Promise<ChatView>;
  send(outgoing: Outgoing): Promise<SendOutcome>;
  restart(): Promise<ChatView>;
};

export type ChatDeps = {
  readonly api: WidgetApi;
  readonly session: SessionManager;
  readonly newKey: () => string;
};

type Line = Omit<ChatMessage, "id">;

/** El id es la posición en la lista: estable mientras la conversación solo crece. */
function numbered(lines: readonly Line[]): ChatMessage[] {
  return lines.map((line, index) => ({ ...line, id: `m${index}` }));
}

function toView(history: ConversationHistory): ChatView {
  const lines = history.messages.map((m): Line => ({ author: m.author, text: m.text }));
  return { messages: numbered(lines), options: history.options, input: history.input };
}

/** `401`: el token ya no sirve, pero la conversación puede seguir viva (se renueva). */
function tokenRejected(error: unknown): boolean {
  return error instanceof WidgetApiError && error.status === 401;
}

/** `404` (conversación vencida o desconocida), o un `401` tras renovar: se abre otra. */
function isLost(error: unknown): boolean {
  return error instanceof WidgetApiError && (error.status === 401 || error.status === 404);
}

export function createChatClient(deps: ChatDeps): ChatClient {
  let current: ChatView = EMPTY_VIEW;
  let pending: { readonly signature: string; readonly key: string } | null = null;
  let sending: Promise<SendOutcome> | null = null;

  /** Un `401` renueva el token con el secreto (misma conversación); un `404` abre otra. */
  async function history(retry = true): Promise<ConversationHistory> {
    try {
      return await deps.api.getConversation(await deps.session.credentials());
    } catch (error) {
      if (retry && tokenRejected(error)) {
        await deps.session.renew();
        return history(false);
      }
      if (retry && isLost(error)) {
        await deps.session.reopen();
        return history(false);
      }
      throw error;
    }
  }

  async function reload(): Promise<ChatView> {
    current = toView(await history());
    return current;
  }

  /** Misma clave mientras el mismo envío no haya tenido respuesta del backend. */
  function keyFor(body: ConversationMessageInput): string {
    const signature = JSON.stringify(body);
    if (pending?.signature !== signature) {
      pending = { signature, key: deps.newKey() };
    }
    return pending.key;
  }

  /** El eco sale siempre de lo que el backend guardó (redactado o enmascarado), no de lo enviado. */
  async function echoOf(): Promise<Line[]> {
    try {
      const messages = (await history()).messages;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.author === "patient") {
          return [{ author: "patient", text: message.text }];
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  async function recover(error: unknown): Promise<SendOutcome> {
    if (!(error instanceof WidgetApiError) || error.retryable) {
      throw error;
    }
    pending = null;
    if (error.status === 409 && error.reason === "stale_option") {
      return { kind: "stale", view: await reload() };
    }
    if (isLost(error)) {
      await deps.session.reopen();
      return { kind: "reopened", view: await reload() };
    }
    if (error.status === 422) {
      return { kind: "invalid", message: error.message };
    }
    throw error;
  }

  /** Conversación vencida en local: igual que un `404`, sin enviar el turno a una nueva. */
  async function reopenExpired(): Promise<SendOutcome> {
    pending = null;
    await deps.session.reopen();
    return { kind: "reopened", view: await reload() };
  }

  /**
   * Tras un `401` al enviar: se renueva el token. Si la conversación es la misma, el turno se
   * reenvía una vez con la misma `Idempotency-Key`; si hubo que abrir otra, se avisa.
   */
  async function afterRenew(outgoing: Outgoing, used: WidgetCredentials): Promise<SendOutcome> {
    const renewed = await deps.session.renew();
    if (renewed.conversationSecret === used.conversationSecret) {
      return deliver(outgoing, true);
    }
    pending = null;
    return { kind: "reopened", view: await reload() };
  }

  async function deliver(outgoing: Outgoing, renewed = false): Promise<SendOutcome> {
    if (deps.session.expired()) {
      return reopenExpired();
    }
    const body: ConversationMessageInput =
      outgoing.kind === "option" ? { option_id: outgoing.option.id } : { text: outgoing.text };
    let credentials: WidgetCredentials | null = null;
    try {
      credentials = await deps.session.credentials();
      const turn = await deps.api.sendMessage(credentials, body, keyFor(body));
      pending = null;
      const bot = turn.messages.map((text): Line => ({ author: "bot", text }));
      const lines = [...current.messages, ...(await echoOf()), ...bot];
      current = { messages: numbered(lines), options: turn.options, input: turn.input };
      return { kind: "turn", view: current };
    } catch (error) {
      if (!renewed && credentials && tokenRejected(error)) {
        return afterRenew(outgoing, credentials);
      }
      return recover(error);
    }
  }

  return {
    view: () => current,
    load: reload,
    /** Un envío a la vez: un doble clic recibe la misma promesa, no un segundo turno. */
    send(outgoing) {
      sending ??= deliver(outgoing).finally(() => {
        sending = null;
      });
      return sending;
    },
    restart() {
      deps.session.clear();
      pending = null;
      return reload();
    },
  };
}
