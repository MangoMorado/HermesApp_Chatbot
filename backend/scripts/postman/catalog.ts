import { buildOpenApiDocument } from "../../src/http/openapi";
import { buildPlatformOpenApiDocument } from "../../src/http/openapi-platform";
import { buildSimOpenApiDocument } from "../../src/http/openapi-sim";
import { type AuthProfile, authPrerequest } from "./auth";
import { exampleFromSchema } from "./examples";
import {
  event,
  jsonBody,
  type PostmanHeader,
  type PostmanItem,
  type PostmanRequest,
  stableId,
  statusTest,
  urlOf,
} from "./items";

/**
 * Catalogo generado: una peticion por operacion de los tres contratos (spec 5.3 §4.1). Es para
 * explorar a mano; Newman no lo ejecuta porque sus ids de ruta y cuerpos no se pueden limpiar.
 */
type Surface = "chatbot" | "platform" | "sim";
type Operation = {
  parameters?: { name: string; in: string }[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses: Record<string, unknown>;
  security?: Record<string, unknown>[];
  summary?: string;
  description?: string;
};
type Document = { components: unknown; paths: Record<string, Record<string, Operation>> };

const SURFACES: readonly { surface: Surface; prefix: string; build: () => unknown }[] = [
  { surface: "chatbot", prefix: "/api/v1", build: buildOpenApiDocument },
  { surface: "platform", prefix: "/api/platform/v1", build: buildPlatformOpenApiDocument },
  { surface: "sim", prefix: "/api/sim/v1", build: buildSimOpenApiDocument },
];

/** Perfil por defecto de cada subcarpeta (va en su pre-request). */
export const FOLDER_PROFILES: Record<Surface, AuthProfile> = {
  chatbot: { user: "admin_a" },
  platform: { client: "platform" },
  sim: { user: "admin_a" },
};

/** Rompen el laboratorio y no se deshacen: solo en la carpeta manual (spec 5.3 §4.4.1). */
export const MANUAL_ONLY: ReadonlySet<string> = new Set([
  "chatbot POST /bot-config/widget-keys/rotate",
  "platform PUT /tenants/{id}/widget-client",
]);

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function hasParameter(operation: Operation, name: string): boolean {
  return (operation.parameters ?? []).some((parameter) => parameter.name === name);
}

/** Perfil propio de la operacion si difiere del de su carpeta. */
function ownProfile(operation: Operation): AuthProfile | null {
  const security = operation.security ?? [];
  if (security.length === 0) {
    return "none";
  }
  if (security.length === 1 && security[0] && "widgetSession" in security[0]) {
    return "widget";
  }
  return null;
}

function headersOf(path: string, operation: Operation, contentType: string | null) {
  const headers: PostmanHeader[] = [];
  if ((operation.security ?? []).length > 0) {
    headers.push({ key: "Authorization", value: "Bearer {{access_token}}" });
  }
  if (hasParameter(operation, "Idempotency-Key")) {
    headers.push({ key: "Idempotency-Key", value: "{{$guid}}" });
  }
  if (hasParameter(operation, "X-Conversation-Secret")) {
    headers.push({ key: "X-Conversation-Secret", value: "{{conversation_secret_a}}" });
  }
  if (path.startsWith("/widget/sessions")) {
    headers.push({ key: "Origin", value: "{{widget_origin_a}}" });
  }
  if (contentType) {
    headers.push({ key: "Content-Type", value: contentType });
  }
  return headers;
}

function requestOf(
  prefix: string,
  path: string,
  method: string,
  operation: Operation,
  doc: Document,
) {
  const content = operation.requestBody?.content ?? {};
  const contentType = Object.keys(content)[0] ?? null;
  const routePath = path.replace(/\{([^}]+)\}/g, ":$1");
  const request: PostmanRequest = {
    method: method.toUpperCase(),
    header: headersOf(path, operation, contentType),
    url: urlOf(`{{base_url}}${prefix}${routePath}`),
  };
  if (contentType === "application/json") {
    request.body = jsonBody(exampleFromSchema(content[contentType]?.schema, doc.components));
  } else if (contentType === "application/x-www-form-urlencoded") {
    request.body = { mode: "urlencoded", urlencoded: [{ key: "logout_token", value: "" }] };
  }
  return request;
}

function itemOf(surface: Surface, prefix: string, path: string, method: string, doc: Document) {
  const operation = doc.paths[path]?.[method] as Operation;
  const success = Object.keys(operation.responses)
    .map(Number)
    .filter((s) => s < 300);
  const profile = ownProfile(operation);
  const events = [event("test", statusTest(success))];
  if (profile) {
    events.unshift(event("prerequest", authPrerequest(profile)));
  }
  const item: PostmanItem = {
    id: stableId(`${surface} ${method} ${path}`),
    name: `${method.toUpperCase()} ${prefix}${path}`,
    request: requestOf(prefix, path, method, operation, doc),
    event: events,
  };
  const description = operation.description ?? operation.summary;
  return description ? { ...item, description } : item;
}

export type CatalogParts = { bySurface: Record<Surface, PostmanItem[]>; manual: PostmanItem[] };

export function catalogItems(): CatalogParts {
  const parts: CatalogParts = { bySurface: { chatbot: [], platform: [], sim: [] }, manual: [] };
  for (const { surface, prefix, build } of SURFACES) {
    const doc = build() as Document;
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const method of METHODS.filter((m) => pathItem[m])) {
        const item = itemOf(surface, prefix, path, method, doc);
        const key = `${surface} ${method.toUpperCase()} ${path}`;
        (MANUAL_ONLY.has(key) ? parts.manual : parts.bySurface[surface]).push(item);
      }
    }
  }
  return parts;
}
