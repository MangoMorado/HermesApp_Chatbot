import { ERROR_CODES, STATUS_BY_CODE } from "./error-codes";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * Fuente unica del contrato REST chatbot. `npm run openapi:generate` la vuelca
 * en `openapi.json`. Toda ruta nueva de /api/v1 se declara aqui en la misma PR.
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

const IDEMPOTENCY_PARAMETER = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 1 },
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

const pageParams = [
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

const rangeParams = [
  { name: "from", in: "query", required: true, schema: { type: "string" } },
  { name: "to", in: "query", required: true, schema: { type: "string" } },
] as const;

function okJson(schema: Record<string, unknown>) {
  return {
    "200": {
      description: "OK",
      headers: REQUEST_ID_RESPONSE_HEADER,
      content: { "application/json": { schema } },
    },
  };
}

const authErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "internal_error",
]);

const writeErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "internal_error",
]);

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — API REST",
      version: "0.2.0",
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
        Page: {
          type: "object",
          required: ["data", "next_cursor"],
          properties: {
            data: { type: "array", items: {} },
            next_cursor: { type: ["string", "null"] },
          },
        },
        TenantSettings: {
          type: "object",
          required: ["max_query_range_days"],
          properties: { max_query_range_days: { type: "integer", minimum: 1, maximum: 366 } },
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
            ...okJson({ $ref: "#/components/schemas/Health" }),
            ...errorResponses(["internal_error"]),
          },
        },
      },
      "/me": {
        get: {
          operationId: "getIdentity",
          summary: "Identidad efectiva del token",
          security: [{ bearerAuth: [] }],
          parameters: [REQUEST_ID_PARAMETER],
          responses: {
            ...okJson({ $ref: "#/components/schemas/Identity" }),
            ...errorResponses(["unauthorized", "forbidden", "internal_error"]),
          },
        },
      },
      "/practitioners": {
        get: {
          operationId: "listPractitioners",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            ...pageParams,
            { name: "active", in: "query", schema: { type: "boolean" } },
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/healthcare-services": {
        get: {
          operationId: "listHealthcareServices",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            ...pageParams,
            { name: "active", in: "query", schema: { type: "boolean" } },
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/schedules": {
        get: {
          operationId: "listSchedules",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            ...pageParams,
            { name: "practitioner_id", in: "query", schema: { type: "string" } },
            { name: "healthcare_service_id", in: "query", schema: { type: "string" } },
            { name: "active", in: "query", schema: { type: "boolean" } },
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/availability": {
        get: {
          operationId: "listAvailability",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            ...rangeParams,
            ...pageParams,
            { name: "healthcare_service_id", in: "query", schema: { type: "string" } },
            { name: "practitioner_id", in: "query", schema: { type: "string" } },
            { name: "schedule_id", in: "query", schema: { type: "string" } },
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/schedules/{id}/slots": {
        get: {
          operationId: "listScheduleSlots",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            ...rangeParams,
            ...pageParams,
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/appointments": {
        get: {
          operationId: "listAppointments",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            { name: "schedule_id", in: "query", required: true, schema: { type: "string" } },
            ...rangeParams,
            ...pageParams,
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/medical-records": {
        get: {
          operationId: "findMedicalRecord",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            { name: "document_type", in: "query", required: true, schema: { type: "string" } },
            { name: "document_number", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { ...okJson({ type: "object" }), ...authErrors },
        },
      },
      "/medical-records/{id}": {
        get: {
          operationId: "getMedicalRecord",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { ...okJson({ type: "object" }), ...authErrors },
        },
      },
      "/medical-records/{id}/appointments": {
        get: {
          operationId: "listMedicalRecordAppointments",
          security: [{ bearerAuth: [] }],
          parameters: [
            REQUEST_ID_PARAMETER,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            ...pageParams,
          ],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
        },
      },
      "/tenant-settings": {
        get: {
          operationId: "getTenantSettings",
          security: [{ bearerAuth: [] }],
          parameters: [REQUEST_ID_PARAMETER],
          responses: {
            ...okJson({ $ref: "#/components/schemas/TenantSettings" }),
            ...authErrors,
          },
        },
        patch: {
          operationId: "updateTenantSettings",
          security: [{ bearerAuth: [] }],
          parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/TenantSettings" } },
            },
          },
          responses: {
            ...okJson({ $ref: "#/components/schemas/TenantSettings" }),
            ...writeErrors,
          },
        },
      },
    },
  };
}
