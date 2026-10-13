import {
  authErrors,
  IDEMPOTENCY_PARAMETER,
  okJson,
  REQUEST_ID_PARAMETER,
  writeErrors,
} from "./openapi-shared";

/** Rutas de /api/v1 de la Fase 3.3: origenes del widget y conversacion. */
const bearer = [{ bearerAuth: [] }];
const botConfigOk = okJson({ $ref: "#/components/schemas/BotConfig" });

export const CONVERSATION_SCHEMAS = {
  AllowedOriginInput: {
    type: "object",
    required: ["origin"],
    additionalProperties: false,
    properties: { origin: { type: "string", description: "https://host[:puerto]" } },
  },
  ConversationOption: {
    type: "object",
    required: ["id", "label"],
    properties: { id: { type: "string" }, label: { type: "string" } },
  },
  ConversationTurn: {
    type: "object",
    required: ["messages", "options", "input"],
    properties: {
      messages: { type: "array", items: { type: "string" } },
      options: { type: "array", items: { $ref: "#/components/schemas/ConversationOption" } },
      input: { type: "string", enum: ["none", "text", "date"] },
    },
  },
  ConversationHistory: {
    type: "object",
    required: ["messages", "options", "input"],
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          required: ["author", "text", "redacted", "created_at"],
          properties: {
            author: { type: "string", enum: ["bot", "patient"] },
            text: { type: "string" },
            redacted: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
          },
        },
      },
      options: { type: "array", items: { $ref: "#/components/schemas/ConversationOption" } },
      input: { type: "string", enum: ["none", "text", "date"] },
    },
  },
  ConversationMessageInput: {
    type: "object",
    additionalProperties: false,
    description: "Exactamente uno de option_id o text.",
    properties: {
      option_id: { type: "string", maxLength: 64 },
      text: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
} as const;

export const CONVERSATION_PATHS = {
  "/widget/conversation": {
    get: {
      tags: ["widget"],
      operationId: "getWidgetConversation",
      description:
        "Solo rol widget: turno actual e historial redactado de su sesion. Crea la conversacion con la bienvenida si no existe.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER],
      responses: { ...okJson({ $ref: "#/components/schemas/ConversationHistory" }), ...authErrors },
    },
  },
  "/widget/conversation/messages": {
    post: {
      tags: ["widget"],
      operationId: "sendWidgetMessage",
      description:
        "Solo rol widget: un turno. option_id de una opcion vigente (409 stale_option si no) o text donde el turno lo pide.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ConversationMessageInput" } },
        },
      },
      responses: { ...okJson({ $ref: "#/components/schemas/ConversationTurn" }), ...writeErrors },
    },
  },
  "/bot-config/allowed-origins": {
    post: {
      operationId: "addAllowedOrigin",
      description: "Agrega un origen (maximo 20). Si ya esta, responde 200 sin cambios.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AllowedOriginInput" } },
        },
      },
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
  "/bot-config/allowed-origins/{origin}": {
    delete: {
      operationId: "removeAllowedOrigin",
      description: "Quita un origen. El origen va codificado (encodeURIComponent).",
      security: bearer,
      parameters: [
        REQUEST_ID_PARAMETER,
        IDEMPOTENCY_PARAMETER,
        { name: "origin", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
};
