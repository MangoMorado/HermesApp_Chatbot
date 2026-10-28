import {
  createdJson,
  ERROR_SCHEMA,
  errorResponses,
  IDEMPOTENCY_PARAMETER,
  okJson,
  PAGE_SCHEMA,
  pageParams,
  REQUEST_ID_PARAMETER,
} from "./openapi-shared";

/**
 * Contrato de /api/platform/v1. La plataforma no pertenece a ningun tenant: se autentica
 * con un bearer del proveedor de identidad con rol `platform` (OAuth2 llega en la 5.3). `npm run openapi:generate` lo vuelca
 * en `openapi-platform.json`.
 */
const platformAuth = [{ platformBearer: [] }];
const readErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "identity_unavailable",
  "internal_error",
]);
const writeErrors = errorResponses([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "identity_unavailable",
  "internal_error",
]);

const SCHEMAS = {
  Error: ERROR_SCHEMA,
  Page: PAGE_SCHEMA,
  PlatformIdentity: {
    type: "object",
    required: ["subject", "role"],
    properties: {
      subject: { type: "string" },
      role: { type: "string", enum: ["platform"] },
    },
  },
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
  WidgetClientRequest: {
    type: "object",
    required: ["client_id", "client_secret"],
    properties: {
      client_id: { type: "string", minLength: 1, maxLength: 200 },
      client_secret: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Se guarda sellado; nunca se devuelve ni se audita.",
      },
    },
  },
  WidgetClientSet: {
    type: "object",
    required: ["client_id", "updated_at"],
    properties: {
      client_id: { type: "string" },
      updated_at: { type: "string", format: "date-time" },
    },
  },
  WidgetClientRef: {
    type: "object",
    required: ["client_id"],
    properties: { client_id: { type: "string" } },
  },
  TenantRequest: {
    type: "object",
    required: ["slug", "name"],
    properties: {
      slug: { type: "string", pattern: "^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$" },
      name: { type: "string", minLength: 1, maxLength: 120 },
      allowed_origins: { type: "array", maxItems: 20, items: { type: "string" } },
      widget_client: {
        $ref: "#/components/schemas/WidgetClientRequest",
        description:
          "Credenciales del cliente OIDC del widget; se guardan en la misma transaccion.",
      },
    },
  },
  TenantCreated: {
    type: "object",
    required: ["tenant", "widget_key", "widget_client"],
    properties: {
      tenant: { $ref: "#/components/schemas/Tenant" },
      widget_key: { type: "string", description: "Clave publica del widget (va en el HTML)." },
      widget_client: {
        oneOf: [{ $ref: "#/components/schemas/WidgetClientRef" }, { type: "null" }],
        description: "Solo el `client_id`; el secreto nunca se devuelve.",
      },
    },
  },
} as const;

export function buildPlatformOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chatbot Ingenius 360 — API de plataforma",
      version: "0.1.0",
      description:
        "Alta de tenants y credenciales del widget de cada clinica. Autenticada con un " +
        "bearer JWT del proveedor de identidad con rol `platform`.",
    },
    servers: [{ url: "/api/platform/v1" }],
    components: {
      securitySchemes: { platformBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: SCHEMAS,
    },
    paths: {
      "/me": {
        get: {
          operationId: "getPlatformIdentity",
          description: "Identidad que el backend resolvio del bearer `platform`.",
          security: platformAuth,
          parameters: [REQUEST_ID_PARAMETER],
          responses: {
            ...okJson({ $ref: "#/components/schemas/PlatformIdentity" }),
            ...readErrors,
          },
        },
      },
      "/tenants": {
        get: {
          operationId: "listTenants",
          security: platformAuth,
          parameters: [REQUEST_ID_PARAMETER, ...pageParams],
          responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...readErrors },
        },
        post: {
          operationId: "createTenant",
          description:
            "Alta con predeterminados: bot-config, KB de ejemplo y primera clave del widget. " +
            "Una repeticion con la misma Idempotency-Key devuelve la respuesta original, con la " +
            "widget_key emitida en el alta aunque despues se haya rotado.",
          security: platformAuth,
          parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/TenantRequest" } },
            },
          },
          responses: {
            ...createdJson({ $ref: "#/components/schemas/TenantCreated" }),
            ...writeErrors,
          },
        },
      },
      "/tenants/{id}/widget-client": {
        put: {
          operationId: "setWidgetClient",
          description:
            "Registra o rota las credenciales del cliente OIDC del widget de la clinica. " +
            "Una repeticion con la misma Idempotency-Key y el mismo cuerpo repite la respuesta.",
          security: platformAuth,
          parameters: [
            REQUEST_ID_PARAMETER,
            IDEMPOTENCY_PARAMETER,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WidgetClientRequest" } },
            },
          },
          responses: {
            ...okJson({ $ref: "#/components/schemas/WidgetClientSet" }),
            ...writeErrors,
          },
        },
      },
    },
  };
}
