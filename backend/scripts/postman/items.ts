import { createHash } from "node:crypto";

/** Tipos minimos de Postman Collection v2.1 y utilidades compartidas por catalogo y fragmentos. */
export type PostmanHeader = { key: string; value: string };
export type PostmanScript = { type: "text/javascript"; exec: string[] };
export type PostmanEvent = { listen: "prerequest" | "test"; script: PostmanScript };
export type PostmanUrl = {
  raw: string;
  host: string[];
  path: string[];
  query?: { key: string; value: string }[];
  variable?: { key: string; value: string }[];
};
export type PostmanBody =
  | { mode: "raw"; raw: string; options: { raw: { language: "json" } } }
  | { mode: "urlencoded"; urlencoded: { key: string; value: string }[] };
export type PostmanRequest = {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  body?: PostmanBody;
};
export type PostmanItem = {
  id?: string;
  name: string;
  description?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
};

/** Carpeta escrita a mano que ejecuta Newman (spec 5.3 §4.1). */
export type Fragment = { name: string; item: PostmanItem[]; prerequest?: string[] };

/** Id estable derivado de una semilla: regenerar no cambia el archivo. */
export function stableId(seed: string): string {
  const hex = createHash("sha1").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** URL de Postman a partir de `{{base_url}}/ruta?query` (los `:x` son variables de ruta). */
export function urlOf(raw: string): PostmanUrl {
  const [base = "", search] = raw.split("?");
  const [host = "", ...path] = base.split("/");
  const url: PostmanUrl = { raw, host: [host], path };
  if (search) {
    url.query = search.split("&").map((pair) => {
      const [key = "", value = ""] = pair.split("=");
      return { key, value };
    });
  }
  const variables = path.filter((segment) => segment.startsWith(":"));
  if (variables.length > 0) {
    url.variable = variables.map((segment) => ({ key: segment.slice(1), value: "" }));
  }
  return url;
}

export function jsonBody(value: unknown): PostmanBody {
  return {
    mode: "raw",
    raw: JSON.stringify(value, null, 2),
    options: { raw: { language: "json" } },
  };
}

export function event(listen: PostmanEvent["listen"], exec: string[]): PostmanEvent {
  return { listen, script: { type: "text/javascript", exec } };
}

/** Test comun: status esperado y `X-Request-Id`; en errores, la envoltura REST. */
export function statusTest(statuses: readonly number[]): string[] {
  const list = JSON.stringify(statuses);
  return [
    `pm.test("status ${statuses.join(" o ")}", function () {`,
    `  pm.expect(${list}).to.include(pm.response.code);`,
    "});",
    'pm.test("X-Request-Id", function () {',
    '  pm.expect(pm.response.headers.has("X-Request-Id")).to.be.true;',
    "});",
    "if (pm.response.code >= 400) {",
    '  pm.test("envoltura de error", function () {',
    "    var error = pm.response.json().error;",
    '    pm.expect(error).to.include.keys("code", "message", "request_id");',
    "  });",
    "}",
  ];
}
