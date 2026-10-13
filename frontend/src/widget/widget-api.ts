import {
  getWidgetConversation,
  openWidgetSession,
  refreshWidgetSession,
  sendWidgetMessage,
} from "./api/endpoints";
import type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  ConversationTurn,
  WidgetSession,
} from "./api/models";
import type { WidgetRequestInit } from "./fetcher";

export type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  ConversationTurn,
  WidgetSession,
};

export type WidgetConfig = {
  /** Origen del backend alcanzable desde el navegador, sin barra final. */
  readonly apiBase: string;
  /** Clave pública del widget: resuelve el tenant en el backend. */
  readonly widgetKey: string;
};

/** Puerto del chat: lo único que el resto del núcleo sabe del HTTP. */
export type WidgetApi = {
  openSession(idempotencyKey: string): Promise<WidgetSession>;
  refreshSession(token: string, idempotencyKey: string): Promise<WidgetSession>;
  getConversation(token: string): Promise<ConversationHistory>;
  sendMessage(
    token: string,
    input: ConversationMessageInput,
    idempotencyKey: string,
  ): Promise<ConversationTurn>;
};

const IDEMPOTENCY_HEADER = "Idempotency-Key";

function requestInit(apiBase: string, token?: string, idempotencyKey?: string): WidgetRequestInit {
  return {
    apiBase,
    ...(token ? { token } : {}),
    ...(idempotencyKey ? { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } } : {}),
  };
}

export function createWidgetApi({ apiBase, widgetKey }: WidgetConfig): WidgetApi {
  return {
    openSession: (key) =>
      openWidgetSession({ widget_key: widgetKey }, requestInit(apiBase, undefined, key)),
    refreshSession: (token, key) => refreshWidgetSession(requestInit(apiBase, token, key)),
    getConversation: (token) => getWidgetConversation(requestInit(apiBase, token)),
    sendMessage: (token, input, key) => sendWidgetMessage(input, requestInit(apiBase, token, key)),
  };
}
