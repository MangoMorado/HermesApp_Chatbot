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
  "identity_unavailable",
  "internal_error",
]);

const readErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "identity_unavailable",
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

const IDENTIFIER_SCHEMA = {
  type: "object",
  required: ["system", "value"],
  properties: { system: { type: "string" }, value: { type: "string" } },
} as const;

const REF_SCHEMA = {
  type: ["object", "null"],
  required: ["identifier", "start_at", "end_at"],
  properties: {
    identifier: IDENTIFIER_SCHEMA,
    start_at: { type: "string", format: "date-time" },
    end_at: { type: "string", format: "date-time" },
  },
} as const;

const INBOX_REQUEST_SCHEMA = {
  type: "object",
  required: [
    "id",
    "kind",
    "status",
    "created_at",
    "expires_at",
    "resolution_reason",
    "patient",
    "slot",
    "appointment",
    "resulting_appointment",
  ],
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["book", "reschedule", "cancel"] },
    status: { type: "string", enum: ["pending", "approved", "rejected", "expired"] },
    created_at: { type: "string", format: "date-time" },
    expires_at: { type: "string", format: "date-time" },
    resolution_reason: { type: ["string", "null"], enum: ["slot_unavailable", "declined", null] },
    patient: {
      type: "object",
      required: ["identifier", "document_type", "document_number", "given_names", "family_names"],
      properties: {
        identifier: IDENTIFIER_SCHEMA,
        document_type: { type: "string" },
        document_number: { type: "string" },
        given_names: { type: "string" },
        family_names: { type: "string" },
      },
    },
    slot: REF_SCHEMA,
    appointment: REF_SCHEMA,
    resulting_appointment: {
      type: ["object", "null"],
      required: ["identifier"],
      properties: { identifier: IDENTIFIER_SCHEMA },
    },
  },
} as const;

function inboxDecision(operationId: string, summary: string) {
  return {
    post: {
      operationId,
      summary,
      security: [{ bearerAuth: [] }],
      parameters: [
        REQUEST_ID_PARAMETER,
        IDEMPOTENCY_PARAMETER,
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Solicitud resuelta",
          headers: REQUEST_ID_RESPONSE_HEADER,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/InboxRequest" } },
          },
        },
        ...writeErrors,
      },
    },
  };
}

const INBOX_PATHS = {
  "/inbox": {
    get: {
      operationId: "listSimInbox",
      summary: "Solicitudes pendientes y vivas del tenant (vence las caducadas antes de responder)",
      security: [{ bearerAuth: [] }],
      parameters: [
        REQUEST_ID_PARAMETER,
        { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200 },
        },
      ],
      responses: {
        "200": {
          description: "OK",
          headers: REQUEST_ID_RESPONSE_HEADER,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data", "next_cursor"],
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/InboxRequest" } },
                  next_cursor: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        ...readErrors,
      },
    },
  },
  "/inbox/{id}/approve": inboxDecision(
    "approveSimInboxRequest",
    "Hermes aprueba: reserva si su cupo sigue libre; si no, rechaza por slot_unavailable",
  ),
  "/inbox/{id}/reject": inboxDecision("rejectSimInboxRequest", "Hermes rechaza (declined)"),
} as const;

/** Contrato del simulador Hermes (`/api/sim/v1`). */
export function buildSimOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — Simulador Hermes",
      version: "0.3.0",
      description:
        "CRUD de maestros y bandeja de solicitudes del simulador. Apagable con HERMES_SIMULATOR_ENABLED.",
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
        InboxRequest: INBOX_REQUEST_SCHEMA,
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
      ...INBOX_PATHS,
    },
  };
}
