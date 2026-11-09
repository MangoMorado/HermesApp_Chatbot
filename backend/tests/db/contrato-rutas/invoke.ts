import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HttpMethod, Surface } from "./types";

const ROOTS: Record<Surface, string> = {
  chatbot: "api/v1",
  platform: "api/platform/v1",
  sim: "api/sim/v1",
};

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** Carga el route handler real de la plantilla (`/knowledge-entries/{id}` → `[id]/route.ts`). */
async function handlerFor(
  surface: Surface,
  method: HttpMethod,
  template: string,
): Promise<RouteHandler> {
  const directory = template.replace(/\{([^}]+)\}/g, "[$1]");
  const file = join(process.cwd(), "src", "app", ROOTS[surface], directory, "route.ts");
  const module = (await import(pathToFileURL(file).href)) as Record<string, RouteHandler>;
  const handler = module[method.toUpperCase()];
  if (!handler) {
    throw new Error(`Sin handler ${method.toUpperCase()} en ${file}`);
  }
  return handler;
}

/** Valores de los segmentos `{x}` de la plantilla, sacados de la ruta concreta. */
function paramsOf(template: string, path: string): Record<string, string> {
  const names = template.split("/");
  const values = path.split("/");
  const params: Record<string, string> = {};
  names.forEach((segment, index) => {
    const match = /^\{(.+)\}$/.exec(segment);
    if (match?.[1]) {
      params[match[1]] = decodeURIComponent(values[index] ?? "");
    }
  });
  return params;
}

export type CallInput = {
  readonly surface: Surface;
  readonly method: HttpMethod;
  readonly template: string;
  /** Ruta concreta sin query, p. ej. `/knowledge-entries/abc`. */
  readonly path: string;
  readonly query?: string;
  readonly token?: string | null;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  /** Cuerpo ya serializado (formularios); gana sobre `body`. */
  readonly rawBody?: string;
};

export async function call(input: CallInput): Promise<Response> {
  const handler = await handlerFor(input.surface, input.method, input.template);
  const headers = new Headers(input.headers);
  if (input.token) {
    headers.set("Authorization", `Bearer ${input.token}`);
  }
  let body: string | undefined = input.rawBody;
  if (body === undefined && input.body !== undefined) {
    body = JSON.stringify(input.body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  const query = input.query ? `?${input.query}` : "";
  const url = `http://localhost/${ROOTS[input.surface]}${input.path}${query}`;
  const request = new Request(url, { method: input.method.toUpperCase(), headers, body });
  return handler(request, {
    params: Promise.resolve(paramsOf(input.template, input.path)),
  });
}
