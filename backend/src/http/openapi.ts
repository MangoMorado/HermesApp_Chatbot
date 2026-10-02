import { CHATBOT_PATHS, CHATBOT_SCHEMAS } from "./openapi-paths-chatbot";
import { CONVERSATION_PATHS, CONVERSATION_SCHEMAS } from "./openapi-paths-conversation";
import {
  authErrors,
  ERROR_SCHEMA,
  errorResponses,
  IDEMPOTENCY_PARAMETER,
  okJson,
  PAGE_SCHEMA,
  pageParams,
  REQUEST_ID_PARAMETER,
  writeErrors,
} from "./openapi-shared";

/**
 * Fuente unica del contrato REST chatbot. `npm run openapi:generate` la vuelca
 * en `openapi.json`. Toda ruta nueva de /api/v1 se declara aqui en la misma PR.
 */

const rangeParams = [
  { name: "from", in: "query", required: true, schema: { type: "string" } },
  { name: "to", in: "query", required: true, schema: { type: "string" } },
] as const;

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — API REST",
      version: "0.3.0",
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
        Error: ERROR_SCHEMA,
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
        Page: PAGE_SCHEMA,
        TenantSettings: {
          type: "object",
          required: ["max_query_range_days"],
          properties: { max_query_range_days: { type: "integer", minimum: 1, maximum: 366 } },
        },
        ...CHATBOT_SCHEMAS,
        ...CONVERSATION_SCHEMAS,
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
      "/medical-records/search": {
        post: {
          operationId: "findMedicalRecord",
          description:
            "Busca un expediente por documento. POST para que el documento no viaje en la URL; no escribe.",
          security: [{ bearerAuth: [] }],
          parameters: [REQUEST_ID_PARAMETER],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["document_type", "document_number"],
                  properties: {
                    document_type: { type: "string", enum: ["CC", "TI", "CE", "PA", "RC"] },
                    document_number: { type: "string", minLength: 1 },
                  },
                },
              },
            },
          },
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
      ...CHATBOT_PATHS,
      ...CONVERSATION_PATHS,
    },
  };
}
