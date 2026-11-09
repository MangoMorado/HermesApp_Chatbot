import { type AuthProfile, authPrerequest } from "../auth";
import { event, type PostmanHeader, type PostmanItem, stableId, urlOf } from "../items";

/** Peticion de un recorrido: su perfil de autenticacion, su cuerpo y sus scripts. */
export type StepSpec = {
  readonly folder: string;
  readonly name: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Ruta tras `{{base_url}}`, p. ej. `/api/v1/bot-config` o `/fhir/Slot?status=free`. */
  readonly path: string;
  readonly auth: AuthProfile;
  /** Objeto (se serializa) o texto crudo con variables (`{{chat_body}}`). */
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly prerequest?: readonly string[];
  readonly test?: readonly string[];
  /** Escrituras: `Idempotency-Key` nueva por ejecucion. Por defecto, todo lo que no es GET. */
  readonly idempotent?: boolean;
};

function contentType(spec: StepSpec): string {
  return spec.path.startsWith("/fhir") ? "application/fhir+json" : "application/json";
}

function headersOf(spec: StepSpec): PostmanHeader[] {
  const headers: PostmanHeader[] = [];
  if (spec.auth !== "none") {
    headers.push({ key: "Authorization", value: "Bearer {{access_token}}" });
  }
  if (spec.idempotent ?? spec.method !== "GET") {
    headers.push({ key: "Idempotency-Key", value: "{{$guid}}" });
  }
  if (spec.body !== undefined) {
    headers.push({ key: "Content-Type", value: contentType(spec) });
  }
  for (const [key, value] of Object.entries(spec.headers ?? {})) {
    headers.push({ key, value });
  }
  return headers;
}

function rawBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

export function step(spec: StepSpec): PostmanItem {
  const item: PostmanItem = {
    id: stableId(`${spec.folder} ${spec.name}`),
    name: spec.name,
    request: {
      method: spec.method,
      header: headersOf(spec),
      url: urlOf(`{{base_url}}${spec.path}`),
    },
    event: [
      event("prerequest", [...authPrerequest(spec.auth), ...(spec.prerequest ?? [])]),
      event("test", [...(spec.test ?? [])]),
    ],
  };
  if (spec.body !== undefined && item.request) {
    item.request.body = {
      mode: "raw",
      raw: rawBody(spec.body),
      options: { raw: { language: "json" } },
    };
  }
  return item;
}

/**
 * Primera peticion de `cleanup`: un paso fallido salta aqui (los siguientes dependen de el), asi
 * la coleccion se deshace igual y la ejecucion queda en rojo.
 */
export const CLEANUP_ENTRY = "cleanup — solicitudes propuestas A";

/** Test de status: si no coincide, salta a la limpieza. */
export function expectStatus(...statuses: number[]): string[] {
  const list = JSON.stringify(statuses);
  return [
    `pm.test("status ${statuses.join(" o ")}", function () {`,
    `  pm.expect(${list}).to.include(pm.response.code);`,
    "});",
    `if (${list}.indexOf(pm.response.code) < 0) {`,
    '  console.log("Respuesta inesperada: " + pm.response.text());',
    `  pm.execution.setNextRequest(${JSON.stringify(CLEANUP_ENTRY)});`,
    "}",
    'pm.test("X-Request-Id", function () {',
    '  pm.expect(pm.response.headers.has("X-Request-Id")).to.be.true;',
    "});",
  ];
}

/** `X-Request-Id` solo existe en REST; `/fhir` responde con OperationOutcome en errores. */
export function expectFhirStatus(...statuses: number[]): string[] {
  const list = JSON.stringify(statuses);
  return [
    `pm.test("status ${statuses.join(" o ")}", function () {`,
    `  pm.expect(${list}).to.include(pm.response.code);`,
    "});",
    `if (${list}.indexOf(pm.response.code) < 0) {`,
    '  console.log("Respuesta inesperada: " + pm.response.text());',
    `  pm.execution.setNextRequest(${JSON.stringify(CLEANUP_ENTRY)});`,
    "}",
  ];
}

/** Texto libre de lo que crea Newman: siempre con el prefijo reconocible. */
export const PREFIX = "newman-";
