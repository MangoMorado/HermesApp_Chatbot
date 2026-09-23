import {
  ERROR_SCHEMA,
  errorResponses,
  okJson,
  PAGE_SCHEMA,
  pageParams,
  REQUEST_ID_PARAMETER,
} from "./openapi-shared";

/**
 * Contrato de /api/platform/v1. La plataforma no pertenece a ningun tenant: se autentica
 * con PLATFORM_SECRET y el tenant viaja en el cuerpo. `npm run openapi:generate` lo vuelca
 * en `openapi-platform.json`.
 */
const platformAuth = [{ platformSecret: [] }];
const readErrors = errorResponses([
  "unauthorized",
  "not_found",
  "validation_failed",
  "internal_error",
]);

const SCHEMAS = {
  Error: ERROR_SCHEMA,
  Page: PAGE_SCHEMA,
  Tenant: {
    type: "object",
    required: ["id", "slug", "name", "created_at"],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      name: { type: "string" },
      created_at: { type: "string", format: "date-time" },
    },
  },
  TokenRequest: {
    type: "object",
    required: ["tenant_id", "role", "subject"],
    properties: {
      tenant_id: { type: "string" },
      role: { type: "string", enum: ["operator", "admin", "service"] },
      subject: { type: "string", minLength: 1, maxLength: 120 },
      ttl_minutes: {
        type: "integer",
        minimum: 1,
        description: "Defecto 480 (operator/admin) o 60 (service); tope 720 o 1440.",
      },
    },
  },
  IssuedToken: {
    type: "object",
    required: ["token", "expires_at"],
    properties: { token: { type: "string" }, expires_at: { type: "string", format: "date-time" } },
  },
} as const;

export function buildPlatformOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — API de plataforma",
      version: "0.1.0",
      description:
        "Alta de tenants y emision de tokens de panel y servicio. Autenticada con " +
        "PLATFORM_SECRET; sin el, toda ruta responde 404.",
    },
    servers: [{ url: "/api/platform/v1" }],
    components: {
      securitySchemes: { platformSecret: { type: "http", scheme: "bearer" } },
      schemas: SCHEMAS,
    },
    paths: {
      "/tenants": {
        get: {
          operationId: "listTenants",
          security: platformAuth,
          parameters: [REQUEST_ID_PARAMETER, ...pageParams],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...readErrors },
        },
      },
      "/tokens": {
        post: {
          operationId: "issueToken",
          description: "No escribe dominio: sin Idempotency-Key. El token no se persiste.",
          security: platformAuth,
          parameters: [REQUEST_ID_PARAMETER],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/TokenRequest" } },
            },
          },
          responses: { ...okJson({ $ref: "#/components/schemas/IssuedToken" }), ...readErrors },
        },
      },
    },
  };
}
