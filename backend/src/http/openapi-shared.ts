import { ERROR_CODES, STATUS_BY_CODE } from "./error-codes";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * Piezas del contrato OpenAPI compartidas entre `openapi.ts` y los modulos de rutas
 * de fase 3 (`openapi-paths-*.ts`). Extraido de `openapi.ts` sin cambiar valores.
 */

export const REQUEST_ID_PARAMETER = {
  name: REQUEST_ID_HEADER,
  in: "header",
  required: false,
  description: "Identificador de correlacion. Si no viene, el servicio genera uno.",
  schema: { type: "string", maxLength: 128 },
} as const;

export const REQUEST_ID_RESPONSE_HEADER = {
  [REQUEST_ID_HEADER]: {
    description: "Identificador de correlacion de esta peticion.",
    schema: { type: "string" },
  },
} as const;

export const IDEMPOTENCY_PARAMETER = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 1 },
} as const;

/** Secreto propio de la conversacion del widget (spec 5 §6.1). */
export const CONVERSATION_SECRET_PARAMETER = {
  name: "X-Conversation-Secret",
  in: "header",
  required: true,
  description:
    "conversation_secret devuelto por la apertura. Sin el, o con uno vencido o de otra clinica, 404.",
  schema: { type: "string", minLength: 1 },
} as const;

export function errorResponses(codes: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    codes.map((code) => [
      String(STATUS_BY_CODE[code as (typeof ERROR_CODES)[number]]),
      {
        description: code,
        headers: REQUEST_ID_RESPONSE_HEADER,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
    ]),
  );
}

export const pageParams = [
  {
    name: "cursor",
    in: "query",
    required: false,
    schema: { type: "string" },
  },
  {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200 },
  },
] as const;

export function okJson(schema: Record<string, unknown>) {
  return {
    "200": {
      description: "OK",
      headers: REQUEST_ID_RESPONSE_HEADER,
      content: { "application/json": { schema } },
    },
  };
}

export function createdJson(schema: Record<string, unknown>) {
  return {
    "201": {
      description: "Creado",
      headers: REQUEST_ID_RESPONSE_HEADER,
      content: { "application/json": { schema } },
    },
  };
}

export const RATE_LIMITED_RESPONSE = {
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
} as const;

export const authErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "internal_error",
]);

export const writeErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "internal_error",
]);

export const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "request_id"],
      properties: {
        code: { type: "string", enum: [...ERROR_CODES] },
        message: { type: "string" },
        request_id: { type: "string" },
        details: {},
      },
    },
  },
} as const;

export const PAGE_SCHEMA = {
  type: "object",
  required: ["data", "next_cursor"],
  properties: {
    data: { type: "array", items: {} },
    next_cursor: { type: ["string", "null"] },
  },
} as const;
