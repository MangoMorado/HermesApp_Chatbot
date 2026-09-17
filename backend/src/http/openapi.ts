import { ERROR_CODES, STATUS_BY_CODE } from "./error-codes";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * Fuente unica del contrato REST. `npm run openapi:generate` la vuelca en
 * `openapi.json`, y la suite `contrato-api` verifica que no haya rutas fuera.
 * Toda ruta nueva de /api/v1 se declara aqui en la misma PR.
 */

const REQUEST_ID_PARAMETER = {
  name: REQUEST_ID_HEADER,
  in: "header",
  required: false,
  description: "Identificador de correlacion. Si no viene, el servicio genera uno.",
  schema: { type: "string", maxLength: 128 },
} as const;

const REQUEST_ID_RESPONSE_HEADER = {
  [REQUEST_ID_HEADER]: {
    description: "Identificador de correlacion de esta peticion.",
    schema: { type: "string" },
  },
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

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — API REST",
      version: "0.1.0",
      description:
        "Superficie REST para widget, panel y chat. La integracion con Hermes vive en /fhir " +
        "y no se describe aqui: usa OperationOutcome, no esta envoltura de errores.",
    },
    servers: [{ url: "/api/v1" }],
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
        Health: {
          type: "object",
          required: ["status", "checkedAt"],
          properties: {
            status: { type: "string", enum: ["ok"] },
            checkedAt: { type: "string", format: "date-time" },
          },
        },
        Identity: {
          type: "object",
          required: ["subject", "tenant_id", "role"],
          properties: {
            subject: { type: "string" },
            tenant_id: { type: "string" },
            role: { type: "string", enum: ["widget", "operator", "admin", "service"] },
            session_id: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Comprueba que el servicio responde",
          security: [],
          parameters: [REQUEST_ID_PARAMETER],
          responses: {
            "200": {
              description: "El servicio responde",
              headers: REQUEST_ID_RESPONSE_HEADER,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Health" } },
              },
            },
            ...errorResponses(["internal_error"]),
          },
        },
      },
      "/me": {
        get: {
          operationId: "getIdentity",
          summary: "Identidad efectiva del token",
          description: "El tenant sale del claim del token, nunca de la peticion.",
          security: [{ bearerAuth: [] }],
          parameters: [REQUEST_ID_PARAMETER],
          responses: {
            "200": {
              description: "Identidad del portador",
              headers: REQUEST_ID_RESPONSE_HEADER,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Identity" } },
              },
            },
            ...errorResponses(["unauthorized", "forbidden", "internal_error"]),
          },
        },
      },
    },
  };
}
