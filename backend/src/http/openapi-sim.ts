import { ERROR_CODES, STATUS_BY_CODE } from "./error-codes";
import { REQUEST_ID_HEADER } from "./request-id";

const REQUEST_ID_PARAMETER = {
  name: REQUEST_ID_HEADER,
  in: "header",
  required: false,
  schema: { type: "string", maxLength: 128 },
} as const;

const IDEMPOTENCY_PARAMETER = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 1 },
} as const;

const REQUEST_ID_RESPONSE_HEADER = {
  [REQUEST_ID_HEADER]: { schema: { type: "string" } },
} as const;

function errorResponses(codes: readonly string[]): Record<string, unknown> {
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

const writeErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "internal_error",
]);

const readErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "internal_error",
]);

function crudPaths(resource: string, operationBase: string): Record<string, unknown> {
  return {
    [`/${resource}`]: {
      get: {
        operationId: `list${operationBase}`,
        security: [{ bearerAuth: [] }],
        parameters: [REQUEST_ID_PARAMETER],
        responses: {
          "200": {
            description: "OK",
            headers: REQUEST_ID_RESPONSE_HEADER,
            content: { "application/json": { schema: { type: "object" } } },
          },
          ...readErrors,
        },
      },
      post: {
        operationId: `create${operationBase}`,
        security: [{ bearerAuth: [] }],
        parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
        responses: {
          "200": {
            description: "OK",
            headers: REQUEST_ID_RESPONSE_HEADER,
            content: { "application/json": { schema: { type: "object" } } },
          },
          ...writeErrors,
        },
      },
    },
    [`/${resource}/{id}`]: {
      get: {
        operationId: `get${operationBase}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_PARAMETER,
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            headers: REQUEST_ID_RESPONSE_HEADER,
            content: { "application/json": { schema: { type: "object" } } },
          },
          ...readErrors,
        },
      },
      patch: {
        operationId: `update${operationBase}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_PARAMETER,
          IDEMPOTENCY_PARAMETER,
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            headers: REQUEST_ID_RESPONSE_HEADER,
            content: { "application/json": { schema: { type: "object" } } },
          },
          ...writeErrors,
        },
      },
      delete: {
        operationId: `delete${operationBase}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_PARAMETER,
          IDEMPOTENCY_PARAMETER,
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            headers: REQUEST_ID_RESPONSE_HEADER,
            content: { "application/json": { schema: { type: "object" } } },
          },
          ...writeErrors,
        },
      },
    },
  };
}

/** Contrato del simulador Hermes (`/api/sim/v1`). */
export function buildSimOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — Simulador Hermes",
      version: "0.2.0",
      description: "CRUD de maestros del simulador. Apagable con HERMES_SIMULATOR_ENABLED.",
    },
    servers: [{ url: "/api/sim/v1" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Error: {
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
        },
      },
    },
    paths: {
      ...crudPaths("practitioners", "SimPractitioner"),
      ...crudPaths("healthcare-services", "SimHealthcareService"),
      ...crudPaths("schedules", "SimSchedule"),
      ...crudPaths("patients", "SimPatient"),
      "/schedules/{id}/slots/generate": {
        post: {
          operationId: "generateSimSlots",
          summary: "Genera cupos (equivalente a slots:generate de la spec)",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            IDEMPOTENCY_PARAMETER,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "OK",
              headers: REQUEST_ID_RESPONSE_HEADER,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["created"],
                    properties: { created: { type: "integer" } },
                  },
                },
              },
            },
            ...writeErrors,
          },
        },
      },
    },
  };
}
