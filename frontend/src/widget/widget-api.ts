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
  WidgetSessionOpened,
  WidgetSessionRefreshed,
} from "./api/models";
import type { WidgetRequestInit } from "./fetcher";

export type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  ConversationTurn,
  WidgetSessionOpened,
  WidgetSessionRefreshed,
};

export type WidgetConfig = {
  /** Origen del backend alcanzable desde el navegador, sin barra final. */
  readonly apiBase: string;
  /** Clave pública del widget: resuelve el tenant en el backend. */
  readonly widgetKey: string;
};

/** Lo que identifica la conversación: token del proveedor y secreto propio de la conversación. */
export type WidgetCredentials = {
  readonly accessToken: string;
  readonly conversationSecret: string;
};

/** Puerto del chat: lo único que el resto del núcleo sabe del HTTP. */
export type WidgetApi = {
  openSession(idempotencyKey: string): Promise<WidgetSessionOpened>;
  /** Pública: sin bearer, con la clave del widget y el secreto de la conversación. */
  refreshSession(
    conversationSecret: string,
    idempotencyKey: string,
  ): Promise<WidgetSessionRefreshed>;
  getConversation(credentials: WidgetCredentials): Promise<ConversationHistory>;
  sendMessage(
    credentials: WidgetCredentials,
    input: ConversationMessageInput,
    idempotencyKey: string,
  ): Promise<ConversationTurn>;
};

const IDEMPOTENCY_HEADER = "Idempotency-Key";
const CONVERSATION_SECRET_HEADER = "X-Conversation-Secret";

type Call = {
  readonly token?: string;
  readonly conversationSecret?: string;
  readonly idempotencyKey?: string;
};

function requestInit(apiBase: string, call: Call = {}): WidgetRequestInit {
  const headers: Record<string, string> = {};
  if (call.idempotencyKey) {
    headers[IDEMPOTENCY_HEADER] = call.idempotencyKey;
  }
  if (call.conversationSecret) {
    headers[CONVERSATION_SECRET_HEADER] = call.conversationSecret;
  }
  return { apiBase, ...(call.token ? { token: call.token } : {}), headers };
}

function conversationCall(credentials: WidgetCredentials, idempotencyKey?: string): Call {
  return {
    token: credentials.accessToken,
    conversationSecret: credentials.conversationSecret,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export function createWidgetApi({ apiBase, widgetKey }: WidgetConfig): WidgetApi {
  return {
    openSession: (key) =>
      openWidgetSession({ widget_key: widgetKey }, requestInit(apiBase, { idempotencyKey: key })),
    refreshSession: (conversationSecret, key) =>
      refreshWidgetSession(
        { widget_key: widgetKey },
        requestInit(apiBase, { conversationSecret, idempotencyKey: key }),
      ),
    getConversation: (credentials) =>
      getWidgetConversation(requestInit(apiBase, conversationCall(credentials))),
    sendMessage: (credentials, input, key) =>
      sendWidgetMessage(input, requestInit(apiBase, conversationCall(credentials, key))),
  };
}
