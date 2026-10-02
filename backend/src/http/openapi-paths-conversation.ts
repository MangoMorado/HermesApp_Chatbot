import { IDEMPOTENCY_PARAMETER, okJson, REQUEST_ID_PARAMETER, writeErrors } from "./openapi-shared";

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
} as const;

export const CONVERSATION_PATHS = {
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
