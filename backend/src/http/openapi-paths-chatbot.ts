import {
  authErrors,
  IDEMPOTENCY_PARAMETER,
  okJson,
  REQUEST_ID_PARAMETER,
  writeErrors,
} from "./openapi-shared";

/** Rutas de /api/v1 de la Fase 3 (config del bot, KB y sesiones del widget). */
const bearer = [{ bearerAuth: [] }];
const nullableKey = { oneOf: [{ $ref: "#/components/schemas/WidgetKey" }, { type: "null" }] };

export const CHATBOT_SCHEMAS = {
  WidgetKey: {
    type: "object",
    required: ["key", "created_at", "grace_until"],
    properties: {
      key: { type: "string" },
      created_at: { type: "string", format: "date-time" },
      grace_until: { type: ["string", "null"], format: "date-time" },
    },
  },
  BotConfig: {
    type: "object",
    required: ["texts", "params", "allowed_origins", "widget_keys"],
    properties: {
      texts: {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["value", "overridden"],
          properties: { value: { type: "string" }, overridden: { type: "boolean" } },
        },
      },
      params: { type: "object", additionalProperties: { type: "integer" } },
      allowed_origins: { type: "array", items: { type: "string" } },
      widget_keys: {
        type: "object",
        required: ["current", "grace"],
        properties: { current: nullableKey, grace: nullableKey },
      },
    },
  },
  BotConfigPatch: {
    type: "object",
    additionalProperties: false,
    properties: {
      texts: { type: "object", additionalProperties: { type: ["string", "null"] } },
      params: { type: "object", additionalProperties: { type: ["integer", "null"] } },
      allowed_origins: { type: "array", maxItems: 20, items: { type: "string" } },
    },
  },
} as const;

const botConfigOk = okJson({ $ref: "#/components/schemas/BotConfig" });

export const CHATBOT_PATHS = {
  "/bot-config": {
    get: {
      operationId: "getBotConfig",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER],
      responses: { ...botConfigOk, ...authErrors },
    },
    patch: {
      operationId: "updateBotConfig",
      description: "Parche parcial. Un texto o param en null vuelve al predeterminado.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/BotConfigPatch" } },
        },
      },
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
  "/bot-config/widget-keys/rotate": {
    post: {
      operationId: "rotateWidgetKey",
      description:
        "Crea una clave vigente; la anterior queda en gracia widget_key_grace_hours y la que ya " +
        "estaba en gracia deja de valer.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
};
