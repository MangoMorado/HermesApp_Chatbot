import {
  authErrors,
  createdJson,
  errorResponses,
  IDEMPOTENCY_PARAMETER,
  okJson,
  pageParams,
  REQUEST_ID_PARAMETER,
  REQUEST_ID_RESPONSE_HEADER,
  writeErrors,
} from "./openapi-shared";

/** Rutas de /api/v1 de la Fase 3 (config del bot, KB y sesiones del widget). */
const bearer = [{ bearerAuth: [] }];
const nullableKey = { oneOf: [{ $ref: "#/components/schemas/WidgetKey" }, { type: "null" }] };
const ID_PARAMETER = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

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
  KnowledgeEntry: {
    type: "object",
    required: ["id", "category", "question", "answer", "detail", "keywords", "position", "active"],
    properties: {
      id: { type: "string" },
      category: { type: "string", maxLength: 60 },
      question: { type: "string", maxLength: 200 },
      answer: { type: "string", maxLength: 1000 },
      detail: { type: ["string", "null"], maxLength: 4000 },
      keywords: { type: "array", maxItems: 20, items: { type: "string" } },
      position: { type: "integer", minimum: 0 },
      active: { type: "boolean" },
    },
  },
  KnowledgeEntryInput: {
    type: "object",
    properties: {
      category: { type: "string", minLength: 1, maxLength: 60 },
      question: { type: "string", minLength: 1, maxLength: 200 },
      answer: { type: "string", minLength: 1, maxLength: 1000 },
      detail: { type: ["string", "null"], maxLength: 4000 },
      keywords: { type: "array", items: { type: "string" } },
      position: { type: "integer", minimum: 0 },
      active: { type: "boolean" },
    },
  },
  WidgetSessionRequest: {
    type: "object",
    required: ["widget_key"],
    properties: { widget_key: { type: "string" } },
  },
  WidgetSession: {
    type: "object",
    required: ["session_id", "token", "expires_at"],
    properties: {
      session_id: { type: "string" },
      token: { type: "string" },
      expires_at: { type: "string", format: "date-time" },
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
  "/knowledge-entries": {
    get: {
      operationId: "listKnowledgeEntries",
      security: bearer,
      parameters: [
        REQUEST_ID_PARAMETER,
        ...pageParams,
        { name: "category", in: "query", schema: { type: "string" } },
        { name: "active", in: "query", schema: { type: "boolean" } },
      ],
      responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
    },
    post: {
      operationId: "createKnowledgeEntry",
      description: "category, question y answer son obligatorios. Maximo 500 entradas por tenant.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/KnowledgeEntryInput" } },
        },
      },
      responses: {
        ...createdJson({ $ref: "#/components/schemas/KnowledgeEntry" }),
        ...writeErrors,
      },
    },
  },
  "/knowledge-entries/{id}": {
    get: {
      operationId: "getKnowledgeEntry",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, ID_PARAMETER],
      responses: { ...okJson({ $ref: "#/components/schemas/KnowledgeEntry" }), ...authErrors },
    },
    patch: {
      operationId: "updateKnowledgeEntry",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER, ID_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/KnowledgeEntryInput" } },
        },
      },
      responses: { ...okJson({ $ref: "#/components/schemas/KnowledgeEntry" }), ...writeErrors },
    },
    delete: {
      operationId: "deleteKnowledgeEntry",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER, ID_PARAMETER],
      responses: {
        ...okJson({ type: "object", properties: { deleted: { type: "boolean" } } }),
        ...writeErrors,
      },
    },
  },
  "/widget/sessions": {
    post: {
      tags: ["widget"],
      operationId: "openWidgetSession",
      description:
        "Publica: la clave del widget resuelve el tenant. Exige cabecera Origin permitida e " +
        "Idempotency-Key de al menos 32 caracteres (secreto del cliente: no se registra).",
      security: [],
      parameters: [
        REQUEST_ID_PARAMETER,
        { ...IDEMPOTENCY_PARAMETER, schema: { type: "string", minLength: 32 } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/WidgetSessionRequest" } },
        },
      },
      responses: {
        ...createdJson({ $ref: "#/components/schemas/WidgetSession" }),
        ...errorResponses([
          "unauthorized",
          "forbidden",
          "validation_failed",
          "conflict",
          "internal_error",
        ]),
        "429": {
          description: "rate_limited",
          headers: {
            ...REQUEST_ID_RESPONSE_HEADER,
            "Retry-After": {
              description: "Segundos a esperar antes de reintentar.",
              schema: { type: "integer" },
            },
          },
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Error" } },
          },
        },
      },
    },
  },
  "/widget/sessions/refresh": {
    post: {
      tags: ["widget"],
      operationId: "refreshWidgetSession",
      description: "Solo rol widget: renueva la sesion de su propio token.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      responses: { ...okJson({ $ref: "#/components/schemas/WidgetSession" }), ...writeErrors },
    },
  },
};
