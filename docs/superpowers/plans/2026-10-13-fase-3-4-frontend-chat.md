# Fase 3.4 — Frontend del chat: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poner interfaz al chat: un widget con un solo núcleo y tres montajes (script, iframe, consola `/chat`), las páginas de panel de base de conocimiento y configuración del bot, y la bandeja del simulador.

**Architecture:** El núcleo vive en `frontend/src/widget/` en capas que solo dependen hacia abajo: `fetcher` (HTTP absoluto + token del widget) → `widget-api` (puerto sobre el cliente orval) → `session` (abrir/restaurar/renovar) → `chat-client` (turnos, reintentos, eco) → `use-chat` + `chat-widget` (React). Las tres primeras capas de lógica son puras e inyectables, y se prueban con Vitest sin DOM. Los tres montajes importan el mismo `ChatWidget`; el script lo empaqueta esbuild en un IIFE. Las páginas de panel siguen el patrón existente (cliente orval + `useAction` + `idempotent` + `Board`).

**Tech Stack:** Next.js 16 (App Router, grupos de rutas), React 19, TanStack Query 5, orval 8 (cliente `fetch` con filtro por tag), esbuild 0.28, Vitest 5 (entorno `node`), Biome 2, React Doctor.

**Spec:** `docs/superpowers/specs/2026-10-13-fase-3-4-frontend-chat-design.md`

## Global Constraints

- Sin IA: ninguna dependencia ni import de LLM, embeddings, vectores o n8n.
- **Sin reglas de negocio en el frontend.** El widget pinta mensajes, opciones y el tipo de entrada que devuelve el backend; no decide pasos. No se duplican rangos ni validaciones: se muestra el `422` del backend. Solo validación de forma (campo vacío, `maxLength`).
- Los clientes orval (`frontend/src/api/`, `frontend/src/sim/`, `frontend/src/widget/api/`) son generados: nunca se editan a mano. Se regeneran con `npm --prefix frontend run api:generate`.
- `openapi.json` es generado: se edita `backend/src/http/openapi*.ts` y se corre `npm --prefix backend run openapi:generate`.
- La 3.4 **no cambia el comportamiento del contrato REST**. El único cambio de backend es añadir `tags: ["widget"]` a cuatro operaciones.
- El widget habla **directo al backend por CORS** en los tres montajes; nunca por el proxy `/api/*` del frontend. Nunca envía el JWT del panel ni cookies (`credentials: "omit"`).
- `process.env` solo en `frontend/src/config/env.ts` (y configs de herramientas).
- El widget no carga fuentes externas ni depende de `globals.css`: clases con prefijo `iw-` y CSS propio.
- No se muestra al paciente ningún `request_id` ni código de error: solo un mensaje en español.
- Clean Code: complejidad cognitiva ≤ 15 (Biome la hace fallar), ≤ 40 líneas por función de lógica, ≤ 400 líneas por archivo de lógica, 0 ciclos de importación.
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (usar `import type`), `lib` ES2022 (**no** existe `Array.prototype.findLast`).
- Biome: comillas dobles, punto y coma, ancho 100, siempre llaves en `if`. `console.log` está prohibido; `console.error` y `console.warn` no. El código de este plan puede tener alguna línea que el formateador parte distinto: antes de cada commit, `npx biome check --write <archivos de la tarea>` y luego `npx biome ci .` en verde. El formateador solo reacomoda; si una regla de lint falla, se arregla el código, no se suprime.
- Código, rutas y campos en inglés; comentarios, mensajes y textos de interfaz en español.
- Sistema visual de las páginas de panel: `DESIGN.md`. La paleta de estado (`.flap`) es el único portador de color de estado; no usarla para adornos.
- **Rama `fase-3-4-frontend-chat`.** Commitear solo los archivos de cada tarea con `git add <rutas>`; nunca `git add -A`, `git stash`, `git checkout --` ni `reset`. Hay archivos `backend/tmp-*` sin seguimiento que **no** son de este plan: no tocarlos ni commitearlos. No hacer merge a `main` ni abrir PR: lo hace el usuario.
- Cada mensaje de commit termina con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comandos desde la raíz del repo, con `npm --prefix frontend …` o `npm --prefix backend …`. Un solo test: `npm --prefix frontend exec vitest run tests/<archivo>.test.ts`.
- Postgres local no se sostiene si lo arranca el agente: para el recorrido manual (Tarea 11) y `test:db` hay que **pedir al usuario** que pulse Start All en Laragon.

## Refinamientos sobre la spec

Salen de leer el código al planificar. La Tarea 11 los deja escritos en la spec (§10 nueva).

1. **CSS como cadena, no `styles.css`.** `styles.ts` exporta `WIDGET_CSS` y `ChatWidget` lo pinta en un `<style>`. Así el mismo código sirve dentro del Shadow DOM y en las páginas Next, sin cargadores de CSS en esbuild.
2. **Archivos añadidos al núcleo:** `widget-api.ts` (puerto sobre el cliente generado; evita el choque de nombre con la carpeta `api/`), `failure.ts` (errores → mensaje para el paciente) y `embed-config.ts` (lectura pura de `data-key`/`data-api`, separada del arranque con efectos).
3. **`429` sin cabecera.** `Retry-After` no es legible por CORS (el backend solo expone `X-Request-Id`). El widget usa `error.details.retry_after_seconds`, que el backend ya envía en el cuerpo. El `429` solo puede ocurrir al abrir sesión.
4. **Eco del texto libre:** tras el `200` se pide `GET /widget/conversation` y se toma el **último mensaje del paciente** como eco. Las líneas del bot salen siempre de la respuesta del `POST` (pueden ir completas ahí y redactadas en el historial).
5. **Grupos de rutas con un solo layout raíz.** `app/layout.tsx` conserva `<html>`, fuentes y `globals.css`; `(console)/layout.tsx` añade `Providers`, `Marquee` y `<main>`; `(embed)` no añade nada.
6. **El destino orval `chatbot` excluye el tag `widget`** (`filters.mode: "exclude"`), para que las operaciones del widget existan en un único cliente.
7. **Listas con «Cargar más»** (`useInfiniteQuery`) en conocimiento y bandeja: es la paginación por cursor de la spec.

## Review Focus

Entradas y fallos que la spec implica y que ningún test de «camino feliz» ejercita. Cada línea tiene su test en la tarea dueña del código.

1. **`sessionStorage` lanza al usarlo** (iframe con almacenamiento de terceros bloqueado, modo privado): el chat debe funcionar con la sesión en memoria, no quedarse en blanco. → Tarea 2.
2. **Doble clic en una opción o doble Enter:** debe salir **una** petición, no dos turnos. → Tarea 3.
3. **Backend inalcanzable o `data-api` mal escrito:** el paciente ve un aviso con «Reintentar», y el reintento reutiliza la misma `Idempotency-Key`. → Tareas 1, 3 y 4.
4. **El fragmento del script pegado dos veces en la misma página** (plantilla + gestor de etiquetas): se monta un solo widget. → Tarea 6.
5. **Palabras clave escritas con comas sobrantes, espacios o repetidas** (`" horario, ,Horario,citas "`): se envía una lista limpia, sin entradas vacías. → Tarea 8.

## Mapa de archivos

```
backend/src/http/openapi-paths-chatbot.ts        M  tags en 2 operaciones
backend/src/http/openapi-paths-conversation.ts   M  tags en 2 operaciones
backend/openapi.json                             G  regenerado
biome.json, frontend/biome.json                  M  ignorar src/widget/api
frontend/orval.config.ts                         M  destino widget + exclusión
frontend/doctor.config.ts                        M  ignorar src/widget/api
frontend/package.json                            M  esbuild, scripts
frontend/scripts/build-widget.mjs                C  empaquetado del script
frontend/scripts/serve-host.mjs                  C  página anfitriona de prueba
frontend/src/config/env.ts                       M  publicBackendUrl()
frontend/src/widget/api/**                       G  cliente orval del widget
frontend/src/widget/fetcher.ts                   C  mutator + WidgetApiError
frontend/src/widget/widget-api.ts                C  puerto WidgetApi
frontend/src/widget/session.ts                   C  sesión del paciente
frontend/src/widget/chat-client.ts               C  turnos, reintentos, eco
frontend/src/widget/failure.ts                   C  error → mensaje
frontend/src/widget/use-chat.ts                  C  estado React
frontend/src/widget/styles.ts                    C  WIDGET_CSS
frontend/src/widget/chat-widget.tsx              C  interfaz
frontend/src/widget/embed-config.ts              C  data-key / data-api
frontend/src/widget/embed.tsx                    C  entrada del script
frontend/src/app/layout.tsx                      M  solo html/body/fuentes
frontend/src/app/(console)/layout.tsx            C  Providers + Marquee + main
frontend/src/app/(console)/**                    R  page.tsx, panel/, simulador/ movidos
frontend/src/app/(console)/chat/page.tsx         C
frontend/src/app/(console)/panel/conocimiento/page.tsx  C
frontend/src/app/(console)/panel/bot/page.tsx    C
frontend/src/app/(console)/simulador/bandeja/page.tsx   C
frontend/src/app/(embed)/widget/page.tsx         C
frontend/src/components/chat/chat-console.tsx    C
frontend/src/components/panel/use-knowledge.ts, knowledge-form.tsx, knowledge-board.tsx   C
frontend/src/components/panel/bot-config-screen.tsx, bot-texts.tsx, bot-params.tsx, bot-origins.tsx, bot-keys.tsx   C
frontend/src/components/simulador/inbox-board.tsx  C
frontend/src/components/shell/platforms.ts       C  destinos y atajos
frontend/src/components/shell/marquee.tsx        M
frontend/src/lib/use-origin.ts, use-bot-config.ts, knowledge-draft.ts, embed-snippets.ts   C
frontend/src/app/globals.css                     M  clases nuevas
frontend/tests/*.test.ts                         C  9 archivos
```
(M modificar · C crear · G generado · R renombrar)

---

### Task 1: Contrato etiquetado, cliente orval del widget y `fetcher`

**Files:**
- Modify: `backend/src/http/openapi-paths-chatbot.ts` (operaciones `openWidgetSession`, `refreshWidgetSession`)
- Modify: `backend/src/http/openapi-paths-conversation.ts` (operaciones `getWidgetConversation`, `sendWidgetMessage`)
- Generated: `backend/openapi.json`, `frontend/src/api/**`, `frontend/src/widget/api/**`
- Modify: `frontend/orval.config.ts`, `biome.json`, `frontend/biome.json`, `frontend/doctor.config.ts`
- Create: `frontend/src/widget/fetcher.ts`, `frontend/src/widget/widget-api.ts`
- Test: `frontend/tests/widget-fetcher.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `widgetFetcher<T>(url: string, options?: WidgetRequestInit): Promise<T>` y `type WidgetRequestInit = RequestInit & { apiBase?: string; token?: string }`.
  - `class WidgetApiError extends Error { status: number; code: string | null; details: Record<string, unknown>; get reason(): string | null; get retryAfterSeconds(): number | null; get retryable(): boolean }`. `status` 0 = sin respuesta. Constructor: `new WidgetApiError(status, body | null, fallbackMessage)` donde `body` es `{ error?: unknown }` (la envoltura de errores REST).
  - `type WidgetConfig = { apiBase: string; widgetKey: string }`.
  - `type WidgetApi = { openSession(idempotencyKey: string): Promise<WidgetSession>; refreshSession(token: string, idempotencyKey: string): Promise<WidgetSession>; getConversation(token: string): Promise<ConversationHistory>; sendMessage(token: string, input: ConversationMessageInput, idempotencyKey: string): Promise<ConversationTurn> }`.
  - `createWidgetApi(config: WidgetConfig): WidgetApi`.
  - `widget-api.ts` reexporta los tipos `WidgetSession`, `ConversationHistory`, `ConversationTurn`, `ConversationOption`, `ConversationMessageInput`.

- [ ] **Step 1: Escribir el test del fetcher (falla)**

`frontend/tests/widget-fetcher.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetApiError, widgetFetcher } from "@/widget/fetcher";

function stubFetch(result: Response | Error) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function failure(run: Promise<unknown>): Promise<WidgetApiError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof WidgetApiError)) {
    throw new Error("se esperaba un WidgetApiError");
  }
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetcher del widget", () => {
  it("usa la URL absoluta del backend y solo el token del widget", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    const data = await widgetFetcher<{ ok: boolean }>("/api/v1/widget/conversation", {
      apiBase: "https://api.test",
      token: "w-token",
      method: "GET",
    });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(data).toEqual({ ok: true });
    expect(url).toBe("https://api.test/api/v1/widget/conversation");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer w-token");
    expect(init?.credentials).toBe("omit");
    expect(init).not.toHaveProperty("apiBase");
    expect(init).not.toHaveProperty("token");
  });

  it("sin token no manda Authorization", async () => {
    const mock = stubFetch(Response.json({}, { status: 201 }));
    await widgetFetcher("/api/v1/widget/sessions", { apiBase: "https://api.test", method: "POST" });
    const [, init] = mock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("traduce el error del contrato con su motivo", async () => {
    const body = {
      error: {
        code: "conflict",
        message: "La opcion ya no esta vigente",
        request_id: "r1",
        details: { reason: "stale_option" },
      },
    };
    stubFetch(Response.json(body, { status: 409 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(error.reason).toBe("stale_option");
    expect(error.message).toBe("La opcion ya no esta vigente");
    expect(error.retryable).toBe(false);
  });

  it("el 429 expone los segundos de espera del cuerpo", async () => {
    const body = {
      error: { code: "rate_limited", message: "x", details: { retry_after_seconds: 42 } },
    };
    stubFetch(Response.json(body, { status: 429 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.retryAfterSeconds).toBe(42);
  });

  it("un fallo de red es status 0 y reintentable", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.mal-escrito" }));
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });

  it("una respuesta de error que no es JSON no rompe y es reintentable", async () => {
    stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));
    const error = await failure(widgetFetcher("/x", { apiBase: "https://api.test" }));
    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.retryable).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm --prefix frontend exec vitest run tests/widget-fetcher.test.ts`
Expected: FAIL — no se puede resolver `@/widget/fetcher`.

- [ ] **Step 3: Implementar `fetcher.ts`**

`frontend/src/widget/fetcher.ts`:

```ts
/**
 * Mutator orval del widget. A diferencia de `lib/api-fetcher.ts`, habla con el backend por
 * su URL absoluta (CORS desde el sitio del tenant) y solo conoce el token de la sesión del
 * widget: nunca lee el JWT del panel ni envía cookies.
 */
export type WidgetRequestInit = RequestInit & {
  /** Origen del backend, sin barra final (p. ej. `https://api.clinica.co`). */
  readonly apiBase?: string;
  /** Token de la sesión del widget. */
  readonly token?: string;
};

/** Envoltura de errores REST (`error.code`, `error.message`, `error.details`), sin fiarse de su forma. */
type ErrorBody = { readonly error?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WidgetApiError extends Error {
  /** Código HTTP; `0` cuando no hubo respuesta (red caída, DNS, CORS). */
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ErrorBody | null, fallback: string) {
    const error = isRecord(body?.error) ? body.error : {};
    super(typeof error.message === "string" ? error.message : fallback);
    this.name = "WidgetApiError";
    this.status = status;
    this.code = typeof error.code === "string" ? error.code : null;
    this.details = isRecord(error.details) ? error.details : {};
  }

  /** Motivo de un `409` (`details.reason`), p. ej. `stale_option`. */
  get reason(): string | null {
    const reason = this.details.reason;
    return typeof reason === "string" ? reason : null;
  }

  /** Espera de un `429`. Viene en el cuerpo: `Retry-After` no es legible por CORS. */
  get retryAfterSeconds(): number | null {
    const seconds = this.details.retry_after_seconds;
    return typeof seconds === "number" ? seconds : null;
  }

  /** Sin respuesta o `5xx`: el mismo envío puede repetirse con la misma `Idempotency-Key`. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/** `undefined` si el cuerpo no es JSON; `null` si viene vacío. */
function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function widgetFetcher<T>(url: string, options?: WidgetRequestInit): Promise<T> {
  const { apiBase = "", token, ...init } = options ?? {};
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase}${url}`, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new WidgetApiError(0, null, "Sin conexión con el servidor");
  }
  const data = parseJson(await response.text());
  if (!response.ok) {
    throw new WidgetApiError(response.status, isRecord(data) ? data : null, `HTTP ${response.status}`);
  }
  if (data === undefined) {
    throw new WidgetApiError(response.status, null, "Respuesta sin JSON");
  }
  return data as T;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npm --prefix frontend exec vitest run tests/widget-fetcher.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Etiquetar las cuatro operaciones del widget en el backend**

En `backend/src/http/openapi-paths-chatbot.ts`, añadir `tags: ["widget"],` como primera propiedad, justo antes de `operationId`, en las operaciones `openWidgetSession` y `refreshWidgetSession`. Ejemplo del resultado:

```ts
  "/widget/sessions/refresh": {
    post: {
      tags: ["widget"],
      operationId: "refreshWidgetSession",
```

En `backend/src/http/openapi-paths-conversation.ts`, lo mismo en `getWidgetConversation` y `sendWidgetMessage`:

```ts
  "/widget/conversation": {
    get: {
      tags: ["widget"],
      operationId: "getWidgetConversation",
```

No etiquetar `addAllowedOrigin` ni `removeAllowedOrigin`: son del panel.

- [ ] **Step 6: Regenerar OpenAPI y comprobar el contrato**

Run: `npm --prefix backend run openapi:generate`
Expected: imprime `openapi.json regenerado en …` (y los otros dos).

Run: `git diff --stat backend/openapi.json`
Expected: solo `backend/openapi.json` cambia, con 4 bloques `"tags": ["widget"]` añadidos (`git diff backend/openapi.json | grep -c '"widget"'` → `4`). `openapi-sim.json` y `openapi-platform.json` sin diff.

Run: `npm --prefix backend exec vitest run tests/contrato-api.test.ts`
Expected: PASS.

- [ ] **Step 7: Configurar orval, Biome y React Doctor**

`frontend/orval.config.ts` completo:

```ts
import { defineConfig } from "orval";

const fetchOverride = { includeHttpResponseReturnType: false };

export default defineConfig({
  chatbot: {
    // Las operaciones del widget viven solo en su propio cliente (destino `widget`).
    input: {
      target: "../backend/openapi.json",
      filters: { mode: "exclude", tags: ["widget"] },
    },
    output: {
      target: "./src/api/endpoints.ts",
      schemas: "./src/api/models",
      client: "react-query",
      clean: true,
      mode: "tags-split",
      baseUrl: "/api/v1",
      override: {
        mutator: { path: "./src/lib/api-fetcher.ts", name: "apiFetcher" },
        fetch: fetchOverride,
      },
    },
  },
  simulator: {
    input: "../backend/openapi-sim.json",
    output: {
      target: "./src/sim/endpoints.ts",
      schemas: "./src/sim/models",
      client: "react-query",
      clean: true,
      mode: "tags-split",
      baseUrl: "/api/sim/v1",
      override: {
        mutator: { path: "./src/lib/api-fetcher.ts", name: "apiFetcher" },
        fetch: fetchOverride,
      },
    },
  },
  // Cliente del widget: sin react-query (va en el bundle del script) y con su propio mutator.
  widget: {
    input: {
      target: "../backend/openapi.json",
      filters: { mode: "include", tags: ["widget"] },
    },
    output: {
      target: "./src/widget/api/endpoints.ts",
      schemas: "./src/widget/api/models",
      client: "fetch",
      clean: true,
      mode: "single",
      baseUrl: "/api/v1",
      override: {
        mutator: { path: "./src/widget/fetcher.ts", name: "widgetFetcher" },
        fetch: fetchOverride,
      },
    },
  },
});
```

En `biome.json` (raíz), dentro de `files.includes`, añadir después de `"!**/frontend/src/sim",`:

```json
      "!**/frontend/src/widget/api",
```

En `frontend/biome.json`, `files.includes` queda:

```json
    "includes": ["**", "!src/api", "!src/sim", "!src/widget/api", "!**/node_modules", "!**/.next"]
```

En `frontend/doctor.config.ts`, `ignore.files` queda:

```ts
    files: ["src/api/**", "src/sim/**", "src/widget/api/**"],
```

- [ ] **Step 8: Regenerar los clientes y verificar la salida**

Run: `npm --prefix frontend run api:generate`
Expected: termina sin error y crea `frontend/src/widget/api/endpoints.ts` y `frontend/src/widget/api/models/`.

Verificar (los tres deben cumplirse; si alguno no, **parar y reportar** la salida real de orval antes de seguir):

```bash
grep -c "export const openWidgetSession\|export const refreshWidgetSession\|export const getWidgetConversation\|export const sendWidgetMessage" frontend/src/widget/api/endpoints.ts
# → 4
grep -c "widgetFetcher<" frontend/src/widget/api/endpoints.ts
# → 4
grep -rc "WidgetSession\|sendWidgetMessage" frontend/src/api/default/default.ts
# → 0
ls frontend/src/api
# → default  index.ts  models   (sin carpeta `widget`)
```

- [ ] **Step 9: Implementar `widget-api.ts`**

`frontend/src/widget/widget-api.ts`:

```ts
import {
  getWidgetConversation,
  openWidgetSession,
  refreshWidgetSession,
  sendWidgetMessage,
} from "./api/endpoints";
import type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  ConversationTurn,
  WidgetSession,
} from "./api/models";
import type { WidgetRequestInit } from "./fetcher";

export type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  ConversationTurn,
  WidgetSession,
};

export type WidgetConfig = {
  /** Origen del backend alcanzable desde el navegador, sin barra final. */
  readonly apiBase: string;
  /** Clave pública del widget: resuelve el tenant en el backend. */
  readonly widgetKey: string;
};

/** Puerto del chat: lo único que el resto del núcleo sabe del HTTP. */
export type WidgetApi = {
  openSession(idempotencyKey: string): Promise<WidgetSession>;
  refreshSession(token: string, idempotencyKey: string): Promise<WidgetSession>;
  getConversation(token: string): Promise<ConversationHistory>;
  sendMessage(
    token: string,
    input: ConversationMessageInput,
    idempotencyKey: string,
  ): Promise<ConversationTurn>;
};

const IDEMPOTENCY_HEADER = "Idempotency-Key";

function requestInit(apiBase: string, token?: string, idempotencyKey?: string): WidgetRequestInit {
  return {
    apiBase,
    ...(token ? { token } : {}),
    ...(idempotencyKey ? { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } } : {}),
  };
}

export function createWidgetApi({ apiBase, widgetKey }: WidgetConfig): WidgetApi {
  return {
    openSession: (key) =>
      openWidgetSession({ widget_key: widgetKey }, requestInit(apiBase, undefined, key)),
    refreshSession: (token, key) => refreshWidgetSession(requestInit(apiBase, token, key)),
    getConversation: (token) => getWidgetConversation(requestInit(apiBase, token)),
    sendMessage: (token, input, key) => sendWidgetMessage(input, requestInit(apiBase, token, key)),
  };
}
```

- [ ] **Step 10: Puertas de la tarea**

Run: `npm --prefix frontend run typecheck`
Expected: sin errores.

Run: `npx biome ci .` (desde la raíz)
Expected: sin errores (los 3 avisos `deserialize` del `$schema` ya existían).

Run: `npm --prefix frontend test`
Expected: PASS (los 8 tests previos + 6 nuevos).

- [ ] **Step 11: Commit**

```bash
git add backend/src/http/openapi-paths-chatbot.ts backend/src/http/openapi-paths-conversation.ts backend/openapi.json biome.json frontend/biome.json frontend/doctor.config.ts frontend/orval.config.ts frontend/src/api frontend/src/widget/api frontend/src/widget/fetcher.ts frontend/src/widget/widget-api.ts frontend/tests/widget-fetcher.test.ts
git commit -m "feat(widget): cliente orval propio del chat con mutator de URL absoluta" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sesión del paciente (`session.ts`)

**Files:**
- Create: `frontend/src/widget/session.ts`
- Test: `frontend/tests/widget-session.test.ts`

**Interfaces:**
- Consumes: `WidgetApi`, `WidgetSession` de `./widget-api`; `WidgetApiError` de `./fetcher`.
- Produces:
  - `type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">`.
  - `storageKey(widgetKey: string): string` → `ingenius.widget.<widgetKey>`.
  - `browserStorage(): SessionStorageLike | null`.
  - `clearStoredSession(widgetKey: string, storage: SessionStorageLike | null): void`.
  - `type SessionManager = { token(): Promise<string>; reopen(): Promise<string>; clear(): void }`.
  - `createSessionManager(deps: { api: WidgetApi; widgetKey: string; storage: SessionStorageLike | null; now: () => number; newKey: () => string }): SessionManager`.
  - `REFRESH_MARGIN_MS = 60_000`.

- [ ] **Step 1: Escribir los tests (fallan)**

`frontend/tests/widget-session.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { WidgetApiError } from "@/widget/fetcher";
import { createSessionManager, type SessionStorageLike, storageKey } from "@/widget/session";
import type { WidgetApi, WidgetSession } from "@/widget/widget-api";

const NOW = Date.parse("2026-10-13T15:00:00.000Z");
const MINUTE = 60_000;
const KEY = storageKey("wk_demo");

function session(token: string, expiresAt: number): WidgetSession {
  return { session_id: "s1", token, expires_at: new Date(expiresAt).toISOString() };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: SessionStorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}

function stored(token: string, expiresAt: number): Record<string, string> {
  return { [KEY]: JSON.stringify({ token, expires_at: new Date(expiresAt).toISOString() }) };
}

function setup(storage: SessionStorageLike | null, overrides: Partial<WidgetApi> = {}) {
  const api = {
    openSession: vi.fn<WidgetApi["openSession"]>(async () => session("opened", NOW + 30 * MINUTE)),
    refreshSession: vi.fn<WidgetApi["refreshSession"]>(async () =>
      session("refreshed", NOW + 30 * MINUTE),
    ),
    getConversation: vi.fn<WidgetApi["getConversation"]>(),
    sendMessage: vi.fn<WidgetApi["sendMessage"]>(),
    ...overrides,
  };
  let keys = 0;
  const manager = createSessionManager({
    api,
    widgetKey: "wk_demo",
    storage,
    now: () => NOW,
    newKey: () => `key-${++keys}`,
  });
  return { api, manager };
}

describe("sesión del widget", () => {
  it("sin token guardado abre sesión y la guarda", async () => {
    const { data, storage } = memoryStorage();
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledWith("key-1");
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({ token: "opened" });
  });

  it("con token vigente lo restaura sin llamar al backend", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 20 * MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("saved");
    expect(api.openSession).not.toHaveBeenCalled();
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("a menos de un minuto del vencimiento renueva", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("refreshed");
    expect(api.refreshSession).toHaveBeenCalledWith("saved", "key-1");
  });

  it("si la renovación responde 401 abre sesión nueva", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(401, { error: { code: "unauthorized" } }, "HTTP 401");
    });
    const { api, manager } = setup(storage, { refreshSession });
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("si la renovación falla por red conserva el token aún vigente", async () => {
    const { storage } = memoryStorage(stored("saved", NOW + 30_000));
    const refreshSession = vi.fn<WidgetApi["refreshSession"]>(async () => {
      throw new WidgetApiError(0, null, "Sin conexión");
    });
    const { api, manager } = setup(storage, { refreshSession });
    expect(await manager.token()).toBe("saved");
    expect(api.openSession).not.toHaveBeenCalled();
  });

  it("un token ya vencido (pestaña dormida) abre sesión nueva sin renovar", async () => {
    const { storage } = memoryStorage(stored("saved", NOW - MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.token()).toBe("opened");
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("un valor guardado corrupto se trata como si no hubiera sesión", async () => {
    const { storage } = memoryStorage({ [KEY]: "{no es json" });
    const { manager } = setup(storage);
    expect(await manager.token()).toBe("opened");
  });

  it("sin almacenamiento la sesión vive en memoria", async () => {
    const { api, manager } = setup(null);
    expect(await manager.token()).toBe("opened");
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("si el almacenamiento lanza al leer y al escribir, sigue funcionando en memoria", async () => {
    const blocked: SessionStorageLike = {
      getItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    };
    const { api, manager } = setup(blocked);
    expect(await manager.token()).toBe("opened");
    expect(await manager.token()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(() => manager.clear()).not.toThrow();
  });

  it("dos peticiones de token simultáneas abren una sola sesión", async () => {
    const { api, manager } = setup(null);
    const [a, b] = await Promise.all([manager.token(), manager.token()]);
    expect(a).toBe("opened");
    expect(b).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });

  it("reopen descarta la sesión guardada y abre otra", async () => {
    const { data, storage } = memoryStorage(stored("saved", NOW + 20 * MINUTE));
    const { api, manager } = setup(storage);
    expect(await manager.reopen()).toBe("opened");
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(KEY) ?? "{}")).toMatchObject({ token: "opened" });
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm --prefix frontend exec vitest run tests/widget-session.test.ts`
Expected: FAIL — no se puede resolver `@/widget/session`.

- [ ] **Step 3: Implementar `session.ts`**

`frontend/src/widget/session.ts`:

```ts
import { WidgetApiError } from "./fetcher";
import type { WidgetApi, WidgetSession } from "./widget-api";

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredSession = { readonly token: string; readonly expiresAt: number };

/** Con menos de un minuto de vida, el token se renueva antes de usarlo. */
export const REFRESH_MARGIN_MS = 60_000;

export function storageKey(widgetKey: string): string {
  return `ingenius.widget.${widgetKey}`;
}

/** `sessionStorage` si el navegador deja usarlo; en un iframe con almacenamiento bloqueado, `null`. */
export function browserStorage(): SessionStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearStoredSession(widgetKey: string, storage: SessionStorageLike | null): void {
  try {
    storage?.removeItem(storageKey(widgetKey));
  } catch {
    // Almacenamiento bloqueado: no hay nada que borrar.
  }
}

function parseStored(raw: string | null): StoredSession | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as { token?: unknown; expires_at?: unknown } | null;
    const expiresAt = typeof value?.expires_at === "string" ? Date.parse(value.expires_at) : Number.NaN;
    return typeof value?.token === "string" && Number.isFinite(expiresAt)
      ? { token: value.token, expiresAt }
      : null;
  } catch {
    return null;
  }
}

/** Guarda en el almacenamiento y en memoria: si el primero falla, la sesión no se pierde. */
function createStore(widgetKey: string, storage: SessionStorageLike | null) {
  const key = storageKey(widgetKey);
  let memory: string | null = null;
  return {
    read(): StoredSession | null {
      try {
        return parseStored(storage?.getItem(key) ?? memory);
      } catch {
        return parseStored(memory);
      }
    },
    write(session: WidgetSession): void {
      memory = JSON.stringify({ token: session.token, expires_at: session.expires_at });
      try {
        storage?.setItem(key, memory);
      } catch {
        // Queda en memoria: funciona, pero no sobrevive a la recarga.
      }
    },
    clear(): void {
      memory = null;
      clearStoredSession(widgetKey, storage);
    },
  };
}

export type SessionDeps = {
  readonly api: WidgetApi;
  readonly widgetKey: string;
  readonly storage: SessionStorageLike | null;
  readonly now: () => number;
  readonly newKey: () => string;
};

export type SessionManager = {
  /** Token vigente: restaura, renueva o abre sesión según haga falta. */
  token(): Promise<string>;
  /** Descarta la sesión guardada y abre una nueva (tras un `401`). */
  reopen(): Promise<string>;
  clear(): void;
};

export function createSessionManager(deps: SessionDeps): SessionManager {
  const store = createStore(deps.widgetKey, deps.storage);
  let inFlight: Promise<string> | null = null;

  async function open(): Promise<string> {
    const session = await deps.api.openSession(deps.newKey());
    store.write(session);
    return session.token;
  }

  async function refresh(current: StoredSession): Promise<string> {
    try {
      const session = await deps.api.refreshSession(current.token, deps.newKey());
      store.write(session);
      return session.token;
    } catch (error) {
      if (error instanceof WidgetApiError && error.status === 401) {
        return open();
      }
      // Fallo pasajero: el token actual sigue sirviendo hasta que venza.
      return current.token;
    }
  }

  function resolve(): Promise<string> {
    const current = store.read();
    const remaining = current ? current.expiresAt - deps.now() : 0;
    if (!current || remaining <= 0) {
      return open();
    }
    return remaining < REFRESH_MARGIN_MS ? refresh(current) : Promise.resolve(current.token);
  }

  /** Varias llamadas a la vez comparten una sola apertura o renovación. */
  function once(task: () => Promise<string>): Promise<string> {
    inFlight ??= task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    token: () => once(resolve),
    reopen: () =>
      once(() => {
        store.clear();
        return open();
      }),
    clear: () => store.clear(),
  };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm --prefix frontend exec vitest run tests/widget-session.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci frontend/src/widget frontend/tests` → sin errores.

```bash
git add frontend/src/widget/session.ts frontend/tests/widget-session.test.ts
git commit -m "feat(widget): sesion del paciente con restauracion, renovacion y respaldo en memoria" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cliente del chat (`chat-client.ts`)

**Files:**
- Create: `frontend/src/widget/chat-client.ts`
- Test: `frontend/tests/widget-chat-client.test.ts`

**Interfaces:**
- Consumes: `WidgetApi`, `ConversationHistory`, `ConversationOption`, `ConversationMessageInput` de `./widget-api`; `SessionManager` de `./session`; `WidgetApiError` de `./fetcher`.
- Produces:
  - `type ChatMessage = { id: string; author: "bot" | "patient"; text: string }`.
  - `type ChatInputMode = "none" | "text" | "date"`.
  - `type ChatView = { messages: readonly ChatMessage[]; options: readonly ConversationOption[]; input: ChatInputMode }` y `EMPTY_VIEW`.
  - `type Outgoing = { kind: "option"; option: ConversationOption } | { kind: "text"; text: string }`.
  - `type SendOutcome = { kind: "turn" | "stale" | "reopened"; view: ChatView } | { kind: "invalid"; message: string }`.
  - `type ChatClient = { view(): ChatView; load(): Promise<ChatView>; send(outgoing: Outgoing): Promise<SendOutcome>; restart(): Promise<ChatView> }`.
  - `createChatClient(deps: { api: WidgetApi; session: SessionManager; newKey: () => string }): ChatClient`.
  - `send` **rechaza** con el `WidgetApiError` original en `403`, `429`, red y `5xx`. En red/`5xx` conserva la clave para el reintento del mismo envío.

- [ ] **Step 1: Escribir los tests (fallan)**

`frontend/tests/widget-chat-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createChatClient } from "@/widget/chat-client";
import { WidgetApiError } from "@/widget/fetcher";
import type { SessionManager } from "@/widget/session";
import type { ConversationHistory, ConversationTurn, WidgetApi } from "@/widget/widget-api";

const AT = "2026-10-13T15:00:00.000Z";

const WELCOME: ConversationHistory = {
  messages: [{ author: "bot", text: "Hola, soy el asistente.", redacted: false, created_at: AT }],
  options: [{ id: "1.1", label: "Agendar una cita" }],
  input: "none",
};

const ASK_DOCUMENT: ConversationTurn = {
  messages: ["Escribe tu número de documento."],
  options: [{ id: "2.1", label: "Volver al menú" }],
  input: "text",
};

function apiError(status: number, details?: Record<string, unknown>, message = "error") {
  return new WidgetApiError(status, { error: { code: "x", message, details } }, `HTTP ${status}`);
}

function setup(overrides: Partial<WidgetApi> = {}) {
  const api = {
    openSession: vi.fn<WidgetApi["openSession"]>(),
    refreshSession: vi.fn<WidgetApi["refreshSession"]>(),
    getConversation: vi.fn<WidgetApi["getConversation"]>(async () => WELCOME),
    sendMessage: vi.fn<WidgetApi["sendMessage"]>(async () => ASK_DOCUMENT),
    ...overrides,
  };
  const session = {
    token: vi.fn<SessionManager["token"]>(async () => "t1"),
    reopen: vi.fn<SessionManager["reopen"]>(async () => "t2"),
    clear: vi.fn<SessionManager["clear"]>(),
  };
  let keys = 0;
  const client = createChatClient({ api, session, newKey: () => `key-${++keys}` });
  return { api, session, client };
}

const AGENDAR = { kind: "option", option: { id: "1.1", label: "Agendar una cita" } } as const;

describe("cliente del chat", () => {
  it("load pinta el historial, las opciones y la entrada del turno", async () => {
    const { client } = setup();
    const view = await client.load();
    expect(view.messages).toEqual([{ id: "m0", author: "bot", text: "Hola, soy el asistente." }]);
    expect(view.options).toEqual(WELCOME.options);
    expect(view.input).toBe("none");
    expect(client.view()).toBe(view);
  });

  it("load reabre la sesión una vez si el backend responde 401", async () => {
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockRejectedValueOnce(apiError(401))
      .mockResolvedValueOnce(WELCOME);
    const { session, client } = setup({ getConversation });
    await client.load();
    expect(session.reopen).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(2);
  });

  it("enviar una opción añade su etiqueta como eco y las líneas del bot", async () => {
    const { api, client } = setup();
    await client.load();
    const outcome = await client.send(AGENDAR);
    expect(api.sendMessage).toHaveBeenCalledWith("t1", { option_id: "1.1" }, "key-1");
    expect(outcome.kind).toBe("turn");
    expect(client.view().messages.map((m) => `${m.author}:${m.text}`)).toEqual([
      "bot:Hola, soy el asistente.",
      "patient:Agendar una cita",
      "bot:Escribe tu número de documento.",
    ]);
    expect(client.view().input).toBe("text");
    expect(new Set(client.view().messages.map((m) => m.id)).size).toBe(3);
  });

  it("el eco del texto libre es el que guardó el backend, no lo que se escribió", async () => {
    const afterText: ConversationHistory = {
      ...WELCOME,
      messages: [
        ...WELCOME.messages,
        { author: "patient", text: "CC ••••5678", redacted: false, created_at: AT },
        { author: "bot", text: "[redactado]", redacted: true, created_at: AT },
      ],
    };
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockResolvedValueOnce(afterText);
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => ({
      messages: ["Confirma tus datos: Ana Pérez."],
      options: [],
      input: "none" as const,
    }));
    const { api, client } = setup({ getConversation, sendMessage });
    await client.load();
    await client.send({ kind: "text", text: "12345678" });
    expect(api.sendMessage).toHaveBeenCalledWith("t1", { text: "12345678" }, "key-1");
    const texts = client.view().messages.map((m) => m.text);
    expect(texts).toEqual([
      "Hola, soy el asistente.",
      "CC ••••5678",
      "Confirma tus datos: Ana Pérez.",
    ]);
    expect(texts).not.toContain("12345678");
  });

  it("si no se puede leer el eco, igual muestra las líneas del bot", async () => {
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockRejectedValueOnce(apiError(0));
    const { client } = setup({ getConversation });
    await client.load();
    const outcome = await client.send({ kind: "text", text: "hola" });
    expect(outcome.kind).toBe("turn");
    expect(client.view().messages.at(-1)?.text).toBe("Escribe tu número de documento.");
  });

  it("tras un fallo de red, reintentar el mismo envío reutiliza la Idempotency-Key", async () => {
    const sendMessage = vi
      .fn<WidgetApi["sendMessage"]>()
      .mockRejectedValueOnce(apiError(0))
      .mockResolvedValueOnce(ASK_DOCUMENT)
      .mockResolvedValueOnce(ASK_DOCUMENT);
    const { client } = setup({ sendMessage });
    await client.load();
    await expect(client.send(AGENDAR)).rejects.toMatchObject({ status: 0 });
    await client.send(AGENDAR);
    await client.send({ kind: "option", option: { id: "2.1", label: "Volver al menú" } });
    expect(sendMessage.mock.calls.map((call) => call[2])).toEqual(["key-1", "key-1", "key-2"]);
  });

  it("tras un fallo de red, un envío distinto usa otra clave", async () => {
    const sendMessage = vi
      .fn<WidgetApi["sendMessage"]>()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce(ASK_DOCUMENT);
    const { client } = setup({ sendMessage });
    await client.load();
    await expect(client.send(AGENDAR)).rejects.toMatchObject({ status: 503 });
    await client.send({ kind: "text", text: "otra cosa" });
    expect(sendMessage.mock.calls.map((call) => call[2])).toEqual(["key-1", "key-2"]);
  });

  it("409 stale_option recarga el turno vigente", async () => {
    const current: ConversationHistory = { ...WELCOME, options: [{ id: "3.1", label: "Menú" }] };
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockResolvedValueOnce(current);
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(409, { reason: "stale_option" });
    });
    const { client } = setup({ getConversation, sendMessage });
    await client.load();
    const outcome = await client.send(AGENDAR);
    expect(outcome.kind).toBe("stale");
    expect(client.view().options).toEqual([{ id: "3.1", label: "Menú" }]);
  });

  it("401 al enviar abre sesión nueva, recarga y no reenvía el turno", async () => {
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(401);
    });
    const { api, session, client } = setup({ sendMessage });
    await client.load();
    const outcome = await client.send(AGENDAR);
    expect(outcome.kind).toBe("reopened");
    expect(session.reopen).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(api.getConversation).toHaveBeenCalledTimes(2);
  });

  it("422 devuelve el mensaje del backend y deja el turno como estaba", async () => {
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(422, { field: "text" }, "text debe tener entre 1 y 500 caracteres");
    });
    const { client } = setup({ sendMessage });
    const before = await client.load();
    const outcome = await client.send({ kind: "text", text: "x" });
    expect(outcome).toEqual({
      kind: "invalid",
      message: "text debe tener entre 1 y 500 caracteres",
    });
    expect(client.view()).toBe(before);
  });

  it("403 se propaga para que la interfaz lo muestre como terminal", async () => {
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(403);
    });
    const { client } = setup({ sendMessage });
    await client.load();
    await expect(client.send(AGENDAR)).rejects.toMatchObject({ status: 403 });
  });

  it("un doble clic manda una sola petición", async () => {
    const { api, client } = setup();
    await client.load();
    const [first, second] = await Promise.all([client.send(AGENDAR), client.send(AGENDAR)]);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(client.view().messages).toHaveLength(3);
  });

  it("restart borra la sesión y vuelve a cargar", async () => {
    const { api, session, client } = setup();
    await client.load();
    await client.restart();
    expect(session.clear).toHaveBeenCalledTimes(1);
    expect(api.getConversation).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm --prefix frontend exec vitest run tests/widget-chat-client.test.ts`
Expected: FAIL — no se puede resolver `@/widget/chat-client`.

- [ ] **Step 3: Implementar `chat-client.ts`**

`frontend/src/widget/chat-client.ts`:

```ts
import { WidgetApiError } from "./fetcher";
import type { SessionManager } from "./session";
import type {
  ConversationHistory,
  ConversationMessageInput,
  ConversationOption,
  WidgetApi,
} from "./widget-api";

export type ChatMessage = {
  readonly id: string;
  readonly author: "bot" | "patient";
  readonly text: string;
};
export type ChatInputMode = "none" | "text" | "date";
export type ChatView = {
  readonly messages: readonly ChatMessage[];
  readonly options: readonly ConversationOption[];
  readonly input: ChatInputMode;
};
export const EMPTY_VIEW: ChatView = { messages: [], options: [], input: "none" };

export type Outgoing =
  | { readonly kind: "option"; readonly option: ConversationOption }
  | { readonly kind: "text"; readonly text: string };

export type SendOutcome =
  | { readonly kind: "turn" | "stale" | "reopened"; readonly view: ChatView }
  | { readonly kind: "invalid"; readonly message: string };

export type ChatClient = {
  view(): ChatView;
  load(): Promise<ChatView>;
  send(outgoing: Outgoing): Promise<SendOutcome>;
  restart(): Promise<ChatView>;
};

export type ChatDeps = {
  readonly api: WidgetApi;
  readonly session: SessionManager;
  readonly newKey: () => string;
};

type Line = Omit<ChatMessage, "id">;

/** El id es la posición en la lista: estable mientras la conversación solo crece. */
function numbered(lines: readonly Line[]): ChatMessage[] {
  return lines.map((line, index) => ({ ...line, id: `m${index}` }));
}

function toView(history: ConversationHistory): ChatView {
  const lines = history.messages.map((m): Line => ({ author: m.author, text: m.text }));
  return { messages: numbered(lines), options: history.options, input: history.input };
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof WidgetApiError && error.status === 401;
}

export function createChatClient(deps: ChatDeps): ChatClient {
  let current: ChatView = EMPTY_VIEW;
  let pending: { readonly signature: string; readonly key: string } | null = null;
  let sending: Promise<SendOutcome> | null = null;

  async function history(retry = true): Promise<ConversationHistory> {
    try {
      return await deps.api.getConversation(await deps.session.token());
    } catch (error) {
      if (retry && isUnauthorized(error)) {
        await deps.session.reopen();
        return history(false);
      }
      throw error;
    }
  }

  async function reload(): Promise<ChatView> {
    current = toView(await history());
    return current;
  }

  /** Misma clave mientras el mismo envío no haya tenido respuesta del backend. */
  function keyFor(body: ConversationMessageInput): string {
    const signature = JSON.stringify(body);
    if (pending?.signature !== signature) {
      pending = { signature, key: deps.newKey() };
    }
    return pending.key;
  }

  /** Opción: su etiqueta. Texto libre: lo que el backend guardó (redactado o enmascarado). */
  async function echoOf(outgoing: Outgoing): Promise<Line[]> {
    if (outgoing.kind === "option") {
      return [{ author: "patient", text: outgoing.option.label }];
    }
    try {
      const last = (await history()).messages.filter((m) => m.author === "patient").at(-1);
      return last ? [{ author: "patient", text: last.text }] : [];
    } catch {
      return [];
    }
  }

  async function recover(error: unknown): Promise<SendOutcome> {
    if (!(error instanceof WidgetApiError) || error.retryable) {
      throw error;
    }
    pending = null;
    if (error.status === 409 && error.reason === "stale_option") {
      return { kind: "stale", view: await reload() };
    }
    if (error.status === 401) {
      await deps.session.reopen();
      return { kind: "reopened", view: await reload() };
    }
    if (error.status === 422) {
      return { kind: "invalid", message: error.message };
    }
    throw error;
  }

  async function deliver(outgoing: Outgoing): Promise<SendOutcome> {
    const body: ConversationMessageInput =
      outgoing.kind === "option" ? { option_id: outgoing.option.id } : { text: outgoing.text };
    try {
      const turn = await deps.api.sendMessage(await deps.session.token(), body, keyFor(body));
      pending = null;
      const bot = turn.messages.map((text): Line => ({ author: "bot", text }));
      const lines = [...current.messages, ...(await echoOf(outgoing)), ...bot];
      current = { messages: numbered(lines), options: turn.options, input: turn.input };
      return { kind: "turn", view: current };
    } catch (error) {
      return recover(error);
    }
  }

  return {
    view: () => current,
    load: reload,
    /** Un envío a la vez: un doble clic recibe la misma promesa, no un segundo turno. */
    send(outgoing) {
      sending ??= deliver(outgoing).finally(() => {
        sending = null;
      });
      return sending;
    },
    restart() {
      deps.session.clear();
      pending = null;
      return reload();
    },
  };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm --prefix frontend exec vitest run tests/widget-chat-client.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci frontend/src/widget frontend/tests` → sin errores.

```bash
git add frontend/src/widget/chat-client.ts frontend/tests/widget-chat-client.test.ts
git commit -m "feat(widget): cliente del chat con reintento idempotente, eco del backend y turno caducado" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Interfaz del widget (`failure`, `use-chat`, `styles`, `chat-widget`)

**Files:**
- Create: `frontend/src/widget/failure.ts`, `frontend/src/widget/use-chat.ts`, `frontend/src/widget/styles.ts`, `frontend/src/widget/chat-widget.tsx`
- Test: `frontend/tests/widget-failure.test.ts`

**Interfaces:**
- Consumes: `createWidgetApi`, `WidgetConfig`, `ConversationOption` (`./widget-api`); `createSessionManager`, `browserStorage` (`./session`); `createChatClient`, `ChatClient`, `ChatView`, `ChatMessage`, `ChatInputMode`, `Outgoing`, `SendOutcome`, `EMPTY_VIEW` (`./chat-client`); `WidgetApiError` (`./fetcher`).
- Produces:
  - `type Failure = { text: string; terminal: boolean; waitSeconds: number }` y `describeFailure(error: unknown): Failure`.
  - `useChat(config: WidgetConfig): { state: ChatState; choose(option: ConversationOption): void; submit(text: string): void; retry(): void }` con `type ChatState = { phase: "loading" | "ready" | "sending" | "failed"; view: ChatView; notice: string | null; failure: Failure | null }`.
  - `WIDGET_CSS: string`.
  - `ChatWidget(props: { apiBase: string; widgetKey: string; mode: "floating" | "fill" })`. **Para cambiar de clave o reiniciar la sesión, el padre lo remonta con otra `key`**: el componente crea su cliente una sola vez.

- [ ] **Step 1: Escribir el test de `describeFailure` (falla)**

`frontend/tests/widget-failure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeFailure } from "@/widget/failure";
import { WidgetApiError } from "@/widget/fetcher";

function apiError(status: number, details?: Record<string, unknown>) {
  const body = { error: { code: "x", message: "detalle interno r-123", details } };
  return new WidgetApiError(status, body, `HTTP ${status}`);
}

describe("fallos que ve el paciente", () => {
  it("backend inalcanzable: aviso reintentable, sin detalle técnico", () => {
    const failure = describeFailure(new WidgetApiError(0, null, "Sin conexión con el servidor"));
    expect(failure.terminal).toBe(false);
    expect(failure.waitSeconds).toBe(0);
    expect(failure.text).toMatch(/conexión/i);
  });

  it("403: el sitio no está autorizado y no hay reintento", () => {
    const failure = describeFailure(apiError(403));
    expect(failure.terminal).toBe(true);
    expect(failure.text).toBe("Este sitio no está autorizado para el chat.");
  });

  it("401 al abrir sesión (clave inválida): terminal", () => {
    expect(describeFailure(apiError(401)).terminal).toBe(true);
  });

  it("429: espera los segundos que dice el backend", () => {
    const failure = describeFailure(apiError(429, { retry_after_seconds: 42 }));
    expect(failure.waitSeconds).toBe(42);
    expect(failure.text).toContain("42");
    expect(failure.terminal).toBe(false);
  });

  it("429 sin segundos espera un minuto", () => {
    expect(describeFailure(apiError(429)).waitSeconds).toBe(60);
  });

  it("nunca muestra el mensaje interno ni códigos", () => {
    for (const error of [apiError(500), apiError(409), new Error("boom r-123")]) {
      const failure = describeFailure(error);
      expect(failure.text).not.toMatch(/r-123|HTTP|\d{3}/);
      expect(failure.terminal).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm --prefix frontend exec vitest run tests/widget-failure.test.ts`
Expected: FAIL — no se puede resolver `@/widget/failure`.

- [ ] **Step 3: Implementar `failure.ts`**

`frontend/src/widget/failure.ts`:

```ts
import { WidgetApiError } from "./fetcher";

/** Lo que ve el paciente ante un fallo de transporte: nunca códigos ni `request_id`. */
export type Failure = {
  readonly text: string;
  /** Sin reintento posible (sitio no autorizado, clave inválida). */
  readonly terminal: boolean;
  /** Segundos que el botón «Reintentar» queda bloqueado. */
  readonly waitSeconds: number;
};

const GENERIC: Failure = {
  text: "Algo salió mal. Inténtalo de nuevo.",
  terminal: false,
  waitSeconds: 0,
};

const DEFAULT_WAIT_SECONDS = 60;

export function describeFailure(error: unknown): Failure {
  if (!(error instanceof WidgetApiError)) {
    return GENERIC;
  }
  if (error.status === 0) {
    return { ...GENERIC, text: "No hay conexión con el servidor. Revisa tu internet y reintenta." };
  }
  if (error.status === 403) {
    return { text: "Este sitio no está autorizado para el chat.", terminal: true, waitSeconds: 0 };
  }
  if (error.status === 401) {
    return { text: "El chat no está disponible en este momento.", terminal: true, waitSeconds: 0 };
  }
  if (error.status === 429) {
    const waitSeconds = error.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS;
    return {
      text: `Hay muchas solicitudes. Espera ${waitSeconds} segundos y vuelve a intentarlo.`,
      terminal: false,
      waitSeconds,
    };
  }
  return GENERIC;
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm --prefix frontend exec vitest run tests/widget-failure.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implementar `use-chat.ts`**

`frontend/src/widget/use-chat.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatClient,
  type ChatView,
  createChatClient,
  EMPTY_VIEW,
  type Outgoing,
  type SendOutcome,
} from "./chat-client";
import { describeFailure, type Failure } from "./failure";
import { browserStorage, createSessionManager } from "./session";
import { type ConversationOption, createWidgetApi, type WidgetConfig } from "./widget-api";

export type ChatState = {
  readonly phase: "loading" | "ready" | "sending" | "failed";
  readonly view: ChatView;
  /** Aviso del turno (dato inválido, opción caducada, sesión vencida). */
  readonly notice: string | null;
  readonly failure: Failure | null;
};

const INITIAL: ChatState = { phase: "loading", view: EMPTY_VIEW, notice: null, failure: null };

const NOTICES = {
  stale: "Esa opción ya no estaba vigente. Estas son las opciones actuales.",
  reopened: "La sesión venció. Empezamos de nuevo.",
} as const;

function buildClient(config: WidgetConfig): ChatClient {
  const api = createWidgetApi(config);
  const newKey = () => crypto.randomUUID();
  const session = createSessionManager({
    api,
    widgetKey: config.widgetKey,
    storage: browserStorage(),
    now: () => Date.now(),
    newKey,
  });
  return createChatClient({ api, session, newKey });
}

function afterSend(outcome: SendOutcome, previous: ChatView): ChatState {
  if (outcome.kind === "invalid") {
    return { phase: "ready", view: previous, notice: outcome.message, failure: null };
  }
  const notice = outcome.kind === "turn" ? null : NOTICES[outcome.kind];
  return { phase: "ready", view: outcome.view, notice, failure: null };
}

/** Estado de React sobre el cliente del chat. El cliente se crea una vez por montaje. */
export function useChat(config: WidgetConfig) {
  const [client] = useState(() => buildClient(config));
  const [state, setState] = useState<ChatState>(INITIAL);
  const lastSend = useRef<Outgoing | null>(null);

  const fail = useCallback((error: unknown) => {
    setState((s) => ({ ...s, phase: "failed", failure: describeFailure(error) }));
  }, []);

  const load = useCallback(async () => {
    lastSend.current = null;
    setState((s) => ({ ...s, phase: "loading", failure: null }));
    try {
      const view = await client.load();
      setState({ phase: "ready", view, notice: null, failure: null });
    } catch (error) {
      fail(error);
    }
  }, [client, fail]);

  const send = useCallback(
    async (outgoing: Outgoing) => {
      lastSend.current = outgoing;
      setState((s) => ({ ...s, phase: "sending", notice: null, failure: null }));
      try {
        const outcome = await client.send(outgoing);
        lastSend.current = null;
        setState((s) => afterSend(outcome, s.view));
      } catch (error) {
        fail(error);
      }
    },
    [client, fail],
  );

  useEffect(() => {
    load();
  }, [load]);

  return {
    state,
    choose: (option: ConversationOption) => {
      send({ kind: "option", option });
    },
    submit: (text: string) => {
      send({ kind: "text", text });
    },
    /** Repite el envío que falló (misma `Idempotency-Key`) o, si falló la carga, recarga. */
    retry: () => {
      if (lastSend.current) {
        send(lastSend.current);
      } else {
        load();
      }
    },
  };
}
```

- [ ] **Step 6: Implementar `styles.ts`**

`frontend/src/widget/styles.ts`:

```ts
/**
 * Estilos del widget como cadena: el mismo `<style>` sirve dentro del Shadow DOM del script
 * y en las páginas del frontend. Prefijo `iw-`, sin fuentes externas ni dependencia de
 * `globals.css`. Morado de marca Ingenius360 sobre superficie clara.
 */
export const WIDGET_CSS = `
.iw-root {
  --iw-accent: #7336f2;
  --iw-accent-hi: #5f25d9;
  --iw-ink: #1d1840;
  --iw-ink-2: #5b557a;
  --iw-ground: #ffffff;
  --iw-soft: #f3f0fc;
  --iw-rule: #ddd6f3;
  --iw-danger: #a3261f;
  box-sizing: border-box;
  color: var(--iw-ink);
  font: 400 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.iw-root *, .iw-root *::before, .iw-root *::after { box-sizing: inherit; }
.iw-root[data-mode="fill"] { height: 100%; }
.iw-root[data-mode="floating"] {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  display: grid;
  justify-items: end;
  gap: 12px;
}
.iw-popup {
  width: min(380px, calc(100vw - 24px));
  height: min(600px, calc(100dvh - 96px));
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(29, 24, 64, 0.28);
}
.iw-launcher, .iw-send, .iw-retry {
  border: 0;
  border-radius: 999px;
  background: var(--iw-accent);
  color: #ffffff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.iw-launcher { min-height: 48px; padding: 0 20px; box-shadow: 0 6px 20px rgba(29, 24, 64, 0.3); }
.iw-send, .iw-retry { min-height: 40px; padding: 0 16px; }
.iw-launcher:hover, .iw-send:hover, .iw-retry:hover { background: var(--iw-accent-hi); }
.iw-panel { display: flex; flex-direction: column; height: 100%; background: var(--iw-ground); }
.iw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--iw-accent);
  color: #ffffff;
}
.iw-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.iw-close:hover { background: rgba(255, 255, 255, 0.18); }
.iw-log {
  flex: 1 1 0;
  min-height: 0;
  margin: 0;
  padding: 16px;
  overflow-y: auto;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.iw-msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.iw-msg[data-author="bot"] { align-self: flex-start; background: var(--iw-soft); }
.iw-msg[data-author="patient"] {
  align-self: flex-end;
  background: var(--iw-accent);
  color: #ffffff;
}
.iw-status { color: var(--iw-ink-2); }
.iw-notice, .iw-failure { margin: 0; padding: 8px 16px; font-size: 14px; }
.iw-notice { background: var(--iw-soft); color: var(--iw-ink-2); }
.iw-failure { display: grid; gap: 8px; justify-items: start; color: var(--iw-danger); }
.iw-controls { display: grid; gap: 8px; padding: 12px 16px 16px; border-top: 1px solid var(--iw-rule); }
.iw-options { display: flex; flex-wrap: wrap; gap: 8px; }
.iw-option {
  min-height: 40px;
  padding: 6px 14px;
  border: 1px solid var(--iw-accent);
  border-radius: 999px;
  background: var(--iw-ground);
  color: var(--iw-accent);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.iw-option:hover { background: var(--iw-soft); }
.iw-form { display: flex; gap: 8px; }
.iw-input {
  flex: 1 1 0;
  min-width: 0;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--iw-rule);
  border-radius: 10px;
  background: var(--iw-ground);
  color: var(--iw-ink);
  font: inherit;
}
.iw-root button:disabled, .iw-input:disabled { opacity: 0.55; cursor: not-allowed; }
.iw-root :focus-visible { outline: 2px solid var(--iw-ink); outline-offset: 2px; }
.iw-head :focus-visible { outline-color: #ffffff; }
`;
```

- [ ] **Step 7: Implementar `chat-widget.tsx`**

`frontend/src/widget/chat-widget.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatInputMode, ChatMessage, ChatView } from "./chat-client";
import type { Failure } from "./failure";
import { WIDGET_CSS } from "./styles";
import { useChat } from "./use-chat";
import type { ConversationOption, WidgetConfig } from "./widget-api";

/** Tope del contrato para el texto de un turno (`ConversationMessageInput.text`). */
const MAX_TEXT_LENGTH = 500;

export type ChatWidgetProps = WidgetConfig & { readonly mode: "floating" | "fill" };

function MessageList({
  messages,
  loading,
}: {
  readonly messages: readonly ChatMessage[];
  readonly loading: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  const count = messages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: baja al final cada vez que llega un mensaje
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return (
    <ol className="iw-log" aria-live="polite" aria-label="Conversación">
      {messages.map((message) => (
        <li key={message.id} className="iw-msg" data-author={message.author}>
          {message.text}
        </li>
      ))}
      {loading ? <li className="iw-status">Cargando…</li> : null}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

function InputForm({
  mode,
  disabled,
  onSubmit,
}: {
  readonly mode: Exclude<ChatInputMode, "none">;
  readonly disabled: boolean;
  readonly onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="iw-form"
      action={() => {
        const value = draft.trim();
        if (value) {
          onSubmit(value);
          setDraft("");
        }
      }}
    >
      <input
        className="iw-input"
        type={mode === "date" ? "date" : "text"}
        aria-label={mode === "date" ? "Fecha" : "Tu respuesta"}
        autoComplete="off"
        maxLength={MAX_TEXT_LENGTH}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="iw-send" disabled={disabled || !draft.trim()}>
        Enviar
      </button>
    </form>
  );
}

function Controls({
  view,
  disabled,
  onChoose,
  onSubmit,
}: {
  readonly view: ChatView;
  readonly disabled: boolean;
  readonly onChoose: (option: ConversationOption) => void;
  readonly onSubmit: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // El foco pasa al primer control del turno nuevo; no al montar, para no robarlo a la página.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se dispara al cambiar de turno
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [view]);
  return (
    <div className="iw-controls" ref={box}>
      {view.input === "none" ? null : (
        <InputForm mode={view.input} disabled={disabled} onSubmit={onSubmit} />
      )}
      {view.options.length > 0 ? (
        <div className="iw-options">
          {view.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="iw-option"
              disabled={disabled}
              onClick={() => onChoose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FailureBox({
  failure,
  onRetry,
}: {
  readonly failure: Failure;
  readonly onRetry: () => void;
}) {
  const [waiting, setWaiting] = useState(failure.waitSeconds > 0);
  useEffect(() => {
    if (failure.waitSeconds <= 0) {
      return;
    }
    const timer = setTimeout(() => setWaiting(false), failure.waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [failure.waitSeconds]);
  return (
    <div className="iw-failure" role="alert">
      <span>{failure.text}</span>
      {failure.terminal ? null : (
        <button type="button" className="iw-retry" disabled={waiting} onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

function ChatPanel({
  config,
  onClose,
}: {
  readonly config: WidgetConfig;
  readonly onClose?: () => void;
}) {
  const chat = useChat(config);
  const { state } = chat;
  return (
    <section className="iw-panel" aria-label="Chat de atención">
      <header className="iw-head">
        <strong>Asistente virtual</strong>
        {onClose ? (
          <button type="button" className="iw-close" onClick={onClose} aria-label="Cerrar chat">
            ×
          </button>
        ) : null}
      </header>
      <MessageList messages={state.view.messages} loading={state.phase === "loading"} />
      {state.notice ? (
        <p className="iw-notice" role="status">
          {state.notice}
        </p>
      ) : null}
      {state.failure ? (
        <FailureBox key={state.failure.text} failure={state.failure} onRetry={chat.retry} />
      ) : (
        <Controls
          view={state.view}
          disabled={state.phase !== "ready"}
          onChoose={chat.choose}
          onSubmit={chat.submit}
        />
      )}
    </section>
  );
}

function Floating({ config }: { readonly config: WidgetConfig }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      {open ? (
        <div className="iw-popup">
          <ChatPanel config={config} onClose={() => setOpen(false)} />
        </div>
      ) : null}
      <button
        type="button"
        className="iw-launcher"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Cerrar chat" : "Chat"}
      </button>
    </>
  );
}

/**
 * Widget del chat. Pinta solo lo que el backend devuelve; no decide ningún paso del flujo.
 * Crea su cliente una vez: para otra clave u otra sesión, el padre lo remonta con otra `key`.
 */
export function ChatWidget({ mode, apiBase, widgetKey }: ChatWidgetProps) {
  const config: WidgetConfig = { apiBase, widgetKey };
  return (
    <div className="iw-root" data-mode={mode}>
      <style>{WIDGET_CSS}</style>
      {mode === "floating" ? <Floating config={config} /> : <ChatPanel config={config} />}
    </div>
  );
}
```

Nota: cerrar el panel flotante desmonta `ChatPanel`; al reabrirlo, la conversación se restaura del backend con la sesión guardada. Es intencional (un solo camino de carga).

- [ ] **Step 8: Puertas de la tarea**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci frontend/src/widget frontend/tests` → sin errores. Si Biome marca un `biome-ignore` como innecesario, quitar ese comentario; si marca otra regla, arreglar el código (no añadir supresiones nuevas).
Run: `npm --prefix frontend test` → PASS.
Run: `npm --prefix frontend run doctor` → pasa. Si React Doctor señala algo en `src/widget/`, arreglar el componente; no silenciar la regla.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/widget/failure.ts frontend/src/widget/use-chat.ts frontend/src/widget/styles.ts frontend/src/widget/chat-widget.tsx frontend/tests/widget-failure.test.ts
git commit -m "feat(widget): interfaz del chat con estados de fallo, aviso de turno y modos flotante y completo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Grupos de rutas, `PUBLIC_BACKEND_URL` y página `/widget` (iframe)

**Files:**
- Modify: `frontend/src/app/layout.tsx`, `frontend/src/config/env.ts`, `frontend/src/app/globals.css`, `frontend/.env.example`, `docker-compose.yml`
- Create: `frontend/src/app/(console)/layout.tsx`, `frontend/src/app/(embed)/widget/page.tsx`
- Rename: `frontend/src/app/page.tsx`, `frontend/src/app/panel/`, `frontend/src/app/simulador/` → dentro de `frontend/src/app/(console)/`
- Test: `frontend/tests/env.test.ts`

**Interfaces:**
- Consumes: `ChatWidget` de `@/widget/chat-widget` (Tarea 4).
- Produces: `publicBackendUrl(): string` en `@/config/env` (sin barra final; por defecto `http://localhost:3001`). Grupo `(console)` con la cabecera del panel; grupo `(embed)` sin ella. Ruta `/widget?key=<clave>`.

- [ ] **Step 1: Test de `publicBackendUrl` (falla)**

`frontend/tests/env.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicBackendUrl } from "@/config/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuración del frontend", () => {
  it("por defecto apunta al backend local", () => {
    vi.stubEnv("PUBLIC_BACKEND_URL", undefined);
    expect(publicBackendUrl()).toBe("http://localhost:3001");
  });

  it("usa PUBLIC_BACKEND_URL y le quita la barra final", () => {
    vi.stubEnv("PUBLIC_BACKEND_URL", "https://api.clinica.co/");
    expect(publicBackendUrl()).toBe("https://api.clinica.co");
  });
});
```

Run: `npm --prefix frontend exec vitest run tests/env.test.ts`
Expected: FAIL — `publicBackendUrl` no está exportada.

- [ ] **Step 2: Implementar `publicBackendUrl`**

Añadir al final de `frontend/src/config/env.ts`:

```ts

/**
 * URL del backend alcanzable **desde el navegador**: el widget habla directo con él por CORS.
 * Distinta de `BACKEND_URL`, que puede ser una dirección interna de la red de contenedores.
 * También se lee en runtime: las páginas que la usan son dinámicas.
 */
export function publicBackendUrl(): string {
  return (process.env.PUBLIC_BACKEND_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}
```

Run: `npm --prefix frontend exec vitest run tests/env.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Mover las páginas existentes al grupo `(console)`**

```bash
mkdir -p "frontend/src/app/(console)" "frontend/src/app/(embed)/widget"
git mv frontend/src/app/page.tsx "frontend/src/app/(console)/page.tsx"
git mv frontend/src/app/panel "frontend/src/app/(console)/panel"
git mv frontend/src/app/simulador "frontend/src/app/(console)/simulador"
```

`frontend/src/app/api/`, `globals.css`, `icon.png` y `layout.tsx` se quedan donde están.

- [ ] **Step 4: Partir el layout**

En `frontend/src/app/layout.tsx`: quitar los imports de `Providers` y `Marquee`, y dejar el componente así (fuentes, `metadata` y `viewport` no cambian):

```tsx
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${ui.variable} ${data.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

`frontend/src/app/(console)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { Marquee } from "@/components/shell/marquee";

/** Consola operativa: cabecera, sesión del panel y caché de consultas. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Marquee />
      <main className="page">{children}</main>
    </Providers>
  );
}
```

- [ ] **Step 5: Página del iframe**

`frontend/src/app/(embed)/widget/page.tsx`:

```tsx
import type { Metadata } from "next";
import { publicBackendUrl } from "@/config/env";
import { ChatWidget } from "@/widget/chat-widget";

// `PUBLIC_BACKEND_URL` se lee en cada petición, no en el build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chat" };

type Props = { searchParams: Promise<{ key?: string | string[] }> };

/** Página para incrustar por iframe: el widget a marco completo, sin cabecera de panel. */
export default async function WidgetPage({ searchParams }: Props) {
  const { key } = await searchParams;
  const widgetKey = (Array.isArray(key) ? key[0] : key)?.trim() ?? "";
  if (!widgetKey) {
    return (
      <main className="embed-frame embed-empty">
        <strong>Falta la clave del widget</strong>
        <span>
          Usa <code>/widget?key=&lt;clave&gt;</code> con la clave vigente del tenant.
        </span>
      </main>
    );
  }
  return (
    <main className="embed-frame">
      <ChatWidget apiBase={publicBackendUrl()} widgetKey={widgetKey} mode="fill" />
    </main>
  );
}
```

Añadir al final de `frontend/src/app/globals.css`:

```css

/* ---------- Página incrustable (/widget) ---------- */

.embed-frame {
  height: 100dvh;
}

.embed-empty {
  display: grid;
  place-content: center;
  gap: 4px;
  padding: 24px;
  text-align: center;
  color: var(--ink-2);
}
```

- [ ] **Step 6: Documentar la variable**

`frontend/.env.example` queda:

```
# Leída en runtime por el proxy /api/* (no se hornea en el build).
BACKEND_URL=http://localhost:3001
# URL del backend alcanzable desde el navegador: el widget del chat habla directo con él.
PUBLIC_BACKEND_URL=http://localhost:3001
```

En `docker-compose.yml`, servicio `frontend`, `environment` queda:

```yaml
      NODE_ENV: production
      BACKEND_URL: http://backend:3001
      PUBLIC_BACKEND_URL: ${PUBLIC_BACKEND_URL:-http://localhost:3001}
```

- [ ] **Step 7: Verificar que las rutas siguen en su sitio**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npm --prefix frontend run build`
Expected: compila y la tabla de rutas lista `/`, `/panel`, `/panel/ajustes`, `/simulador`, `/widget` y `/api/[...path]` (los paréntesis de los grupos no aparecen en las URL).

Run: `npx biome ci .` → sin errores. Run: `npm --prefix frontend test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(console)" "frontend/src/app/(embed)" frontend/src/app/layout.tsx frontend/src/app/page.tsx frontend/src/app/panel frontend/src/app/simulador frontend/src/app/globals.css frontend/src/config/env.ts frontend/.env.example frontend/tests/env.test.ts docker-compose.yml
git commit -m "feat(frontend): grupos de rutas consola/embebido y pagina /widget para iframe" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add` de las rutas antiguas registra los borrados del `git mv`; si git avisa de que ya no existen, es lo esperado.)

---

### Task 6: Script incrustable (`widget.js`)

**Files:**
- Create: `frontend/src/widget/embed-config.ts`, `frontend/src/widget/embed.tsx`, `frontend/scripts/build-widget.mjs`, `frontend/scripts/serve-host.mjs`
- Modify: `frontend/package.json` (+ `frontend/package-lock.json`), `.gitignore`
- Test: `frontend/tests/widget-embed-config.test.ts`

**Interfaces:**
- Consumes: `ChatWidget` (Tarea 4), `WidgetConfig` (Tarea 1).
- Produces:
  - `HOST_ID = "ingenius360-widget"`.
  - `readEmbedConfig(dataset: { key?: string; api?: string }): WidgetConfig | null`.
  - `alreadyMounted(doc: Pick<Document, "getElementById">): boolean`.
  - `frontend/public/widget.js` (generado, fuera de git) vía `npm --prefix frontend run build:widget`.
  - `npm --prefix frontend run host:demo -- <clave> [api] [puerto]`: página anfitriona de prueba en otro origen.

- [ ] **Step 1: Tests de la configuración del script (fallan)**

`frontend/tests/widget-embed-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alreadyMounted, HOST_ID, readEmbedConfig } from "@/widget/embed-config";

describe("configuración del script incrustable", () => {
  it("lee la clave y el origen del backend", () => {
    expect(readEmbedConfig({ key: " wk_demo ", api: "https://api.clinica.co/" })).toEqual({
      apiBase: "https://api.clinica.co",
      widgetKey: "wk_demo",
    });
  });

  it("se queda con el origen aunque data-api traiga ruta", () => {
    expect(readEmbedConfig({ key: "wk", api: "http://localhost:3001/api/v1" })?.apiBase).toBe(
      "http://localhost:3001",
    );
  });

  it("sin clave o sin backend no hay configuración", () => {
    expect(readEmbedConfig({ api: "https://api.clinica.co" })).toBeNull();
    expect(readEmbedConfig({ key: "wk" })).toBeNull();
    expect(readEmbedConfig({ key: "   ", api: "https://api.clinica.co" })).toBeNull();
  });

  it("rechaza un data-api que no es http(s)", () => {
    expect(readEmbedConfig({ key: "wk", api: "javascript:alert(1)" })).toBeNull();
    expect(readEmbedConfig({ key: "wk", api: "api.clinica.co" })).toBeNull();
  });

  it("el fragmento pegado dos veces monta un solo widget", () => {
    const empty = { getElementById: () => null };
    const mounted = {
      getElementById: (id: string) => (id === HOST_ID ? ({} as HTMLElement) : null),
    };
    expect(alreadyMounted(empty)).toBe(false);
    expect(alreadyMounted(mounted)).toBe(true);
  });
});
```

Run: `npm --prefix frontend exec vitest run tests/widget-embed-config.test.ts`
Expected: FAIL — no se puede resolver `@/widget/embed-config`.

- [ ] **Step 2: Implementar `embed-config.ts`**

`frontend/src/widget/embed-config.ts`:

```ts
import type { WidgetConfig } from "./widget-api";

/** Id del elemento anfitrión: su presencia indica que el widget ya está montado. */
export const HOST_ID = "ingenius360-widget";

export type EmbedDataset = { readonly key?: string; readonly api?: string };

function backendOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Lee `data-key` y `data-api` del `<script>`; `null` si falta alguno o el backend no es http(s). */
export function readEmbedConfig(dataset: EmbedDataset): WidgetConfig | null {
  const widgetKey = dataset.key?.trim() ?? "";
  const apiBase = backendOrigin(dataset.api?.trim() ?? "");
  return widgetKey && apiBase ? { apiBase, widgetKey } : null;
}

/** El fragmento pegado dos veces (plantilla + gestor de etiquetas) monta un solo widget. */
export function alreadyMounted(doc: Pick<Document, "getElementById">): boolean {
  return doc.getElementById(HOST_ID) !== null;
}
```

Run: `npm --prefix frontend exec vitest run tests/widget-embed-config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Punto de entrada del script**

`frontend/src/widget/embed.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { ChatWidget } from "./chat-widget";
import { alreadyMounted, HOST_ID, readEmbedConfig } from "./embed-config";

/**
 * Entrada del script incrustable (`widget.js`). El tenant lo pega en su página con
 * `data-key` y `data-api`; el widget se dibuja en un Shadow DOM para que los estilos del
 * sitio y los del widget no se pisen.
 */

// `currentScript` solo existe mientras el script se ejecuta: se lee antes de cualquier espera.
const script = document.currentScript;

function mount(): void {
  const config = readEmbedConfig(script instanceof HTMLScriptElement ? script.dataset : {});
  if (!config) {
    console.error("[Ingenius360] El script del chat necesita data-key y data-api (http o https).");
    return;
  }
  if (alreadyMounted(document)) {
    return;
  }
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);
  createRoot(host.attachShadow({ mode: "open" })).render(<ChatWidget {...config} mode="floating" />);
}

if (document.body) {
  mount();
} else {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
}
```

- [ ] **Step 4: Empaquetado con esbuild**

Run: `npm --prefix frontend install --save-dev esbuild@0.28.2`
Expected: `frontend/package.json` gana `"esbuild": "^0.28.2"` en `devDependencies` (ya estaba instalado como dependencia transitiva; el lock cambia poco).

`frontend/scripts/build-widget.mjs`:

```js
import { stat } from "node:fs/promises";
import { build } from "esbuild";

/**
 * Empaqueta el widget del chat en un único archivo autocontenido (React incluido) para
 * pegarlo en sitios de terceros. Se ejecuta desde `frontend/`.
 */
const outfile = "public/widget.js";

await build({
  entryPoints: ["src/widget/embed.tsx"],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  // Las directivas "use client" de los módulos compartidos con Next no aplican aquí.
  logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"' },
});

const { size } = await stat(outfile);
process.stdout.write(`widget.js generado (${Math.round(size / 1024)} KB)\n`);
```

En `frontend/package.json`, `scripts`: cambiar `dev` y `build`, y añadir `build:widget` y `host:demo`:

```json
    "dev": "npm run build:widget && next dev --port 3000",
    "build": "npm run build:widget && next build",
    "build:widget": "node scripts/build-widget.mjs",
    "host:demo": "node scripts/serve-host.mjs",
```

En `.gitignore` (raíz), añadir al final:

```
# Bundle del widget del chat: lo genera `npm --prefix frontend run build:widget`.
frontend/public/widget.js
```

- [ ] **Step 5: Página anfitriona de prueba**

`frontend/scripts/serve-host.mjs`:

```js
import { createServer } from "node:http";

/**
 * Sitio de prueba «de un tenant» en otro origen, para probar el script incrustable por CORS.
 * Uso: npm run host:demo -- <clave-del-widget> [url-del-backend] [puerto]
 * El origen `http://localhost:<puerto>` debe estar en los orígenes permitidos del tenant.
 */
const [key = "", api = "http://localhost:3001", port = "4000"] = process.argv.slice(2);

const page = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sitio de prueba del tenant</title>
  </head>
  <body>
    <h1>Sitio de prueba del tenant</h1>
    <p>Esta página vive en otro origen y carga el chat como lo haría el sitio de una clínica.</p>
    <script src="http://localhost:3000/widget.js" data-key="${key}" data-api="${api}" async></script>
  </body>
</html>`;

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
}).listen(Number(port), () => {
  process.stdout.write(`Sitio de prueba en http://localhost:${port}\n`);
});
```

- [ ] **Step 6: Generar el bundle y comprobarlo**

Run: `npm --prefix frontend run build:widget`
Expected: imprime `widget.js generado (NNN KB)` con NNN entre 150 y 260, sin errores.

Run: `git status --short frontend/public`
Expected: sin salida (`widget.js` está ignorado).

Run: `node -e "const s=require('fs').readFileSync('frontend/public/widget.js','utf8');for(const t of ['ingenius360-widget','iw-root','Idempotency-Key','attachShadow']){if(!s.includes(t)){console.error('falta '+t);process.exit(1)}}console.log('bundle ok')"`
Expected: `bundle ok`.

- [ ] **Step 7: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci .` → sin errores.
Run: `npm --prefix frontend test` → PASS.
Run: `npm --prefix backend exec vitest run tests/sin-ia.test.ts` → PASS (esbuild no es una dependencia de IA; la suite lo confirma).

```bash
git add .gitignore frontend/package.json frontend/package-lock.json frontend/scripts/build-widget.mjs frontend/scripts/serve-host.mjs frontend/src/widget/embed-config.ts frontend/src/widget/embed.tsx frontend/tests/widget-embed-config.test.ts
git commit -m "feat(widget): script incrustable con Shadow DOM empaquetado con esbuild" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Consola `/chat`

**Files:**
- Create: `frontend/src/lib/use-origin.ts`, `frontend/src/lib/use-bot-config.ts`, `frontend/src/components/chat/chat-console.tsx`, `frontend/src/app/(console)/chat/page.tsx`
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Consumes: `ChatWidget` (Tarea 4); `browserStorage`, `clearStoredSession` (Tarea 2); `publicBackendUrl` (Tarea 5); del cliente generado `getBotConfig`, `addAllowedOrigin` (`@/api/default/default`) y el tipo `BotConfig` (`@/api/models`); `useToken`, `useIdentity`, `useAction`, `idempotent`, `ErrorBox`, `Field` existentes.
- Produces:
  - `useOrigin(): string` — `window.location.origin` en el cliente, `""` en el servidor.
  - `useBotConfig()` — `useQuery` sobre `GET /bot-config`, activo solo con token de panel.
  - `type BotSectionProps = { config: BotConfig; canWrite: boolean; onSaved: () => Promise<unknown> }` (lo usa la Tarea 9).
  - Ruta `/chat`.

Esta tarea no tiene lógica pura nueva que probar (compone piezas ya probadas); su verificación es typecheck, Biome, React Doctor y el recorrido manual de la Tarea 12.

- [ ] **Step 1: Hooks compartidos**

`frontend/src/lib/use-origin.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Origen de la página (`https://host[:puerto]`); vacío al renderizar en el servidor. */
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
}
```

`frontend/src/lib/use-bot-config.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { getBotConfig } from "@/api/default/default";
import type { BotConfig } from "@/api/models";
import { useToken } from "./use-session";

/** Lo que recibe cada tablero de la configuración del bot. */
export type BotSectionProps = {
  readonly config: BotConfig;
  /** Solo `admin` escribe; con `operator` los controles de escritura no se muestran. */
  readonly canWrite: boolean;
  /** Recarga la configuración tras una escritura. */
  readonly onSaved: () => Promise<unknown>;
};

/** Configuración efectiva del bot del tenant de la sesión del panel. */
export function useBotConfig() {
  const token = useToken();
  return useQuery({
    queryKey: ["bot-config", token?.slice(-16) ?? null],
    queryFn: () => getBotConfig(),
    enabled: Boolean(token),
    retry: false,
  });
}
```

- [ ] **Step 2: Componente de la consola**

`frontend/src/components/chat/chat-console.tsx`:

```tsx
"use client";

import { useState } from "react";
import { addAllowedOrigin } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { useBotConfig } from "@/lib/use-bot-config";
import { useOrigin } from "@/lib/use-origin";
import { useIdentity } from "@/lib/use-session";
import { ChatWidget } from "@/widget/chat-widget";
import { browserStorage, clearStoredSession } from "@/widget/session";

type OriginProps = {
  readonly origin: string;
  /** Orígenes del tenant; `undefined` si no hay sesión de panel con la que consultarlos. */
  readonly allowed: readonly string[] | undefined;
  readonly canAdd: boolean;
  readonly onAdded: () => Promise<void>;
};

/** Aviso (no decisión): quien admite o rechaza el origen es el backend al abrir la sesión. */
function OriginNotice({ origin, allowed, canAdd, onAdded }: OriginProps) {
  const { pending, error, run } = useAction();
  if (!origin || !allowed || allowed.includes(origin.toLowerCase())) {
    return null;
  }
  const add = () =>
    run("add", async () => {
      const body = { origin };
      await addAllowedOrigin(body, idempotent("bot.origin.add", body));
      await onAdded();
    });
  return (
    <div className="form-block">
      <h3>Origen sin registrar</h3>
      <p className="hint">
        <span className="data">{origin}</span> no está en los orígenes permitidos del tenant: el
        backend rechazará la sesión del chat.
      </p>
      {canAdd ? (
        <div className="form-actions">
          <button type="button" className="btn" disabled={pending !== null} onClick={add}>
            Añadir este origen
          </button>
        </div>
      ) : (
        <p className="hint">Un admin puede añadirlo en la pantalla Bot.</p>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

/** Consola de pruebas: el mismo widget y el mismo camino CORS que el sitio de un tenant. */
export function ChatConsole({ apiBase }: { readonly apiBase: string }) {
  const config = useBotConfig();
  const identity = useIdentity();
  const origin = useOrigin();
  const [draft, setDraft] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const current = config.data?.widget_keys.current?.key ?? "";
  const widgetKey = (applied ?? current).trim();
  const typed = draft ?? applied ?? current;

  const restart = (key: string) => {
    clearStoredSession(key.trim(), browserStorage());
    setApplied(key);
    setDraft(null);
    setRun((n) => n + 1);
  };

  return (
    <div className="crud">
      <div className="crud-forms">
        <form className="form-block" action={() => restart(typed)}>
          <h3>Clave del widget</h3>
          <Field label="Clave" apiKey="widget_key">
            <input
              className="input data"
              autoComplete="off"
              value={typed}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <p className="hint">
            {current
              ? "Se propone la clave vigente del tenant de la sesión. Puedes pegar otra."
              : "Sin sesión de panel: pega la clave pública de un widget."}
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!typed.trim()}>
              Nueva sesión
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={applied === null && draft === null}
              onClick={() => restart(current)}
            >
              Usar la vigente
            </button>
          </div>
          <ErrorBox error={config.error} />
        </form>
        <OriginNotice
          origin={origin}
          allowed={config.data?.allowed_origins}
          canAdd={identity.data?.role === "admin"}
          onAdded={async () => {
            await config.refetch();
            setRun((n) => n + 1);
          }}
        />
        <p className="hint">
          Backend del chat: <span className="data">{apiBase}</span>
        </p>
      </div>
      <section className="board chat-stage" aria-label="Widget del chat">
        {widgetKey ? (
          <ChatWidget
            key={`${widgetKey}:${run}`}
            apiBase={apiBase}
            widgetKey={widgetKey}
            mode="fill"
          />
        ) : (
          <div className="empty">
            <strong>Sin clave de widget</strong>
            <span>Pega una clave o abre sesión de panel para usar la vigente.</span>
          </div>
        )}
      </section>
    </div>
  );
}
```

Notas para el implementador:
- La clave escrita **no** se aplica tecla a tecla: cada cambio de `key` del widget abre una sesión, y la apertura tiene rate limit. Se aplica al enviar el formulario.
- «Nueva sesión» borra la sesión guardada de esa clave y remonta el widget (`run`).

- [ ] **Step 3: Página y estilos**

`frontend/src/app/(console)/chat/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ChatConsole } from "@/components/chat/chat-console";
import { publicBackendUrl } from "@/config/env";

// `PUBLIC_BACKEND_URL` se lee en cada petición, no en el build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chat</h1>
          <p>
            Consola de pruebas del widget. Habla directo con el backend por CORS, igual que el
            sitio de un tenant: no usa el token del panel, sino una sesión de widget.
          </p>
        </div>
      </div>
      <ChatConsole apiBase={publicBackendUrl()} />
    </>
  );
}
```

Añadir al final de `frontend/src/app/globals.css`:

```css

/* ---------- Consola del chat ---------- */

.chat-stage {
  height: min(720px, 75dvh);
}
```

- [ ] **Step 4: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci .` → sin errores.
Run: `npm --prefix frontend run doctor` → pasa.

```bash
git add frontend/src/lib/use-origin.ts frontend/src/lib/use-bot-config.ts frontend/src/components/chat/chat-console.tsx "frontend/src/app/(console)/chat/page.tsx" frontend/src/app/globals.css
git commit -m "feat(frontend): consola /chat sobre el widget con aviso de origen y reinicio de sesion" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Página `/panel/conocimiento`

**Files:**
- Create: `frontend/src/lib/knowledge-draft.ts`, `frontend/src/components/panel/use-knowledge.ts`, `frontend/src/components/panel/knowledge-form.tsx`, `frontend/src/components/panel/knowledge-board.tsx`, `frontend/src/app/(console)/panel/conocimiento/page.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/tests/knowledge-draft.test.ts`

**Interfaces:**
- Consumes: del cliente generado `listKnowledgeEntries`, `createKnowledgeEntry`, `updateKnowledgeEntry`, `deleteKnowledgeEntry` (`@/api/default/default`) y los tipos `KnowledgeEntry`, `KnowledgeEntryInput` (`@/api/models`); `Board`, `Column`, `Row`, `Flap`, `Field`, `ErrorBox`, `useAction`, `idempotent`, `text`, `useToken`, `useIdentity` existentes.
- Produces:
  - `parseKeywords(raw: string): string[]`, `formatKeywords(list: readonly string[]): string`.
  - `type KnowledgeDraft = { category: string; question: string; answer: string; detail: string; keywords: string; position: string; active: boolean }`, `EMPTY_DRAFT`, `draftOf(entry: KnowledgeEntry): KnowledgeDraft`, `inputOf(draft: KnowledgeDraft): KnowledgeEntryInput`.
  - `useKnowledge()` y `type Knowledge = ReturnType<typeof useKnowledge>`.
  - Ruta `/panel/conocimiento`.

- [ ] **Step 1: Tests del borrador (fallan)**

`frontend/tests/knowledge-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  draftOf,
  EMPTY_DRAFT,
  formatKeywords,
  inputOf,
  parseKeywords,
} from "@/lib/knowledge-draft";

describe("borrador de una entrada de conocimiento", () => {
  it("limpia comas sobrantes, espacios y repetidos de las palabras clave", () => {
    expect(parseKeywords(" horario, ,Horario,citas ,")).toEqual(["horario", "citas"]);
  });

  it("sin palabras clave envía una lista vacía, no una entrada vacía", () => {
    expect(parseKeywords("")).toEqual([]);
    expect(parseKeywords(" , ,, ")).toEqual([]);
  });

  it("formatKeywords es legible y reversible", () => {
    expect(formatKeywords(["horario", "citas"])).toBe("horario, citas");
    expect(parseKeywords(formatKeywords(["horario", "citas"]))).toEqual(["horario", "citas"]);
  });

  it("inputOf recorta, convierte la posición y manda detail nulo si está vacío", () => {
    const input = inputOf({
      ...EMPTY_DRAFT,
      category: " Horarios ",
      question: " ¿Cuándo abren? ",
      answer: " De 8 a 5 ",
      detail: "   ",
      keywords: "horario, abren",
      position: "3",
      active: false,
    });
    expect(input).toEqual({
      category: "Horarios",
      question: "¿Cuándo abren?",
      answer: "De 8 a 5",
      detail: null,
      keywords: ["horario", "abren"],
      position: 3,
      active: false,
    });
  });

  it("draftOf carga una entrada existente en el formulario", () => {
    const draft = draftOf({
      id: "e1",
      category: "Horarios",
      question: "¿Cuándo abren?",
      answer: "De 8 a 5",
      detail: null,
      keywords: ["horario", "abren"],
      position: 3,
      active: true,
    });
    expect(draft).toEqual({
      category: "Horarios",
      question: "¿Cuándo abren?",
      answer: "De 8 a 5",
      detail: "",
      keywords: "horario, abren",
      position: "3",
      active: true,
    });
  });
});
```

Run: `npm --prefix frontend exec vitest run tests/knowledge-draft.test.ts`
Expected: FAIL — no se puede resolver `@/lib/knowledge-draft`.

- [ ] **Step 2: Implementar `knowledge-draft.ts`**

`frontend/src/lib/knowledge-draft.ts`:

```ts
import type { KnowledgeEntry, KnowledgeEntryInput } from "@/api/models";

/**
 * Forma del formulario de una entrada de la base de conocimiento. Solo da forma al envío
 * (recortar, separar la lista); la validación de contenido es del backend.
 */
export type KnowledgeDraft = {
  readonly category: string;
  readonly question: string;
  readonly answer: string;
  readonly detail: string;
  /** Lista escrita con comas. */
  readonly keywords: string;
  readonly position: string;
  readonly active: boolean;
};

export const EMPTY_DRAFT: KnowledgeDraft = {
  category: "",
  question: "",
  answer: "",
  detail: "",
  keywords: "",
  position: "0",
  active: true,
};

/** «horario, ,Horario,citas» → `["horario", "citas"]`: sin vacíos ni repetidos. */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(",")) {
    const word = part.trim();
    const id = word.toLowerCase();
    if (word && !seen.has(id)) {
      seen.add(id);
      keywords.push(word);
    }
  }
  return keywords;
}

export function formatKeywords(list: readonly string[]): string {
  return list.join(", ");
}

export function draftOf(entry: KnowledgeEntry): KnowledgeDraft {
  return {
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    detail: entry.detail ?? "",
    keywords: formatKeywords(entry.keywords),
    position: String(entry.position),
    active: entry.active,
  };
}

export function inputOf(draft: KnowledgeDraft): KnowledgeEntryInput {
  const detail = draft.detail.trim();
  return {
    category: draft.category.trim(),
    question: draft.question.trim(),
    answer: draft.answer.trim(),
    detail: detail ? detail : null,
    keywords: parseKeywords(draft.keywords),
    position: Number(draft.position),
    active: draft.active,
  };
}
```

Run: `npm --prefix frontend exec vitest run tests/knowledge-draft.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Estado y acciones (`use-knowledge.ts`)**

`frontend/src/components/panel/use-knowledge.ts`:

```ts
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
} from "@/api/default/default";
import type { KnowledgeEntry } from "@/api/models";
import { idempotent } from "@/lib/idempotency";
import { draftOf, EMPTY_DRAFT, inputOf } from "@/lib/knowledge-draft";
import { useAction } from "@/lib/use-action";
import { useToken } from "@/lib/use-session";

const PAGE_SIZE = 100;

/** Lista paginada por cursor y formulario de alta/edición; cada escritura lleva su clave. */
export function useKnowledge() {
  const token = useToken();
  const list = useInfiniteQuery({
    queryKey: ["knowledge-entries", token?.slice(-16) ?? null],
    queryFn: ({ pageParam }) =>
      listKnowledgeEntries({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(token),
    retry: false,
  });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [picked, setPicked] = useState("");
  const [armed, setArmed] = useState(false);
  const action = useAction();
  const entries = list.data
    ? list.data.pages.flatMap((page) => page.data as KnowledgeEntry[])
    : null;

  const reset = () => {
    setPicked("");
    setArmed(false);
    setDraft(EMPTY_DRAFT);
  };
  const settle = async () => {
    reset();
    await list.refetch();
  };

  return {
    ...action,
    list,
    entries,
    draft,
    setDraft,
    picked,
    armed,
    setArmed,
    reset,
    /** Elegir la fila ya elegida la suelta y vuelve al alta. */
    pick(id: string) {
      const entry = entries?.find((item) => item.id === id);
      if (!entry || id === picked) {
        reset();
        return;
      }
      setPicked(id);
      setArmed(false);
      setDraft(draftOf(entry));
    },
    save: () =>
      action.run("save", async () => {
        const input = inputOf(draft);
        if (picked) {
          await updateKnowledgeEntry(picked, input, idempotent(`kb.update:${picked}`, input));
        } else {
          await createKnowledgeEntry(input, idempotent("kb.create", input));
        }
        await settle();
      }),
    remove: () =>
      action.run("delete", async () => {
        await deleteKnowledgeEntry(picked, idempotent(`kb.delete:${picked}`, {}));
        await settle();
      }),
  };
}

export type Knowledge = ReturnType<typeof useKnowledge>;
```

- [ ] **Step 4: Formulario**

`frontend/src/components/panel/knowledge-form.tsx` (los `maxLength` son los del esquema `KnowledgeEntryInput` del contrato: validación de forma):

```tsx
"use client";

import { Field } from "@/components/ui/field";
import type { KnowledgeDraft } from "@/lib/knowledge-draft";
import type { Knowledge } from "./use-knowledge";

function Actions({ kb }: { readonly kb: Knowledge }) {
  const busy = kb.pending !== null;
  return (
    <div className="form-actions">
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy}
        aria-busy={kb.pending === "save"}
      >
        {kb.picked ? "Guardar" : "Crear"}
      </button>
      {kb.picked ? (
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={kb.reset}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-armed={kb.armed}
            disabled={busy}
            onClick={() => (kb.armed ? kb.remove() : kb.setArmed(true))}
          >
            {kb.armed ? "Confirmar borrado" : "Borrar"}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Alta y edición de una entrada. La fila elegida en el tablero se carga aquí. */
export function KnowledgeForm({ kb }: { readonly kb: Knowledge }) {
  const { draft } = kb;
  const set = (patch: Partial<KnowledgeDraft>) => kb.setDraft({ ...draft, ...patch });
  return (
    <form
      className="form-block"
      action={() => {
        kb.save();
      }}
    >
      <h3>{kb.picked ? "Editar entrada" : "Nueva entrada"}</h3>
      <Field label="Categoría" apiKey="category">
        <input
          className="input"
          required
          maxLength={60}
          value={draft.category}
          onChange={(event) => set({ category: event.target.value })}
        />
      </Field>
      <Field label="Pregunta" apiKey="question">
        <input
          className="input"
          required
          maxLength={200}
          value={draft.question}
          onChange={(event) => set({ question: event.target.value })}
        />
      </Field>
      <Field label="Respuesta" apiKey="answer">
        <textarea
          className="input input-area"
          required
          rows={3}
          maxLength={1000}
          value={draft.answer}
          onChange={(event) => set({ answer: event.target.value })}
        />
      </Field>
      <Field label="Detalle («ver más»)" apiKey="detail">
        <textarea
          className="input input-area"
          rows={4}
          maxLength={4000}
          value={draft.detail}
          onChange={(event) => set({ detail: event.target.value })}
        />
      </Field>
      <Field label="Palabras clave, separadas por comas" apiKey="keywords">
        <input
          className="input"
          value={draft.keywords}
          onChange={(event) => set({ keywords: event.target.value })}
        />
      </Field>
      <Field label="Posición" apiKey="position" className="field-narrow">
        <input
          className="input data"
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.position}
          onChange={(event) => set({ position: event.target.value })}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => set({ active: event.target.checked })}
        />
        Activa (el bot la ofrece)
      </label>
      <Actions kb={kb} />
    </form>
  );
}
```

- [ ] **Step 5: Tablero y página**

`frontend/src/components/panel/knowledge-board.tsx`:

```tsx
"use client";

import type { KnowledgeEntry } from "@/api/models";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { Flap } from "@/components/ui/flap";
import { text } from "@/lib/format";
import { formatKeywords } from "@/lib/knowledge-draft";
import { useIdentity } from "@/lib/use-session";
import { KnowledgeForm } from "./knowledge-form";
import { useKnowledge } from "./use-knowledge";

const COLUMNS: readonly Column[] = [
  { header: "Pregunta", render: (row) => text(row, "question") },
  {
    header: "Palabras clave",
    optional: true,
    render: (row) => (
      <span className="cell-muted">{formatKeywords((row.keywords as string[]) ?? [])}</span>
    ),
  },
  {
    header: "Pos.",
    width: "1%",
    render: (row) => <span className="data">{text(row, "position")}</span>,
  },
  {
    header: "Estado",
    width: "1%",
    render: (row, index) => <Flap status={text(row, "active")} row={index} />,
  },
];

/** Orden de presentación: por categoría y, dentro de ella, por posición. */
function toRows(entries: readonly KnowledgeEntry[]): Row[] {
  return [...entries]
    .sort((a, b) => a.category.localeCompare(b.category, "es") || a.position - b.position)
    .map((entry) => ({ ...entry }));
}

/** Base de conocimiento: formulario a la izquierda (solo admin) y tablero por categoría. */
export function KnowledgeBoard() {
  const kb = useKnowledge();
  const identity = useIdentity();
  const canWrite = identity.data?.role === "admin";
  const { list } = kb;
  const picking = canWrite
    ? {
        onPick: (row: Row) => kb.pick(text(row, "id")),
        pickedId: kb.picked,
        pickLabel: "Editar",
      }
    : {};
  return (
    <div className={canWrite ? "crud" : undefined}>
      {canWrite ? (
        <div className="crud-forms">
          <KnowledgeForm kb={kb} />
        </div>
      ) : null}
      <section className="board" aria-label="Entradas de la base de conocimiento">
        <div className="board-head">
          <div className="board-title">
            <h2>Entradas</h2>
            {list.hasNextPage ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </button>
            ) : null}
          </div>
          <ErrorBox error={kb.error ?? list.error} />
        </div>
        <Board
          columns={COLUMNS}
          rows={kb.entries ? toRows(kb.entries) : null}
          loading={list.isLoading}
          more={Boolean(list.hasNextPage)}
          groupBy={(row) => text(row, "category")}
          {...picking}
          idle={{
            title: "Sin sesión",
            hint: "Pega un token en la franja de sesión para ver la base de conocimiento.",
          }}
          empty={{
            title: "Sin entradas",
            hint: "Un admin puede crear la primera con el formulario.",
          }}
        />
      </section>
    </div>
  );
}
```

`frontend/src/app/(console)/panel/conocimiento/page.tsx`:

```tsx
import type { Metadata } from "next";
import { KnowledgeBoard } from "@/components/panel/knowledge-board";

export const metadata: Metadata = { title: "Conocimiento" };

export default function ConocimientoPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Base de conocimiento</h1>
          <p>
            Lo que el bot responde en las consultas generales. Lee operator y admin; solo admin
            crea, edita y borra. El backend valida cada campo.
          </p>
        </div>
      </div>
      <KnowledgeBoard />
    </>
  );
}
```

Añadir al final de `frontend/src/app/globals.css`:

```css

/* ---------- Formularios largos ---------- */

.input-area {
  height: auto;
  min-height: 72px;
  padding: 8px 12px;
  line-height: 1.45;
  resize: vertical;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-size: 0.875rem;
}

.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
```

- [ ] **Step 6: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci .` → sin errores.
Run: `npm --prefix frontend test` → PASS.
Run: `npm --prefix frontend run doctor` → pasa.

```bash
git add frontend/src/lib/knowledge-draft.ts frontend/src/components/panel/use-knowledge.ts frontend/src/components/panel/knowledge-form.tsx frontend/src/components/panel/knowledge-board.tsx "frontend/src/app/(console)/panel/conocimiento/page.tsx" frontend/src/app/globals.css frontend/tests/knowledge-draft.test.ts
git commit -m "feat(frontend): pagina de base de conocimiento con alta, edicion y borrado" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Página `/panel/bot`

**Files:**
- Create: `frontend/src/lib/embed-snippets.ts`, `frontend/src/components/panel/bot-texts.tsx`, `frontend/src/components/panel/bot-params.tsx`, `frontend/src/components/panel/bot-origins.tsx`, `frontend/src/components/panel/bot-keys.tsx`, `frontend/src/components/panel/bot-config-screen.tsx`, `frontend/src/app/(console)/panel/bot/page.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/tests/embed-snippets.test.ts`

**Interfaces:**
- Consumes: `useBotConfig`, `BotSectionProps` (`@/lib/use-bot-config`, Tarea 7); `useOrigin` (Tarea 7); `publicBackendUrl` (Tarea 5); del cliente generado `updateBotConfig`, `rotateWidgetKey`, `addAllowedOrigin`, `removeAllowedOrigin`; `When` de `@/components/ui/cells`; `Field`, `ErrorBox`, `useAction`, `idempotent`, `useIdentity`, `useToken`.
- Produces: `embedSnippets(input: { frontendOrigin: string; apiBase: string; widgetKey: string }): { script: string; iframe: string }`. Ruta `/panel/bot`.

- [ ] **Step 1: Test de los fragmentos (falla)**

`frontend/tests/embed-snippets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { embedSnippets } from "@/lib/embed-snippets";

describe("fragmentos para incrustar el widget", () => {
  const snippets = embedSnippets({
    frontendOrigin: "https://chat.ingenius360.co",
    apiBase: "https://api.ingenius360.co",
    widgetKey: "wk_abc123",
  });

  it("el script apunta a widget.js del frontend y lleva clave y backend", () => {
    expect(snippets.script).toBe(
      '<script src="https://chat.ingenius360.co/widget.js" data-key="wk_abc123" data-api="https://api.ingenius360.co" async></script>',
    );
  });

  it("el iframe apunta a /widget con la clave codificada", () => {
    expect(snippets.iframe).toContain('src="https://chat.ingenius360.co/widget?key=wk_abc123"');
    expect(embedSnippets({ frontendOrigin: "https://f", apiBase: "https://b", widgetKey: "a b&c" }).iframe).toContain(
      "key=a%20b%26c",
    );
  });
});
```

Run: `npm --prefix frontend exec vitest run tests/embed-snippets.test.ts`
Expected: FAIL — no se puede resolver `@/lib/embed-snippets`.

- [ ] **Step 2: Implementar `embed-snippets.ts`**

`frontend/src/lib/embed-snippets.ts`:

```ts
type SnippetInput = {
  /** Origen de este frontend: sirve `widget.js` y la página `/widget`. */
  readonly frontendOrigin: string;
  /** Backend alcanzable desde el navegador. */
  readonly apiBase: string;
  readonly widgetKey: string;
};

/** HTML listo para pegar en el sitio del tenant, en los dos modelos de incrustación. */
export function embedSnippets({ frontendOrigin, apiBase, widgetKey }: SnippetInput) {
  const key = encodeURIComponent(widgetKey);
  return {
    script: `<script src="${frontendOrigin}/widget.js" data-key="${widgetKey}" data-api="${apiBase}" async></script>`,
    iframe: `<iframe src="${frontendOrigin}/widget?key=${key}" title="Chat" style="width:380px;height:600px;border:0"></iframe>`,
  };
}
```

Run: `npm --prefix frontend exec vitest run tests/embed-snippets.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Tablero de textos**

`frontend/src/components/panel/bot-texts.tsx`:

```tsx
"use client";

import { useState } from "react";
import { updateBotConfig } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";

type EffectiveText = { readonly value: string; readonly overridden: boolean };

type RowProps = {
  readonly name: string;
  readonly text: EffectiveText;
  readonly canWrite: boolean;
  readonly onSaved: () => Promise<unknown>;
};

function TextRow({ name, text, canWrite, onSaved }: RowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  /** `null` devuelve el texto a su predeterminado. */
  const patch = (value: string | null) =>
    run("save", async () => {
      const body = { texts: { [name]: value } };
      await updateBotConfig(body, idempotent(`bot.text:${name}`, body));
      setDraft(null);
      await onSaved();
    });
  return (
    <div className="setting-row">
      <Field label={name} apiKey={text.overridden ? "personalizado" : undefined}>
        <textarea
          className="input input-area"
          rows={2}
          maxLength={1000}
          readOnly={!canWrite}
          value={draft ?? text.value}
          onChange={(event) => setDraft(event.target.value)}
        />
      </Field>
      {canWrite ? (
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={draft === null || pending !== null}
            onClick={() => patch(draft)}
          >
            Guardar
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={!text.overridden || pending !== null}
            onClick={() => patch(null)}
          >
            Predeterminado
          </button>
        </div>
      ) : null}
      <ErrorBox error={error} />
    </div>
  );
}

/** Textos del bot: el valor efectivo de cada clave y si el tenant lo personalizó. */
export function BotTexts({ config, canWrite, onSaved }: BotSectionProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const all = Object.entries(config.texts);
  const rows = all.filter(
    ([name, text]) =>
      !needle || name.toLowerCase().includes(needle) || text.value.toLowerCase().includes(needle),
  );
  return (
    <section className="board" aria-labelledby="bot-texts-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-texts-title">Textos</h2>
          <p>
            {rows.length} de {all.length}
          </p>
        </div>
        <Field label="Filtrar por clave o contenido" className="field-setting">
          <input
            className="input"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </Field>
      </div>
      <div className="board-body stack">
        {rows.map(([name, text]) => (
          <TextRow key={name} name={name} text={text} canWrite={canWrite} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Tablero de parámetros**

`frontend/src/components/panel/bot-params.tsx`:

```tsx
"use client";

import { useState } from "react";
import { updateBotConfig } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";

type RowProps = {
  readonly name: string;
  readonly value: number;
  readonly canWrite: boolean;
  readonly onSaved: () => Promise<unknown>;
};

function ParamRow({ name, value, canWrite, onSaved }: RowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  const save = () =>
    run("save", async () => {
      const body = { params: { [name]: Number(draft) } };
      await updateBotConfig(body, idempotent(`bot.param:${name}`, body));
      setDraft(null);
      await onSaved();
    });
  return (
    <div className="setting-row">
      <form
        className="controls"
        action={() => {
          save();
        }}
      >
        <Field label={name} className="field-setting">
          <input
            className="input data"
            type="number"
            inputMode="numeric"
            readOnly={!canWrite}
            value={draft ?? String(value)}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        {canWrite ? (
          <button
            type="submit"
            className="btn btn-small"
            disabled={draft === null || draft.trim() === "" || pending !== null}
          >
            Guardar
          </button>
        ) : null}
      </form>
      <ErrorBox error={error} />
    </div>
  );
}

/** Parámetros del bot. El rango de cada uno lo valida el backend (422 con el rango). */
export function BotParams({ config, canWrite, onSaved }: BotSectionProps) {
  return (
    <section className="board" aria-labelledby="bot-params-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-params-title">Parámetros</h2>
        </div>
      </div>
      <div className="board-body stack">
        {Object.entries(config.params).map(([name, value]) => (
          <ParamRow key={name} name={name} value={value} canWrite={canWrite} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Tablero de orígenes**

`frontend/src/components/panel/bot-origins.tsx`:

```tsx
"use client";

import { useState } from "react";
import { addAllowedOrigin, removeAllowedOrigin } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";

/** Sitios desde los que el widget puede abrir sesión. Alta y baja de uno en uno. */
export function BotOrigins({ config, canWrite, onSaved }: BotSectionProps) {
  const [draft, setDraft] = useState("");
  const { pending, error, run } = useAction();
  const add = () =>
    run("add", async () => {
      const body = { origin: draft.trim() };
      await addAllowedOrigin(body, idempotent("bot.origin.add", body));
      setDraft("");
      await onSaved();
    });
  const remove = (origin: string) =>
    run(`remove:${origin}`, async () => {
      // El origen viaja en la ruta: va codificado, como pide el contrato.
      const scope = `bot.origin.remove:${origin}`;
      await removeAllowedOrigin(encodeURIComponent(origin), idempotent(scope, {}));
      await onSaved();
    });
  return (
    <section className="board" aria-labelledby="bot-origins-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-origins-title">Orígenes permitidos</h2>
          <p>{config.allowed_origins.length} registrados</p>
        </div>
        <ErrorBox error={error} />
      </div>
      <div className="board-body stack">
        {config.allowed_origins.length === 0 ? (
          <p className="hint">Sin orígenes: ningún sitio puede abrir el chat de este tenant.</p>
        ) : (
          <ul className="origin-list">
            {config.allowed_origins.map((origin) => (
              <li key={origin}>
                <span className="data">{origin}</span>
                {canWrite ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={pending !== null}
                    onClick={() => remove(origin)}
                  >
                    Quitar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form
            className="controls"
            action={() => {
              add();
            }}
          >
            <Field label="Origen nuevo" apiKey="origin" className="field-wide">
              <input
                className="input data"
                placeholder="https://www.clinica.co"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!draft.trim() || pending !== null}
            >
              Añadir
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Tablero de claves y fragmentos**

`frontend/src/components/panel/bot-keys.tsx`:

```tsx
"use client";

import { useState } from "react";
import { rotateWidgetKey } from "@/api/default/default";
import { ErrorBox } from "@/components/error-box";
import { When } from "@/components/ui/cells";
import { embedSnippets } from "@/lib/embed-snippets";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import type { BotSectionProps } from "@/lib/use-bot-config";
import { useOrigin } from "@/lib/use-origin";

function Snippet({ title, code }: { readonly title: string; readonly code: string }) {
  return (
    <div className="stack">
      <div className="board-title">
        <h3>{title}</h3>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => navigator.clipboard?.writeText(code)}
        >
          Copiar
        </button>
      </div>
      <pre className="snippet data">{code}</pre>
    </div>
  );
}

function Snippets({ widgetKey, apiBase }: { readonly widgetKey: string; readonly apiBase: string }) {
  const frontendOrigin = useOrigin();
  const snippets = embedSnippets({ frontendOrigin, apiBase, widgetKey });
  return (
    <>
      <Snippet title="Script (recomendado)" code={snippets.script} />
      <p className="hint">
        Añade el origen del sitio donde lo pegues a los orígenes permitidos.
      </p>
      <Snippet title="Iframe" code={snippets.iframe} />
      <p className="hint">
        El iframe habla con el backend desde <span className="data">{frontendOrigin}</span>: ese
        origen debe estar en los orígenes permitidos. En este modo no se controla qué sitio lo
        incrusta.
      </p>
    </>
  );
}

type Props = BotSectionProps & { readonly apiBase: string };

/** Clave pública del widget, su rotación con gracia y cómo incrustarlo. */
export function BotKeys({ config, canWrite, onSaved, apiBase }: Props) {
  const [armed, setArmed] = useState(false);
  const { pending, error, run } = useAction();
  const { current, grace } = config.widget_keys;
  const rotate = () =>
    run("rotate", async () => {
      await rotateWidgetKey(idempotent("bot.key.rotate", { from: current?.key ?? null }));
      setArmed(false);
      await onSaved();
    });
  return (
    <section className="board" aria-labelledby="bot-keys-title">
      <div className="board-head">
        <div className="board-title">
          <h2 id="bot-keys-title">Clave del widget</h2>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-danger btn-small"
              data-armed={armed}
              disabled={pending !== null}
              onClick={() => (armed ? rotate() : setArmed(true))}
            >
              {armed ? "Confirmar rotación" : "Rotar clave"}
            </button>
          ) : null}
        </div>
        <ErrorBox error={error} />
      </div>
      <div className="board-body stack">
        {current ? (
          <p>
            Vigente: <span className="data">{current.key}</span>
          </p>
        ) : (
          <p className="hint">Este tenant no tiene clave vigente.</p>
        )}
        {grace ? (
          <p className="hint">
            Clave anterior en gracia: <span className="data">{grace.key}</span>, válida hasta{" "}
            <When value={grace.grace_until} />. Los sitios que aún la usan siguen funcionando hasta
            entonces.
          </p>
        ) : null}
        {current ? <Snippets widgetKey={current.key} apiBase={apiBase} /> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Pantalla, página y estilos**

`frontend/src/components/panel/bot-config-screen.tsx`:

```tsx
"use client";

import { ErrorBox } from "@/components/error-box";
import { useBotConfig } from "@/lib/use-bot-config";
import { useIdentity, useToken } from "@/lib/use-session";
import { BotKeys } from "./bot-keys";
import { BotOrigins } from "./bot-origins";
import { BotParams } from "./bot-params";
import { BotTexts } from "./bot-texts";

/** Configuración del bot en cuatro tableros sobre un solo `GET /bot-config`. */
export function BotConfigScreen({ apiBase }: { readonly apiBase: string }) {
  const token = useToken();
  const config = useBotConfig();
  const identity = useIdentity();
  if (!token) {
    return (
      <div className="empty">
        <strong>Sin sesión</strong>
        <span>Pega un token en la franja de sesión para ver la configuración del bot.</span>
      </div>
    );
  }
  if (config.isError) {
    return <ErrorBox error={config.error} />;
  }
  if (!config.data) {
    return <p className="hint">Cargando la configuración…</p>;
  }
  const section = {
    config: config.data,
    canWrite: identity.data?.role === "admin",
    onSaved: () => config.refetch(),
  };
  return (
    <div className="column">
      <BotKeys {...section} apiBase={apiBase} />
      <BotOrigins {...section} />
      <BotParams {...section} />
      <BotTexts {...section} />
    </div>
  );
}
```

`frontend/src/app/(console)/panel/bot/page.tsx`:

```tsx
import type { Metadata } from "next";
import { BotConfigScreen } from "@/components/panel/bot-config-screen";
import { publicBackendUrl } from "@/config/env";

// `PUBLIC_BACKEND_URL` (para los fragmentos de incrustación) se lee en cada petición.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bot" };

export default function BotPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configuración del bot</h1>
          <p>
            Clave del widget, sitios permitidos, parámetros y textos. Lee operator y admin; solo
            admin guarda. Los rangos y formatos los valida el backend.
          </p>
        </div>
      </div>
      <BotConfigScreen apiBase={publicBackendUrl()} />
    </>
  );
}
```

Añadir al final de `frontend/src/app/globals.css`:

```css

/* ---------- Configuración del bot ---------- */

.setting-row {
  display: grid;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--rule-soft);
}

.setting-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.origin-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.origin-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 36px;
}

.snippet {
  margin: 0;
  padding: 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--slot);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.8125rem;
}
```

- [ ] **Step 8: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci .` → sin errores.
Run: `npm --prefix frontend test` → PASS.
Run: `npm --prefix frontend run doctor` → pasa.

```bash
git add frontend/src/lib/embed-snippets.ts frontend/src/components/panel/bot-texts.tsx frontend/src/components/panel/bot-params.tsx frontend/src/components/panel/bot-origins.tsx frontend/src/components/panel/bot-keys.tsx frontend/src/components/panel/bot-config-screen.tsx "frontend/src/app/(console)/panel/bot/page.tsx" frontend/src/app/globals.css frontend/tests/embed-snippets.test.ts
git commit -m "feat(frontend): pagina de configuracion del bot (clave, origenes, parametros, textos)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Bandeja del simulador (`/simulador/bandeja`)

**Files:**
- Create: `frontend/src/components/simulador/inbox-board.tsx`, `frontend/src/app/(console)/simulador/bandeja/page.tsx`
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Consumes: del cliente generado del simulador `listSimInbox`, `approveSimInboxRequest`, `rejectSimInboxRequest` (`@/sim/default/default`) y el tipo `InboxRequest` (`@/sim/models`); `Board`, `Column`, `Row`, `When`, `ErrorBox`, `ApiClientError`, `useAction`, `idempotent`, `text`, `useToken`.
- Produces: ruta `/simulador/bandeja`.

Sin lógica pura nueva: compone el cliente generado. Verificación por typecheck, Biome, React Doctor y el recorrido manual (Tarea 12).

- [ ] **Step 1: Tablero de la bandeja**

`frontend/src/components/simulador/inbox-board.tsx`:

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { When } from "@/components/ui/cells";
import { ApiClientError } from "@/lib/api-fetcher";
import { text } from "@/lib/format";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { useToken } from "@/lib/use-session";
import {
  approveSimInboxRequest,
  listSimInbox,
  rejectSimInboxRequest,
} from "@/sim/default/default";
import type { InboxRequest } from "@/sim/models";

const PAGE_SIZE = 50;

type Verb = "approve" | "reject";

/** Traducción de presentación del tipo de solicitud. */
const KIND: Record<string, string> = {
  book: "Agendar",
  reschedule: "Reprogramar",
  cancel: "Cancelar",
};

function toRow(request: InboxRequest): Row {
  const { patient } = request;
  return {
    id: request.id,
    kind: KIND[request.kind] ?? request.kind,
    patient: `${patient.given_names} ${patient.family_names}`,
    document: `${patient.document_type} ${patient.document_number}`,
    when: request.slot?.start_at ?? request.appointment?.start_at ?? null,
    expires_at: request.expires_at,
  };
}

function columns(decide: (verb: Verb, id: string) => void, pending: string | null): Column[] {
  return [
    { header: "Tipo", width: "1%", render: (row) => text(row, "kind") },
    {
      header: "Paciente",
      render: (row) => (
        <>
          <div>{text(row, "patient")}</div>
          <div className="cell-muted data">{text(row, "document")}</div>
        </>
      ),
    },
    { header: "Cupo o cita", render: (row) => <When value={row.when} /> },
    { header: "Vence", optional: true, render: (row) => <When value={row.expires_at} /> },
    {
      header: "Resolver",
      width: "1%",
      render: (row) => {
        const id = text(row, "id");
        return (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={pending !== null}
              aria-busy={pending === `approve:${id}`}
              onClick={() => decide("approve", id)}
            >
              Aprobar
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              disabled={pending !== null}
              aria-busy={pending === `reject:${id}`}
              onClick={() => decide("reject", id)}
            >
              Rechazar
            </button>
          </div>
        );
      },
    },
  ];
}

function idleMessage(error: unknown, hasToken: boolean): { title: string; hint: string } {
  if (error instanceof ApiClientError && error.status === 404) {
    return {
      title: "Simulador apagado en este entorno",
      hint: "Requiere HERMES_SIMULATOR_ENABLED=true en el backend.",
    };
  }
  if (error) {
    return { title: "No se pudo listar", hint: "Revisa el aviso de arriba y vuelve a intentarlo." };
  }
  return hasToken
    ? { title: "Cargando la bandeja…", hint: "Consultando las solicitudes pendientes." }
    : { title: "Sin sesión", hint: "Pega un token admin en la franja de sesión." };
}

/** Solicitudes pendientes de pre-agenda: Hermes (simulado) las aprueba o las rechaza. */
export function InboxBoard() {
  const token = useToken();
  const list = useInfiniteQuery({
    queryKey: ["sim-inbox", token?.slice(-16) ?? null],
    queryFn: ({ pageParam }) =>
      listSimInbox({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(token),
    retry: false,
  });
  const { pending, error, run } = useAction();
  const decide = (verb: Verb, id: string) =>
    run(`${verb}:${id}`, async () => {
      const resolve = verb === "approve" ? approveSimInboxRequest : rejectSimInboxRequest;
      await resolve(id, idempotent(`inbox.${verb}:${id}`, {}));
      await list.refetch();
    });
  const rows = list.data ? list.data.pages.flatMap((page) => page.data.map(toRow)) : null;
  return (
    <section className="board" aria-label="Bandeja de solicitudes">
      <div className="board-head">
        <div className="board-title">
          <h2>Pendientes</h2>
          <div className="row-actions">
            {list.hasNextPage ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                Cargar más
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              disabled={!token || list.isFetching}
              onClick={() => list.refetch()}
            >
              Recargar
            </button>
          </div>
        </div>
        <ErrorBox error={error ?? list.error} />
      </div>
      <Board
        columns={columns(decide, pending)}
        rows={rows}
        loading={list.isLoading}
        more={Boolean(list.hasNextPage)}
        idle={idleMessage(list.error, Boolean(token))}
        empty={{
          title: "Sin solicitudes pendientes",
          hint: "Las que cree el chat aparecerán aquí hasta resolverse o vencer.",
        }}
      />
    </section>
  );
}
```

- [ ] **Step 2: Página y estilos**

`frontend/src/app/(console)/simulador/bandeja/page.tsx`:

```tsx
import type { Metadata } from "next";
import { InboxBoard } from "@/components/simulador/inbox-board";

export const metadata: Metadata = { title: "Bandeja" };

export default function BandejaPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bandeja del simulador</h1>
          <p>
            Solicitudes de pre-agenda que el chat originó. Aprobar confirma la cita en el
            simulador de Hermes; rechazar libera el cupo. Rol admin; se apaga en producción.
          </p>
        </div>
      </div>
      <InboxBoard />
    </>
  );
}
```

Añadir al final de `frontend/src/app/globals.css`:

```css

/* ---------- Acciones por fila ---------- */

.row-actions {
  display: flex;
  gap: 8px;
  white-space: nowrap;
}
```

- [ ] **Step 3: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci .` → sin errores.
Run: `npm --prefix frontend run doctor` → pasa.

```bash
git add frontend/src/components/simulador/inbox-board.tsx "frontend/src/app/(console)/simulador/bandeja/page.tsx" frontend/src/app/globals.css
git commit -m "feat(frontend): bandeja del simulador con aprobar y rechazar solicitudes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Navegación de siete destinos

**Files:**
- Create: `frontend/src/components/shell/platforms.ts`
- Modify: `frontend/src/components/shell/marquee.tsx`, `frontend/src/app/(console)/page.tsx`, `frontend/src/app/globals.css`
- Test: `frontend/tests/platforms.test.ts`

**Interfaces:**
- Consumes: rutas creadas en las Tareas 5, 7, 8, 9 y 10.
- Produces: `PLATFORMS` (7 destinos con `href`, `label`, `key`, `detail`, `roles`) y `SESSION_SHORTCUT = "0"`.

- [ ] **Step 1: Test de los destinos (falla)**

`frontend/tests/platforms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PLATFORMS, SESSION_SHORTCUT } from "@/components/shell/platforms";

describe("destinos de la consola", () => {
  it("son siete, en el orden de la spec", () => {
    expect(PLATFORMS.map((item) => item.href)).toEqual([
      "/panel",
      "/panel/conocimiento",
      "/panel/bot",
      "/panel/ajustes",
      "/chat",
      "/simulador",
      "/simulador/bandeja",
    ]);
  });

  it("cada atajo es una tecla distinta del 1 al 7 y ninguna pisa la de sesión", () => {
    const keys = PLATFORMS.map((item) => item.key);
    expect(keys).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(keys).not.toContain(SESSION_SHORTCUT);
    expect(SESSION_SHORTCUT).toBe("0");
  });
});
```

Run: `npm --prefix frontend exec vitest run tests/platforms.test.ts`
Expected: FAIL — no se puede resolver `@/components/shell/platforms`.

- [ ] **Step 2: Implementar `platforms.ts`**

`frontend/src/components/shell/platforms.ts`:

```ts
/** Destinos de la consola: una sola lista para la cabecera, los atajos y la portada. */
export const PLATFORMS = [
  {
    href: "/panel",
    label: "Panel",
    key: "1",
    detail: "Agenda, cupos libres y expediente por documento.",
    roles: "operator · admin",
  },
  {
    href: "/panel/conocimiento",
    label: "Conocimiento",
    key: "2",
    detail: "Lo que el bot responde en las consultas generales.",
    roles: "operator · admin",
  },
  {
    href: "/panel/bot",
    label: "Bot",
    key: "3",
    detail: "Clave del widget, sitios permitidos, parámetros y textos.",
    roles: "operator · admin",
  },
  {
    href: "/panel/ajustes",
    label: "Ajustes",
    key: "4",
    detail: "Tope del rango de consulta.",
    roles: "admin",
  },
  {
    href: "/chat",
    label: "Chat",
    key: "5",
    detail: "Consola de pruebas del widget, con sesión propia.",
    roles: "clave del widget",
  },
  {
    href: "/simulador",
    label: "Simulador",
    key: "6",
    detail: "Maestros y cupos de prueba. Se apaga en producción.",
    roles: "admin",
  },
  {
    href: "/simulador/bandeja",
    label: "Bandeja",
    key: "7",
    detail: "Aprobar o rechazar las solicitudes que originó el chat.",
    roles: "admin",
  },
] as const;

/** Tecla que abre o cierra la franja de sesión. */
export const SESSION_SHORTCUT = "0";
```

Run: `npm --prefix frontend exec vitest run tests/platforms.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Cabecera y atajos**

En `frontend/src/components/shell/marquee.tsx`:

1. Borrar la constante local `PLATFORMS` (el bloque `const PLATFORMS = [ … ] as const;`) y añadir el import, respetando el orden alfabético de imports:

```ts
import { PLATFORMS, SESSION_SHORTCUT } from "./platforms";
```

2. Cambiar el comentario de `useShortcuts` a:

```ts
/** Atajos 1–7 para cambiar de pantalla y 0 para abrir/cerrar la sesión. */
```

3. En `useShortcuts`, reemplazar `} else if (event.key === "4") {` por:

```ts
      } else if (event.key === SESSION_SHORTCUT) {
```

4. En `SessionChip`, reemplazar `aria-keyshortcuts="4"` por `aria-keyshortcuts={SESSION_SHORTCUT}` y `<kbd>4</kbd>` por `<kbd>{SESSION_SHORTCUT}</kbd>`.

Run: `grep -n '"4"\|>4<' frontend/src/components/shell/marquee.tsx`
Expected: sin salida.

- [ ] **Step 4: Portada**

En `frontend/src/app/(console)/page.tsx`:

1. Borrar la constante `DESTINATIONS` y añadir el import:

```ts
import { PLATFORMS, SESSION_SHORTCUT } from "@/components/shell/platforms";
```

2. En `SessionRow`: el texto inicial pasa a ``let detail = `Pega un JWT en la franja de sesión (tecla ${SESSION_SHORTCUT}).`;`` y `<span className="departure-key">4</span>` pasa a `<span className="departure-key">{SESSION_SHORTCUT}</span>`.

3. En `HomePage`, el `map` queda:

```tsx
        {PLATFORMS.map((item) => (
          <Link key={item.href} href={item.href} className="departure">
            <span className="departure-key">{item.key}</span>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <span className="departure-roles">{item.roles}</span>
          </Link>
        ))}
```

- [ ] **Step 5: Que siete destinos quepan en la cabecera**

En `frontend/src/app/globals.css`, la regla `.platforms` queda (se añaden las tres últimas propiedades):

```css
.platforms {
  display: flex;
  gap: 4px;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
```

Y en `.platform`, añadir `white-space: nowrap;` como última propiedad.

- [ ] **Step 6: Puertas y commit**

Run: `npm --prefix frontend run typecheck` → sin errores.
Run: `npx biome ci .` → sin errores.
Run: `npm --prefix frontend test` → PASS.
Run: `npm --prefix frontend run doctor` → pasa.

```bash
git add frontend/src/components/shell/platforms.ts frontend/src/components/shell/marquee.tsx "frontend/src/app/(console)/page.tsx" frontend/src/app/globals.css frontend/tests/platforms.test.ts
git commit -m "feat(frontend): navegacion de siete destinos y sesion en la tecla 0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Revisión de UI, recorrido manual, documentación y puertas finales

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-fase-3-4-frontend-chat-design.md`, `README.md`, `CLAUDE.md`, `frontend/AGENTS.md`, `PRODUCT.md`
- Modify (solo si la revisión o el recorrido encuentran defectos): archivos de las Tareas 4–11

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: rama lista para que el usuario abra la PR.

- [ ] **Step 1: Pedir Postgres al usuario**

Postgres local no se sostiene si lo arranca el agente. **Parar y pedir al usuario** que pulse Start All en Laragon. Continuar cuando `pg_isready -h 127.0.0.1 -p 5432` (o `netstat -ano | grep ':5432 .*LISTEN'`) confirme que escucha.

- [ ] **Step 2: Levantar el entorno local**

`backend/.env` necesita `DATABASE_URL`, `JWT_SECRET` y `HERMES_SIMULATOR_ENABLED=true` (ver `backend/.env.example`). No commitear `.env`.

```bash
npm --prefix backend run db:migrate
npm --prefix backend run db:seed
npm --prefix backend run dev        # terminal 1, puerto 3001 (en segundo plano)
npm --prefix frontend run dev       # terminal 2, puerto 3000 (genera widget.js y arranca)
```

Firmar un token admin de un tenant del seed. El id del tenant sale de `GET /api/platform/v1/tenants` (con `PLATFORM_SECRET` definido) o de la tabla `tenants`:

```bash
npm --prefix backend run token:dev -- --tenant <tenant_id> --role admin
```

- [ ] **Step 3: Recorrido manual (criterio 1 de la Fase 3)**

En el navegador, con el token admin pegado en la franja de sesión (tecla `0`). Marcar cada punto; si alguno falla, es un defecto: aplicar `superpowers:systematic-debugging`, arreglar con test si es de lógica, y commitear el arreglo aparte.

1. `/panel/bot`: se ve la clave vigente. Añadir `http://localhost:3000` y `http://localhost:4000` en Orígenes permitidos.
2. `/chat`: el widget carga la bienvenida. Recorrer: identificación con un documento del seed → verificación (2 preguntas) → agendar (servicio → profesional → día → cupo → confirmar). El texto escrito **no** aparece en la conversación: aparece redactado o el documento enmascarado.
3. `/simulador/bandeja`: la solicitud aparece. **Aprobar** → desaparece de pendientes.
4. `/chat`: «Nueva sesión» → reprogramar la cita → en la bandeja, **Rechazar**. Luego cancelar una cita → **Aprobar**.
5. `/chat` con un documento que no existe: pre-registro completo (aviso de datos → nombres → apellidos → fecha con el selector → celular → correo → confirmación).
6. `/chat`: consulta general (texto libre a la base de conocimiento) y «Hablar con un asesor».
7. Recargar `/chat` a mitad de un flujo: la conversación se restaura en el mismo turno.
8. `/panel/conocimiento`: crear una entrada, editarla, desactivarla y borrarla. En `/chat`, la consulta general refleja el cambio.
9. `/panel/bot`: cambiar el texto de bienvenida, comprobar en `/chat` (nueva sesión), volver a «Predeterminado». Cambiar un parámetro a un valor fuera de rango: se ve el `422` del backend con el rango.
10. Iframe: abrir `http://localhost:3000/widget?key=<clave>` → el chat ocupa la página, sin cabecera. Sin `?key` → mensaje de uso.
11. Script: `npm --prefix frontend run host:demo -- <clave>` y abrir `http://localhost:4000` → botón «Chat» abajo a la derecha; abre, conversa, `Esc` cierra. Después, quitar `http://localhost:4000` de los orígenes permitidos, abrir `http://localhost:4000` en una pestaña nueva (sin sesión guardada) y abrir el chat → «Este sitio no está autorizado para el chat.», sin botón de reintento.
12. Parar el backend con el chat abierto y pulsar una opción → aviso con «Reintentar»; arrancar el backend y reintentar → el turno avanza **una** vez.
13. Con un token `operator`: `/panel/conocimiento` y `/panel/bot` se leen pero no muestran controles de escritura.
14. Teclado: `1`–`7` cambian de pantalla, `0` abre la sesión; dentro del chat todo se opera con Tab/Enter y el foco pasa al primer control del turno nuevo.

- [ ] **Step 4: Revisión de diseño con `impeccable`**

`impeccable` es la skill primaria de UI del repo (`GOBERNANZA.md` §6). Invocarla en modo **audit** sobre: `/chat`, `/panel/conocimiento`, `/panel/bot`, `/simulador/bandeja`, la cabecera con siete destinos y el widget (modos `fill` y `floating`). Contraste con `DESIGN.md` para las páginas de consola; el widget es deliberadamente claro y con fuentes del sistema (vive en sitios ajenos). Arreglar los hallazgos de severidad alta y media sin tocar lógica ni contrato; registrar los que se dejen. Si un arreglo toca `src/widget/`, volver a correr `npm --prefix frontend run build:widget`. Commit aparte:

```bash
git add <archivos tocados por la revisión>
git commit -m "style(frontend): ajustes de la revision de diseno de la 3.4" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Actualizar la spec**

En `docs/superpowers/specs/2026-10-13-fase-3-4-frontend-chat-design.md`:

1. Línea de estado → `> Estado: **implementada** en la rama \`fase-3-4-frontend-chat\` (pendiente de merge por el usuario). Plan en \`docs/superpowers/plans/2026-10-13-fase-3-4-frontend-chat.md\`.`
2. En el árbol de §4, reemplazar `styles.css      # estilos propios, sin depender de globals.css` por `styles.ts       # estilos como cadena (ver §10.1)` y añadir las líneas `widget-api.ts`, `failure.ts` y `embed-config.ts`.
3. Añadir al final una sección `## 10. Refinamientos al implementar` con los siete puntos de «Refinamientos sobre la spec» de este plan, copiados tal cual.

- [ ] **Step 6: Actualizar la documentación del repo**

`README.md`:
- Línea de estado (cerca de la línea 9): Fases 1 y 2 cerradas; Fase 3: 3.1, 3.2 y 3.3 en `main`; 3.4 implementada en `fase-3-4-frontend-chat`.
- Tabla de **Variables**: añadir la fila `| \`PUBLIC_BACKEND_URL\` | frontend | URL del backend alcanzable desde el navegador; la usa el widget del chat (CORS). Por defecto \`http://localhost:3001\` |`.
- Sección nueva `## Widget del chat`, después de «Autenticación», con este contenido:

````markdown
## Widget del chat

Un solo widget con tres montajes; los tres hablan directo con el backend por CORS.

| Montaje | Cómo se usa | Origen que ve el backend |
| --- | --- | --- |
| Script | `<script src="https://<frontend>/widget.js" data-key="<clave>" data-api="https://<backend>" async></script>` | El del sitio del tenant |
| Iframe | `<iframe src="https://<frontend>/widget?key=<clave>"></iframe>` | El del frontend |
| Consola | `/chat` en el frontend | El del frontend |

El origen correspondiente debe estar en los orígenes permitidos del tenant (pantalla **Bot**).
En modo iframe no se controla qué sitio lo incrusta: la protección por origen es del modo
script. Los fragmentos listos para copiar están en la pantalla **Bot**.

`widget.js` es generado (`npm --prefix frontend run build:widget`; lo hacen `dev` y `build`).
Para probar el script desde otro origen: `npm --prefix frontend run host:demo -- <clave>` y
abrir `http://localhost:4000` (con ese origen añadido a los permitidos).
````

- **Mapa del código**: añadir `frontend/src/widget/` (núcleo del chat: fetcher → widget-api → session → chat-client → interfaz) y los grupos de rutas `(console)` y `(embed)`.

`CLAUDE.md`, sección «Estado actual»: reemplazar el punto de la 3.3 y la mención de la 3.4 por:

```markdown
- **3.3 motor conversacional — cerrada** y en `main` (PR #5). Spec en `docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md`: conversaciones con historial redactado, verificación con banco de preguntas y par fijo, pre-registro, handoff-tickets (solo creación), CORS del widget y alta/baja de orígenes.
- **3.4 frontend del chat — implementada** en la rama `fase-3-4-frontend-chat` (spec en `docs/superpowers/specs/2026-10-13-fase-3-4-frontend-chat-design.md`): widget con un núcleo (`frontend/src/widget/`) y tres montajes (script `widget.js`, iframe `/widget`, consola `/chat`), páginas `/panel/conocimiento` y `/panel/bot`, y bandeja `/simulador/bandeja`. El widget habla directo al backend por CORS (`PUBLIC_BACKEND_URL`), no por el proxy.
```

No afirmar en `CLAUDE.md` que las suites de BD de la 3.3 pasaron salvo que se hayan corrido en esta tarea (Step 7).

`frontend/AGENTS.md`, bloque «Dónde va cada cosa», queda:

```
src/app/(console)/   Consola con cabecera: panel, conocimiento, bot, ajustes, /chat, simulador, bandeja.
src/app/(embed)/     Páginas sin cabecera: /widget (para iframe).
src/widget/          Núcleo del chat, compartido por script, iframe y consola. Habla directo al
                     backend por CORS con su propio cliente (src/widget/api, generado).
scripts/             build-widget.mjs (bundle del script) y serve-host.mjs (sitio de prueba).
tests/               Vitest.
```

`PRODUCT.md`, sección «Operating Context»: reemplazar el punto «Hoy (Fases 1–2 cerradas)…» por: `- Hoy (Fase 3 implementada): panel de lectura y ajustes, base de conocimiento, configuración del bot, simulador CRUD con bandeja, y chat como widget (script, iframe y consola). Tokens de panel emitidos por \`/api/platform/v1\` y pegados en la franja de sesión.` Y en «Abiertos / por fase», quitar la línea de la Fase 3.

`GOBERNANZA.md` no se toca: el iframe sin control de origen es una decisión de producto registrada en la spec, no un cambio de política. Si el usuario indica lo contrario, añadirlo ahí en esta misma rama.

- [ ] **Step 7: Puertas finales**

Desde la raíz:

```bash
npm run ci          # biome ci en todo el monorepo
npm run typecheck
npm test            # backend (unit) + frontend
npm run doctor
npm --prefix frontend run build
```

Expected: todo en verde. `npm test` muestra los 276 tests del backend y, en el frontend, los 8 previos más 52 de este plan (60 en 13 archivos).

Con Postgres arriba (Step 1), correr también las suites de BD, que cubren el contrato tocado en la Tarea 1 y dejan resuelto el pendiente de la 3.3:

```bash
npm --prefix backend run test:db
```

Expected: PASS. **Si falla, no arreglar a ciegas ni ocultarlo**: reportar al usuario la salida exacta. Estas suites no se habían ejecutado nunca sobre el código de la 3.3, así que un fallo puede ser anterior a este plan (`git stash` está prohibido: para distinguirlo, comparar con `git worktree add ../hermes-main main` y correr ahí la misma suite).

- [ ] **Step 8: Commit de documentación**

```bash
git add docs/superpowers/specs/2026-10-13-fase-3-4-frontend-chat-design.md README.md CLAUDE.md frontend/AGENTS.md PRODUCT.md
git commit -m "docs: estado de la 3.4, widget del chat y variable PUBLIC_BACKEND_URL" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Entregar**

No hacer merge ni abrir PR. Reportar al usuario: commits de la rama (`git log --oneline main..HEAD`), resultado de cada puerta con su salida, resultado del recorrido manual punto por punto, hallazgos de la revisión de diseño que se dejaron sin arreglar y por qué, y el resultado de `test:db`.
