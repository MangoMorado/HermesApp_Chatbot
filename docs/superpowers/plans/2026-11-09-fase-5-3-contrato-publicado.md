# Fase 5.3 — Contrato publicado: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar el contrato REST de modo que un desarrollador de Hermes pueda probarlo en Swagger UI (`/docs`, solo en laboratorio y desarrollo), ejecutarlo de punta a punta con Postman/Newman contra el laboratorio sin dejar basura, y confiar en él porque la suite `contrato-rutas` valida cada respuesta contra el esquema en el CI.

**Architecture:** Los tres builders OpenAPI (`buildOpenApiDocument`, `buildPlatformOpenApiDocument`, `buildSimOpenApiDocument`) siguen siendo la única fuente. De ellos salen: el JSON versionado (con URLs OAuth2 de marcador), lo que sirve `/docs` (con los marcadores sustituidos por el discovery del proveedor), la colección Postman generada y la validación de `contrato-rutas`. `/docs` es un adaptador de entrada más, sin dominio. El laboratorio gana el cliente `chatbot-newman`.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript, Vitest 5 (proyectos `unit` y `db`), `ajv` 8 (`ajv/dist/2020`, porque los documentos son OpenAPI 3.1) con `ajv-formats`, `swagger-ui-dist`, `newman` (API de Node), Postman Collection v2.1.

**Spec:** `docs/superpowers/specs/2026-11-09-fase-5-3-contrato-publicado-design.md` (madre: `docs/superpowers/specs/2026-10-27-fase-5-identidad-oidc-contrato-design.md` §8).

## Global Constraints

- Rama: `fase-5-2-frontend-referencia` (decisión del usuario). No se hace merge a `main`; el usuario cierra commit final y merge.
- Documentación y comentarios en español; código, nombres de campos y rutas en inglés.
- `process.env` solo en `backend/src/config/env.ts` (y en scripts de `backend/scripts/`, que no son `src`).
- El texto `keycloak` no aparece en `backend/src/**` ni `frontend/src/**` (suite `fronteras`).
- `openapi*.json` y la colección Postman son generados: nunca se editan a mano. Tras tocar un builder: `npm --prefix backend run openapi:generate`; tras tocar el generador o los fragmentos: `npm --prefix backend run postman:generate`.
- Clean Code: ≤ 40 líneas por función, complejidad cognitiva ≤ 15, ≤ 400 líneas por archivo de lógica (también los de tests), 0 ciclos de importación.
- `DOCS_ENABLED` por defecto `false`. `DOCS_OIDC_CLIENT_ID` por defecto `chatbot-swagger`.
- Marcadores OAuth2 en el JSON versionado: `https://oidc.invalid/authorize` y `https://oidc.invalid/token`.
- Esquemas de seguridad: `oidcUser` (oauth2 `authorizationCode`), `oidcClient` (oauth2 `clientCredentials`), `widgetSession` (http bearer). `bearerAuth` y `platformBearer` desaparecen.
- Prefijo de todo lo que crea Newman: `newman-`. Slug fijo de la clínica de plataforma: `newman-clinica`.
- Password grant (`directAccessGrantsEnabled: true`) solo en `chatbot-newman`.
- npm 12 bloquea scripts de instalación: si una dependencia nueva los necesita, se aprueba en `allowScripts` de `backend/package.json`. Ninguna de las previstas debería necesitarlo.
- No se cambia ningún rol ni ruta: los esquemas describen lo que el código ya exige.

## Review Focus

1. **Discovery caído o sin `authorization_endpoint`** (un proveedor que solo hace `client_credentials`): `/docs/openapi/*.json` responde `503` con envoltura REST si el discovery falla; si falta solo el `authorization_endpoint`, el documento se sirve sin el flujo `authorizationCode` en vez de romper. Test en la tarea 2.
2. **Un `{name}` desconocido o con traversal en `/docs/openapi/{name}.json` o en los activos** (`../package.json`, `%2e%2e`): `404`, nunca lectura fuera de `swagger-ui-dist`. Test en la tarea 3.
3. **`/docs` con `DOCS_ENABLED=true` pero `HERMES_SIMULATOR_ENABLED=false`**: el selector no ofrece el contrato sim y `/docs/openapi/sim.json` da `404`. Test en la tarea 3.
4. **Un caso de `contrato-rutas` que devuelve un status declarado pero con cuerpo de otro status** (p. ej. un `404` con cuerpo de éxito) o con `Content-Type` distinto: debe fallar. Test del propio validador en la tarea 5.
5. **Token cacheado en Postman que caduca a mitad de recorrido** (realm con 300 s): el script de pre-petición renueva antes del margen y un recorrido largo no recibe `401`. Test del script (en Node, con `pm` falso) en la tarea 9.

---

## File Structure

| Archivo                                                                 | Responsabilidad                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `backend/src/http/openapi-security.ts` (nuevo)                          | Constantes de esquemas de seguridad, marcadores y `withProviderUrls` |
| `backend/src/http/openapi*.ts` (modificar)                              | Usar los esquemas nuevos por operación                               |
| `backend/src/modules/auth/infrastructure/oidc-discovery.ts` (modificar) | Exponer `authorizationEndpoint` (nullable)                           |
| `backend/src/config/env.ts` (modificar)                                 | `docs: { enabled, oidcClientId }`                                    |
| `backend/src/composition/docs-wiring.ts` (nuevo)                        | Ensamblar lo que necesitan las rutas de `/docs`                      |
| `backend/src/http/docs/` (nuevo)                                        | Página HTML, lectura de activos, documentos servidos                 |
| `backend/src/app/docs/**/route.ts` (nuevo)                              | Adaptadores de entrada de `/docs`                                    |
| `backend/scripts/idp-lab/{plan,apply,index}.ts` (modificar)             | Cliente `chatbot-newman` y salida para Postman                       |
| `backend/tests/db/contrato-rutas/` (nuevo)                              | Arnés, validador, mundo sembrado, tablas de casos y exenciones       |
| `backend/tests/db/contrato-rutas-*.test.ts` (nuevo)                     | Ejecutar las tablas y el meta-test de cobertura                      |
| `backend/scripts/postman/` (nuevo)                                      | Generador, fragmentos fuente, script de auth, ejecutor Newman        |
| `docs/chatbot-ingenius-360.postman_collection.json` (regenerado)        | Colección                                                            |
| `docs/lab.postman_environment.template.json` (nuevo)                    | Plantilla de entorno sin secretos                                    |

---

### Task 1: esquemas de seguridad OAuth2 en los tres contratos

**Files:**

- Create: `backend/src/http/openapi-security.ts`
- Modify: `backend/src/http/openapi.ts`, `backend/src/http/openapi-paths-chatbot.ts`, `backend/src/http/openapi-paths-conversation.ts`, `backend/src/http/openapi-platform.ts`, `backend/src/http/openapi-sim.ts`
- Regenerate: `backend/openapi.json`, `backend/openapi-platform.json`, `backend/openapi-sim.json`
- Test: `backend/tests/contrato-api.test.ts`

**Interfaces:**

- Produces (en `openapi-security.ts`):
  - `export const OAUTH_PLACEHOLDERS = { authorizationUrl: "https://oidc.invalid/authorize", tokenUrl: "https://oidc.invalid/token" } as const;`
  - `export const SECURITY_SCHEMES: Record<"oidcUser" | "oidcClient" | "widgetSession", unknown>`: `oidcUser` = `{ type: "oauth2", flows: { authorizationCode: { authorizationUrl, tokenUrl, scopes: { openid: "Identidad OIDC" } } } }`; `oidcClient` = `{ type: "oauth2", flows: { clientCredentials: { tokenUrl, scopes: {} } } }`; `widgetSession` = `{ type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Token devuelto por POST /widget/sessions" }`.
  - `export const USER = [{ oidcUser: [] }]`, `CLIENT = [{ oidcClient: [] }]`, `WIDGET = [{ widgetSession: [] }]`, `USER_OR_CLIENT = [{ oidcUser: [] }, { oidcClient: [] }]`, `ANY_IDENTITY = [{ widgetSession: [] }, { oidcUser: [] }, { oidcClient: [] }]`.
  - `export type ProviderEndpoints = { authorizationEndpoint: string | null; tokenEndpoint: string };`
  - `export function withProviderUrls<T>(document: T, endpoints: ProviderEndpoints): T`: copia profunda que sustituye los marcadores en `components.securitySchemes`. Si `authorizationEndpoint` es `null`, elimina el flujo `authorizationCode` de `oidcUser` (y el esquema si se queda sin flujos, junto con sus usos en `security`). No muta la entrada.

Asignación por operación (lo que el código ya exige; ver `privateRoute([...])` de cada `route.ts`):

- `/api/v1`: `operator`/`admin` → `USER`; `GET /widget/conversation` y `POST /widget/conversation/messages` → `WIDGET`; `GET /me` → `ANY_IDENTITY`; `/health`, `/auth/backchannel-logout`, `/widget/sessions`, `/widget/sessions/refresh` → `[]`.
- `/api/sim/v1`: las 24 → `USER`.
- `/api/platform/v1`: las 4 → `USER_OR_CLIENT` (`platform-lab` por PKCE o `chatbot-platform` por `client_credentials`).

- [ ] **Step 1: Write the failing tests** en `contrato-api.test.ts`, nuevo `describe("contrato-api: seguridad OAuth2")`:
  - `"ningun contrato declara bearerAuth ni platformBearer"`: para los tres documentos, `Object.keys(doc.components.securitySchemes).sort()` es igual a `["oidcClient", "oidcUser", "widgetSession"]` (en plataforma y sim basta con que sea subconjunto y no contenga `bearerAuth`/`platformBearer`).
  - `"los flujos llevan los marcadores, nunca una URL real"`: `doc.components.securitySchemes.oidcUser.flows.authorizationCode.authorizationUrl === "https://oidc.invalid/authorize"` y `tokenUrl === "https://oidc.invalid/token"`.
  - `"el simulador exige usuario"`: toda operación de `buildSimOpenApiDocument()` tiene `security` igual a `[{ oidcUser: [] }]`.
  - `"GET /me admite widget, usuario y cliente"`: `security` de `paths["/me"].get` igual a `ANY_IDENTITY`.
  - `"withProviderUrls sustituye sin mutar"`: con `{ authorizationEndpoint: "https://idp.test/auth", tokenEndpoint: "https://idp.test/token" }`, el resultado lleva esas URLs y el original sigue con los marcadores.
  - `"withProviderUrls sin authorization_endpoint quita el flujo de usuario"`: con `authorizationEndpoint: null`, `oidcUser` desaparece de `securitySchemes` y ninguna operación lo referencia; `oidcClient` sigue con la URL de token real.
- [ ] **Step 2: Run** `npm --prefix backend exec vitest run tests/contrato-api.test.ts`. Expected: FAIL (no existe `openapi-security.ts`).
- [ ] **Step 3: Implement** `openapi-security.ts` y sustituye `bearer`/`bearerAuth`/`platformAuth`/`platformBearer` en los builders por las constantes de arriba. Actualiza la descripción de `openapi-platform.ts` (quita «OAuth2 llega en la 5.3»).
- [ ] **Step 4: Run** `npm --prefix backend run openapi:generate`, después `npm --prefix backend exec vitest run tests/contrato-api.test.ts tests/fronteras.test.ts` y `npm --prefix backend run typecheck`. Expected: PASS.
- [ ] **Step 5: Regenerate the frontend clients** con el comando orval del `frontend/package.json` y comprueba con `git status` que el cliente generado no cambia de firma (la seguridad no altera las funciones). Si cambia, se commitea lo regenerado, nunca editado. Corre `npm --prefix frontend run typecheck`.
- [ ] **Step 6: Commit** `feat(openapi): esquemas OAuth2 del proveedor en los tres contratos`.

### Task 2: discovery con `authorization_endpoint` y configuración de `/docs`

**Files:**

- Modify: `backend/src/modules/auth/infrastructure/oidc-discovery.ts`, `backend/src/config/env.ts`
- Create: `backend/src/composition/docs-wiring.ts`
- Modify: el composition root para exponer `docs` (mismo patrón que `authWiring`)
- Test: `backend/tests/config-oidc.test.ts` (o un `tests/docs-config.test.ts` nuevo), `backend/tests/oidc-verificador.test.ts` si cubre el discovery, `backend/tests/docs-wiring.test.ts`

**Interfaces:**

- Consumes: `ProviderEndpoints`, `withProviderUrls` (tarea 1).
- Produces:
  - `OidcDiscovery` gana `authorizationEndpoint: string | null` (opcional en el documento del proveedor; `jwksUri` y `tokenEndpoint` siguen obligatorios).
  - `AppConfig.docs: { readonly enabled: boolean; readonly oidcClientId: string }`, leído de `DOCS_ENABLED` (`"true"` → `true`, cualquier otro valor → `false`) y `DOCS_OIDC_CLIENT_ID` (por defecto `"chatbot-swagger"`).
  - `docs-wiring.ts`: `export type DocsWiring = { readonly enabled: boolean; readonly oidcClientId: string; readonly contracts: readonly DocsContract[]; servedDocument(name: string): Promise<unknown | null> }` con `type DocsContract = { name: "chatbot" | "platform" | "sim"; title: string }`. `contracts` incluye `sim` solo si `hermesSimulatorEnabled`. `servedDocument` devuelve `null` para un nombre fuera de `contracts`; si no, el builder correspondiente pasado por `withProviderUrls` con los endpoints del discovery. Un fallo del discovery se propaga como `IdentityUnavailableError` (la ruta lo traduce a `503`).
  - `export function docsWiring(config: AppConfig, discovery: () => Promise<OidcDiscovery>): DocsWiring`.

- [ ] **Step 1: Write the failing tests:**
  - discovery: un documento sin `authorization_endpoint` resuelve con `authorizationEndpoint: null`; con él, lo devuelve.
  - config: sin variables, `docs` es `{ enabled: false, oidcClientId: "chatbot-swagger" }`; con `DOCS_ENABLED=true` y `DOCS_OIDC_CLIENT_ID=otro`, se reflejan; `DOCS_ENABLED=yes` → `false`.
  - wiring (con un `discovery` falso): `contracts` sin `sim` cuando el simulador está apagado; `servedDocument("sim")` → `null` en ese caso; `servedDocument("nada")` → `null`; `servedDocument("chatbot")` lleva `tokenUrl` del discovery falso; con discovery que rechaza, `servedDocument("chatbot")` rechaza con `IdentityUnavailableError`.
- [ ] **Step 2: Run** los tests. Expected: FAIL.
- [ ] **Step 3: Implement** los tres cambios.
- [ ] **Step 4: Run** `npm --prefix backend test` y `npm --prefix backend run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(docs): configuracion y documentos servidos con los endpoints del proveedor`.

### Task 3: rutas de `/docs` con Swagger UI

**Files:**

- Create: `backend/src/http/docs/page.ts` (HTML), `backend/src/http/docs/assets.ts` (lectura de `swagger-ui-dist`), `backend/src/http/docs/guard.ts` (404 si apagado + CSP)
- Create: `backend/src/app/docs/route.ts` (`GET /docs`), `backend/src/app/docs/openapi/[name]/route.ts` (`GET /docs/openapi/{name}` con `name` = `chatbot.json` | `platform.json` | `sim.json`), `backend/src/app/docs/assets/[file]/route.ts` (`GET /docs/assets/{file}`), `backend/src/app/docs/oauth2-redirect.html/route.ts` (página de retorno OAuth2 de Swagger UI)
- Modify: `backend/package.json` (dependencia `swagger-ui-dist`), `backend/next.config.ts` (`outputFileTracingIncludes` para que los activos entren en `standalone`)
- Test: `backend/tests/http/docs.test.ts`

**Interfaces:**

- Consumes: `DocsWiring` vía `getContainer().docs` (tarea 2).
- Produces:
  - `export function docsPage(input: { contracts: readonly DocsContract[]; oidcClientId: string }): string`: HTML con `<link>`/`<script>` solo a `/docs/assets/...`, `SwaggerUIBundle({ urls: [{ url: "/docs/openapi/<name>.json", name: <title> }...], oauth2RedirectUrl: <origen>/docs/oauth2-redirect.html })` y `ui.initOAuth({ clientId, usePkceWithAuthorizationCodeGrant: true })`. El script de arranque va en un activo propio (`/docs/assets/init.js`) que lee la configuración de un `<script type="application/json" id="docs-config">`, para que la CSP no necesite `unsafe-inline` en scripts.
  - `export const ALLOWED_ASSETS: ReadonlySet<string>`: lista cerrada (`swagger-ui.css`, `swagger-ui-bundle.js`, `swagger-ui-standalone-preset.js`, `favicon-32x32.png`, más `init.js` propio). Un nombre fuera de la lista → `404`.
  - CSP de `/docs`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <origen del issuer>; frame-ancestors 'none'`.
  - Si `docs.enabled` es `false`, las cuatro rutas responden `404` sin cuerpo propio de docs (mismo `404` que una ruta inexistente de Next: `new Response(null, { status: 404 })`).
  - `/docs/openapi/{name}`: `200` `application/json` con `servedDocument`; `404` si devuelve `null`; `503` con la envoltura REST (`errorResponse(toApiError(error), requestId)`) si el discovery falla.

- [ ] **Step 1: Write the failing tests** en `tests/http/docs.test.ts` (proyecto `unit`, con `installFakeIdp()` de `tests/helpers/idp.ts` y `resetContainer()` entre casos):
  - `"apagado: /docs y sus hijos dan 404"` con `DOCS_ENABLED` sin definir.
  - `"encendido: la pagina solo referencia /docs/assets y declara la CSP"`: el HTML no contiene `http://` ni `https://` fuera del `docs-config`; la cabecera `Content-Security-Policy` empieza por `default-src 'self'`.
  - `"sin simulador no se ofrece sim"`: `docs-config` sin `sim` y `GET /docs/openapi/sim.json` → `404`.
  - `"el documento servido lleva el token endpoint del proveedor"`: `tokenUrl` igual al del IdP falso; ninguna aparición de `oidc.invalid`.
  - `"proveedor caido: 503 con envoltura"` con `setFakeIdpDown(true)`: status `503`, `body.error.code === "identity_unavailable"`.
  - `"activos: lista cerrada"`: `swagger-ui-bundle.js` → `200` `text/javascript`; `../package.json`, `%2e%2e%2fpackage.json` y `nada.js` → `404`.
- [ ] **Step 2: Run** `npm --prefix backend exec vitest run tests/http/docs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Install** `npm --prefix backend install swagger-ui-dist` y comprueba `npm --prefix backend ls swagger-ui-dist`.
- [ ] **Step 4: Implement** las rutas y los módulos de `src/http/docs/`. Los activos se leen con `node:fs` desde `require.resolve("swagger-ui-dist/package.json")` (esto vive en `src/http`, adaptador, no en `domain`/`application`).
- [ ] **Step 5: Run** el test, `npm --prefix backend run typecheck`, `npm --prefix backend exec vitest run tests/fronteras.test.ts tests/contrato-api.test.ts` y `npm --prefix backend run build`. Expected: PASS y build terminado; en `.next/standalone` existe `node_modules/swagger-ui-dist/swagger-ui-bundle.js`.
- [ ] **Step 6: Config files:** `DOCS_ENABLED=true` y `DOCS_OIDC_CLIENT_ID=chatbot-swagger` en `backend/.env.example` (con comentario: «solo laboratorio y desarrollo; en producción, false») y en el servicio `backend` de `docker-compose.yml` (`DOCS_ENABLED: ${DOCS_ENABLED:-true}`).
- [ ] **Step 7: Commit** `feat(docs): Swagger UI en /docs solo en laboratorio y desarrollo`.

### Task 4: cliente `chatbot-newman` en el laboratorio

**Files:**

- Modify: `backend/scripts/idp-lab/plan.ts`, `backend/scripts/idp-lab/apply.ts`, `backend/scripts/idp-lab/index.ts`
- Test: `backend/tests/idp-lab-plan.test.ts`

**Interfaces:**

- Produces:
  - `ClientPlan` gana `directAccessGrants?: true`. `clientBody` usa `directAccessGrantsEnabled: plan.directAccessGrants === true`.
  - En `interactiveClients`: `{ clientId: "chatbot-newman", public: false, redirectUris: [], directAccessGrants: true, mappers: [] }` (recibe el client scope por defecto, como los demás).
  - `printEnv` añade un bloque `# Postman (docs/lab.postman_environment.template.json)` con líneas `clave=valor` para cada variable de la plantilla de la tarea 9 que el laboratorio conoce: `base_url`, `oidc_token_url` (`<issuer>/protocol/openid-connect/token`, se construye en el script, nunca en `src`), `newman_client_id`, `newman_client_secret`, `platform_client_id`, `platform_client_secret`, `tenant_a_id`, `tenant_a_slug`, `service_a_client_id`, `service_a_client_secret` y los mismos para `b` (primeras dos clínicas del plan, en orden).
  - Si existe `LAB_POSTMAN_ENV_OUT`, escribe además ese archivo con el formato de entorno Postman y los valores rellenos (los secretos con `type: "secret"`). `LAB_POSTMAN_ENV_OUT` debe apuntar fuera del repo o a un nombre ignorado: añade `*.postman_environment.json` a `.gitignore` (la plantilla se llama `*.template.json` y sí se versiona).

- [ ] **Step 1: Write the failing tests** en `idp-lab-plan.test.ts`:
  - `"chatbot-newman es confidencial y con password grant"`.
  - `"ningun otro cliente tiene password grant"`: `plan.clients.filter((c) => c.directAccessGrants).map((c) => c.clientId)` igual a `["chatbot-newman"]`.
  - Si `clientBody` es exportable sin red, `"clientBody traduce directAccessGrants"`; si no, exporta `clientBody` para el test.
- [ ] **Step 2: Run** `npm --prefix backend exec vitest run tests/idp-lab-plan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** el test y `npm --prefix backend run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(idp-lab): cliente chatbot-newman con password grant solo en el laboratorio`.

### Task 5: arnés de `contrato-rutas` (validador, mundo, tablas)

**Files:**

- Create: `backend/tests/db/contrato-rutas/validator.ts`, `backend/tests/db/contrato-rutas/world.ts`, `backend/tests/db/contrato-rutas/types.ts`, `backend/tests/db/contrato-rutas/exemptions.ts`
- Create: `backend/tests/db/contrato-rutas-cobertura.test.ts`
- Modify: `backend/package.json` (devDependencies `ajv`, `ajv-formats`)

**Interfaces:**

- Produces (`types.ts`):

  ```ts
  export type Surface = "chatbot" | "platform" | "sim";
  export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
  export type ContractCase = {
    readonly surface: Surface;
    readonly method: HttpMethod;
    readonly path: string;   // clave exacta de document.paths, p. ej. "/knowledge-entries/{id}"
    readonly status: number;
    readonly name: string;
    readonly run: (world: ContractWorld) => Promise<Response>;
  };
  export const CHECKED_STATUSES = [400, 401, 403, 404, 409, 422, 429] as const;
  ```
- Produces (`validator.ts`): `export function createContractValidator(surface: Surface): { check(c: Pick<ContractCase, "method" | "path" | "status">, response: Response): Promise<void> }`. Construye el documento con el builder de la superficie (no el JSON), usa `Ajv2020` (`ajv/dist/2020`) con `strict: false` y `ajv-formats`, y resuelve los `$ref` locales compilando cada esquema de respuesta con los `components` del documento embebidos en su raíz. `check` lanza un `Error` con operación, status y errores de ajv si: el status real ≠ `c.status`; el status no está en `responses` de la operación; el `Content-Type` (sin parámetros) no coincide con la clave de `content`; el cuerpo no valida; falta `X-Request-Id`.
- Produces (`world.ts`): `export type ContractWorld = { prisma; tenantA: ChatbotTenantSeed & DomainIds; tenantB: ...; tokens: { adminA; operatorA; adminB; platform; serviceA }; widgetA: WidgetChat }` y `export async function seedContractWorld(prisma: PrismaClient): Promise<ContractWorld>`. Reutiliza `truncateAll`, `insertChatbotTenant`, `seedTenantDomain` (`tests/db/support.ts`), `enableWidget`/`openChat` (`tests/db/chat-support.ts`), `signToken`/`platformToken` (`tests/helpers/idp.ts`) y `serviceToken` (`tests/helpers/fhir.ts`). Los ids de dominio (practitioner, schedule, slot libre, paciente, entrada de conocimiento) quedan en el mundo para que los casos no consulten la base.
- Produces (`exemptions.ts`): `export const EXEMPTIONS: Readonly<Record<string, Readonly<Partial<Record<number, string>>>>>` con clave `"<surface> <METHOD> <path>"` y motivo no vacío por status.

- [ ] **Step 1: Write the failing tests** en `contrato-rutas-cobertura.test.ts` (estos tests usan el validador sobre `Response` construidas a mano; las tablas aún están vacías):
  - `"el validador rechaza un status no declarado"`: `check({ method: "get", path: "/me", status: 418 }, new Response("{}", { status: 418, headers: {...} }))` rechaza.
  - `"el validador rechaza un 404 con cuerpo de exito"`: `GET /me`, status 404, cuerpo `{ subject: "x" }` → rechaza.
  - `"el validador rechaza otro Content-Type"`: cuerpo válido de error con `text/plain` → rechaza.
  - `"el validador rechaza sin X-Request-Id"`.
  - `"el validador acepta un error bien formado"`: `401` con `{ error: { code: "unauthorized", message: "m", request_id: "r" } }`, `application/json` y `X-Request-Id`.
  - `"500 y 503 referencian el esquema comun"`: para cada operación de las tres superficies que declare `500` o `503`, su esquema es `{ $ref: "#/components/schemas/Error" }`.
  - `"cada exencion lleva motivo"`: todos los valores de `EXEMPTIONS` son cadenas no vacías y cada clave existe en su documento.
- [ ] **Step 2: Run** `npm --prefix backend exec vitest run --project db tests/db/contrato-rutas-cobertura.test.ts` (con Postgres arriba; ver memoria de Laragon). Expected: FAIL.
- [ ] **Step 3: Install** `npm --prefix backend install -D ajv ajv-formats`.
- [ ] **Step 4: Implement** `types.ts`, `validator.ts`, `exemptions.ts` (vacío por ahora) y `world.ts`.
- [ ] **Step 5: Run** el test. Expected: PASS.
- [ ] **Step 6: Commit** `test(contrato-rutas): validador contra el esquema y mundo sembrado`.

### Task 6: casos de `contrato-rutas` del chatbot

**Files:**

- Create: `backend/tests/db/contrato-rutas/cases-chatbot-panel.ts`, `backend/tests/db/contrato-rutas/cases-chatbot-widget.ts` (si alguno pasa de 400 líneas, partir por recurso)
- Create: `backend/tests/db/contrato-rutas-chatbot.test.ts`
- Modify: `backend/tests/db/contrato-rutas/exemptions.ts`, `backend/tests/db/contrato-rutas-cobertura.test.ts`

**Interfaces:**

- Consumes: `ContractCase`, `ContractWorld`, `seedContractWorld`, `createContractValidator`, `EXEMPTIONS`, `CHECKED_STATUSES` (tarea 5).
- Produces: `export const CHATBOT_PANEL_CASES: readonly ContractCase[]` y `export const CHATBOT_WIDGET_CASES: readonly ContractCase[]`.

Reglas de los casos:

- Por cada una de las 28 operaciones de `buildOpenApiDocument()`: un caso del 2xx declarado y uno por cada status de `CHECKED_STATUSES` declarado que sea reproducible. Cómo reproducir los habituales: `401` sin `Authorization`; `403` con un token de rol no admitido (p. ej. `operator` en una escritura de `admin`, `widget` en el panel); `404` con un id de la clínica B usando token de la A; `422` con cuerpo o query inválidos; `409` con la misma `Idempotency-Key` y otro cuerpo, o el conflicto de dominio que la operación declare; `429` en `POST /widget/sessions` con `widget_sessions_per_ip_per_minute` = 1 en la clínica del caso; `400` donde se declare.
- Lo no reproducible va a `EXEMPTIONS` con motivo.
- Cada caso abre su propio estado si lo muta (crea antes lo que borra); el `beforeAll` del archivo siembra el mundo una vez y `beforeEach` no trunca (los casos no dependen entre sí salvo por lo que crean ellos mismos).

- [ ] **Step 1: Write the meta-test** en `contrato-rutas-cobertura.test.ts`: `"toda operacion del chatbot tiene sus casos o exenciones"`. Para cada `(method, path)` de `buildOpenApiDocument().paths` y cada status de `[2xx declarado, ...CHECKED_STATUSES]` presente en `responses`, existe un caso en `CHATBOT_PANEL_CASES ∪ CHATBOT_WIDGET_CASES` con ese `surface/method/path/status` o una entrada en `EXEMPTIONS["chatbot <METHOD> <path>"][status]`. Además, ningún caso apunta a una operación o status no declarados.
- [ ] **Step 2: Run** el meta-test. Expected: FAIL listando las faltas.
- [ ] **Step 3: Write** `contrato-rutas-chatbot.test.ts`: `describe("contrato-rutas: chatbot")`, `beforeAll` con `seedContractWorld`, e `it.each` sobre las dos tablas: `await validator.check(c, await c.run(world))`.
- [ ] **Step 4: Write** las tablas hasta que el meta-test y los casos pasen. Si un caso revela una respuesta fuera de esquema, se corrige el builder (si el contrato estaba mal) o el handler (si el código estaba mal), se regenera el OpenAPI y se anota en el commit.
- [ ] **Step 5: Run** `npm --prefix backend exec vitest run --project db tests/db/contrato-rutas-chatbot.test.ts tests/db/contrato-rutas-cobertura.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `test(contrato-rutas): operaciones del chatbot`.

### Task 7: casos de `contrato-rutas` de plataforma y simulador

**Files:**

- Create: `backend/tests/db/contrato-rutas/cases-platform.ts`, `backend/tests/db/contrato-rutas/cases-sim.ts` (partir por recurso si pasa de 400 líneas)
- Create: `backend/tests/db/contrato-rutas-platform.test.ts`, `backend/tests/db/contrato-rutas-sim.test.ts`
- Modify: `exemptions.ts`, `contrato-rutas-cobertura.test.ts`

**Interfaces:**

- Consumes: lo de la tarea 5 y el patrón de la tarea 6.
- Produces: `PLATFORM_CASES`, `SIM_CASES` (mismo tipo).

Notas: las 4 de plataforma usan `world.tokens.platform` (y `403` con un token `admin` de clínica). Las 24 del simulador corren con `HERMES_SIMULATOR_ENABLED=true` y la pasarela FHIR en modo `handlers`, como `hermes-simulador.test.ts`; `403` con `operator`; `404` con id de la otra clínica.

- [ ] **Step 1: Extend the meta-test** a `platform` y `sim` (misma regla, generalizada a las tres superficies con un solo bucle). Run: FAIL.
- [ ] **Step 2: Write** los dos archivos de test y las tablas.
- [ ] **Step 3: Run** `npm --prefix backend exec vitest run --project db tests/db/contrato-rutas-platform.test.ts tests/db/contrato-rutas-sim.test.ts tests/db/contrato-rutas-cobertura.test.ts`. Expected: PASS.
- [ ] **Step 4: Run** `npm --prefix backend run test:db` completo (una sola corrida; dos simultáneas comparten la base y dan fallos falsos). Expected: PASS.
- [ ] **Step 5: Commit** `test(contrato-rutas): plataforma y simulador con meta-test de cobertura`.

### Task 8: generador de la colección Postman

**Files:**

- Create: `backend/scripts/postman/generate.ts` (CLI), `backend/scripts/postman/build-collection.ts`, `backend/scripts/postman/examples.ts`, `backend/scripts/postman/auth.ts`, `backend/scripts/postman/environment.ts`
- Create: `backend/scripts/postman/fragments/` (vacío salvo un `index.ts` que exporta `[]` por ahora; la tarea 9 lo llena)
- Generate: `docs/chatbot-ingenius-360.postman_collection.json`, `docs/lab.postman_environment.template.json`
- Modify: `backend/package.json` (`"postman:generate": "tsx scripts/postman/generate.ts"`)
- Test: `backend/tests/postman-generador.test.ts`; `backend/tests/contrato-api.test.ts`

**Interfaces:**

- Consumes: los tres builders OpenAPI.
- Produces:
  - `export type AuthProfile = "none" | "widget" | { user: "admin_a" | "operator_a" | "admin_b" | "operator_b" | "platform_lab" } | { client: "service_a" | "service_b" | "platform" };`
  - `export function authPrerequest(profile: AuthProfile): string[]`: líneas del script de pre-petición. Para usuario: `password` grant con `{{newman_client_id}}`/`{{newman_client_secret}}`, usuario `admin-{{tenant_a_slug}}` (etc.; `platform-lab` literal) y `{{lab_user_password}}`; para cliente: `client_credentials`. Cachea `access_token` y caducidad por perfil en `pm.collectionVariables` y renueva si faltan menos de 30 s. Deja el token en `pm.variables.set("access_token", ...)`. Para `widget`, usa `{{widget_token_a}}` fijado por la petición de apertura. Para `none`, quita `Authorization`.
  - `export function exampleFromSchema(schema: unknown, components: unknown): unknown`: primer valor de `enum`, `example`, o un valor mínimo por tipo; resuelve `$ref`; los `string` libres llevan el prefijo `newman-`.
  - `export type Fragment = { name: string; item: unknown[]; prerequest?: string[] }` (carpeta Postman v2.1).
  - `export function buildPostmanCollection(fragments: readonly Fragment[]): PostmanCollection`: primero los fragmentos en el orden recibido (lo que ejecuta Newman); después, una carpeta `catálogo` (para explorar a mano en Postman; Newman no la ejecuta, porque sus peticiones llevan ids de ruta como variables de Postman `:id` y cuerpos de ejemplo que no se pueden limpiar) con subcarpetas `chatbot`, `platform`, `sim` generadas (una petición por operación, con `{{base_url}}` + prefijo de la superficie, cabecera `Idempotency-Key: {{$guid}}` en escrituras, `X-Conversation-Secret: {{conversation_secret_a}}` donde se declare, cuerpo de ejemplo y un test que comprueba el status 2xx declarado y `X-Request-Id`), cada subcarpeta con el pre-request de su perfil. Las operaciones de la lista `MANUAL_ONLY` (`POST /bot-config/widget-keys/rotate`, `PUT /tenants/{id}/widget-client`) van a una subcarpeta `manual — rompe el laboratorio` del catálogo y no a la suya, y ningún fragmento las usa.
  - `export function buildEnvironmentTemplate(): PostmanEnvironment`: las variables de la tarea 4 más `lab_user_password` (secreta), todas con valor vacío; las secretas con `type: "secret"`.
  - `export function newmanFolders(fragments: readonly Fragment[]): string[]`: los nombres de los fragmentos, en orden; nunca `catálogo`.

- [ ] **Step 1: Write the failing tests** en `postman-generador.test.ts`:
  - `"el catalogo tiene una peticion por operacion declarada"`: total de peticiones en `catálogo/chatbot`+`platform`+`sim` = 56 − 2, y `catálogo/manual — rompe el laboratorio` tiene 2.
  - `"Newman nunca ejecuta el catalogo"`: `newmanFolders(fragmentosDePrueba)` no contiene `catálogo`.
  - `"las escrituras llevan Idempotency-Key"`: toda petición `POST|PUT|PATCH|DELETE` generada lleva la cabecera, salvo las de `security: []` que el contrato no marca con idempotencia.
  - `"el simulador usa usuario admin y plataforma usa el cliente"`: el pre-request de `sim` contiene `grant_type=password`; el de `platform` contiene `client_credentials`.
  - `"ningun secreto en la plantilla"`: todos los `value` de `buildEnvironmentTemplate()` son `""`.
  - `"la coleccion no contiene keycloak ni oidc.invalid"`: `JSON.stringify(collection)` no contiene ninguno de los dos.
  - `"el pre-request renueva antes de caducar"` (Review Focus 5): ejecuta con `new Function("pm", lines.join("\n"))` un `pm` falso cuyo `sendRequest` cuenta llamadas; con un token cacheado que caduca en 10 s, hace una petición nueva; con uno que caduca en 120 s, no.
- [ ] **Step 2: Run** `npm --prefix backend exec vitest run tests/postman-generador.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** los módulos y `generate.ts` (escribe los dos JSON con `JSON.stringify(x, null, 2)` + salto final). Los ids de petición son deterministas (derivados de método + ruta), para que regenerar no cambie el archivo.
- [ ] **Step 4: Add** a `contrato-api.test.ts`: `"la coleccion Postman esta al dia con el generador"` y `"la plantilla de entorno esta al dia"` (mismo patrón que los OpenAPI).
- [ ] **Step 5: Run** `npm --prefix backend run postman:generate` y los dos tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(postman): coleccion generada desde los contratos OpenAPI`.

### Task 9: fragmentos — widget E2E, ciclo FHIR, maestros y limpieza

**Files:**

- Create: `backend/scripts/postman/fragments/setup.ts`, `widget-e2e.ts`, `fhir.ts`, `sim-crud.ts`, `platform.ts`, `cleanup.ts`, y `fragments/index.ts` (orden)
- Regenerate: la colección
- Test: `backend/tests/postman-fragmentos.test.ts`

**Interfaces:**

- Consumes: `Fragment`, `authPrerequest` (tarea 8).
- Produces: `export const FRAGMENTS: readonly Fragment[]` en este orden y con estos nombres de carpeta:
  1. `setup`: con `admin_a`/`admin_b`, `GET /api/v1/bot-config` fija `widget_key_a`/`_b`, `widget_origin_a`/`_b` (primer origen permitido) y guarda la configuración en `bot_config_a_before`; `GET /fhir/Slot?status=free&_count=1` (token `service_a`/`_b`) fija `free_slots_a_before`/`_b` desde `Bundle.total`.
  2. `widget E2E — clinica A` y `— clinica B` (mismo fragmento parametrizado por letra): abre sesión (`POST /widget/sessions` con `Origin: {{widget_origin_x}}`, guarda token y `conversation_secret`), y recorre:
     - **rechazo:** paciente existente, verificación, elige un cupo libre, crea la solicitud; `GET /fhir/Appointment?status=proposed` (service) la localiza; `PUT /fhir/Appointment/{id}` con `status: cancelled`.
     - **aprobación y cancelación:** otra solicitud; `PUT` a `booked`; en el chat, el paciente pide cancelar esa cita (origina el `Task`); `GET /fhir/Task?status=requested` lo localiza; `PUT /fhir/Task/{id}` `completed`.
     - **documento nuevo:** pre-registro con un número de documento aleatorio (queda como rastro) y una tercera solicitud que la bandeja del simulador rechaza (`POST /api/sim/v1/inbox/{id}/reject`, usuario `admin_x`).
     - Mensajes libres con prefijo `newman-`. El mapa pregunta→respuesta de verificación se construye importando `backend/prisma/seed/data.ts` (no copiando valores), para los pacientes sembrados que use.
     - La guía de la conversación (opciones, estados y textos) se toma de `backend/tests/db/flujo-http.test.ts`, que ya recorre estos caminos por HTTP.
  3. `fhir — maestros`: `PUT` condicional de `Practitioner`, `HealthcareService`, `Schedule` y `Slot` sembrados con sus mismos valores (los lee primero con `GET` y los reenvía); test: `200` y que el recurso releído es igual. Ningún `Patient`.
  4. `sim — CRUD`: crea `newman-` profesional, servicio, agenda, `slots:generate`; los lee; los borra en orden inverso con sus `DELETE`.
  5. `plataforma — clinica newman`: `GET /api/platform/v1/me` (cliente `platform`) y `POST /api/platform/v1/tenants` con `slug: "newman-clinica"`; test acepta `201` o `409` (`error.code === "conflict"`); `GET /api/platform/v1/tenants` la lista.
  6. `panel — clinica A` (usuario `admin_a`, y `operator_a` en las lecturas): conocimiento (crear `newman-`, leer, `PATCH`, borrar), `bot-config` (`PATCH` de un texto y restauración inmediata desde `bot_config_a_before`), orígenes permitidos (añadir `https://newman.invalid` y borrarlo), `tenant-settings` `GET`, agenda (`practitioners`, `healthcare-services`, `schedules`, `schedules/{id}/slots`, `availability`, `appointments`) y `medical-records/search` con el documento de un paciente sembrado. Un `operator_a` intentando una escritura recibe `403`.
  7. `cleanup`: rechaza (`PUT ... cancelled`) cada `Appointment` `proposed` cuyo motivo lleve `newman-`; borra las entradas de conocimiento `newman-`; si `bot_config_a_before` difiere de la actual, la restaura con `PATCH`; `GET /fhir/Slot?status=free&_count=1` y test `total === free_slots_x_before`.
- [ ] **Step 1: Write the failing tests** en `postman-fragmentos.test.ts`:
  - `"orden de carpetas"`: los nombres de `collection.item` son exactamente `setup`, `widget E2E — clinica A`, `widget E2E — clinica B`, `fhir — maestros`, `sim — CRUD`, `plataforma — clinica newman`, `panel — clinica A`, `cleanup`, `catálogo`.
  - `"cleanup compara los cupos libres con setup"`: el script de test de la última petición de `cleanup` referencia `free_slots_a_before` y `free_slots_b_before`.
  - `"ningun PUT de maestros toca Patient"`.
  - `"todo texto libre que se envia lleva newman-"`: en los cuerpos `raw` de los fragmentos, cada valor de `message`, `question`, `answer`, `reason` o `notes` empieza por `newman-`.
- [ ] **Step 2: Run** el test. Expected: FAIL.
- [ ] **Step 3: Implement** los fragmentos y regenera con `npm --prefix backend run postman:generate`.
- [ ] **Step 4: Run** `npm --prefix backend exec vitest run tests/postman-fragmentos.test.ts tests/postman-generador.test.ts tests/contrato-api.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(postman): recorrido widget E2E, ciclo FHIR y limpieza`.

### Task 10: ejecutor Newman, documentación y política

**Files:**

- Create: `backend/scripts/postman/run.ts`
- Modify: `backend/package.json` (`"postman:run": "tsx scripts/postman/run.ts"`, devDependency `newman`)
- Modify: `README.md`, `GOBERNANZA.md` (§5.1 y la regla de `/docs` y password grant, junto a §1.3), `ROADMAP.md` («dieciocho» → «diecinueve» suites), `CLAUDE.md` (lista de suites; el estado de la Fase 5 se actualiza en la tarea 11), `.gitignore`

**Interfaces:**

- Consumes: `newmanFolders`, `FRAGMENTS` (tareas 8 y 9).
- Produces: `run.ts` acepta `--env <ruta>` (obligatorio; sin él, sale con código 1 y un mensaje en español) y llama a `newman.run({ collection, environment, folder: newmanFolders(FRAGMENTS), reporters: ["cli"] })`; sale con código 1 si hay fallos.

- [ ] **Step 1: Install** `npm --prefix backend install -D newman` y comprueba `npm --prefix backend ls newman`.
- [ ] **Step 2: Implement** `run.ts`. Prueba: `npm --prefix backend run postman:run` sin `--env` → mensaje y código 1.
- [ ] **Step 3: Write** la documentación:
  - `README.md`: `/docs` (`DOCS_ENABLED`, `DOCS_OIDC_CLIENT_ID`, apagado en producción), cliente `chatbot-newman`, cómo producir el entorno (`LAB_POSTMAN_ENV_OUT` en `idp:lab` o copiar la plantilla y rellenarla con su salida), `postman:generate`, `postman:run -- --env <ruta>`, la carpeta manual y qué deja de rastro una ejecución.
  - `GOBERNANZA.md` §5.1: añadir `contrato-rutas` a la lista. Regla nueva: Swagger UI (`/docs`) solo en laboratorio y desarrollo; password grant solo en `chatbot-newman` del realm de laboratorio; Hermes nunca lo necesita.
  - `ROADMAP.md` y `CLAUDE.md`: `contrato-rutas` en la lista de suites y el recuento a diecinueve.
- [ ] **Step 4: Run** la batería completa (una sola corrida de `test:db`) y deja la salida en el informe:
  - `npm run ci`
  - `npm run typecheck`
  - `npm test`
  - `npm --prefix backend run test:db`
  - `npm --prefix backend run build`
    Expected: todo en verde.
- [ ] **Step 5: Commit** `docs: contrato publicado, Newman y politica de /docs`.

### Task 11: verificación en el laboratorio y cierre

Esta tarea necesita la rama desplegada en Easypanel (Easypanel despliega `main`). El despliegue es del usuario.

- [ ] **Step 1: Reconfigure the lab.** Corre `npm --prefix backend run idp:lab` con `LAB_POSTMAN_ENV_OUT` apuntando a un archivo fuera del repo. Expected: la salida lista `chatbot-newman` y el bloque Postman.
- [ ] **Step 2: Hand off to the user** esta lista:
  1. Desplegar la rama en el backend del laboratorio con `DOCS_ENABLED=true` (y `DOCS_OIDC_CLIENT_ID=chatbot-swagger`).
  2. Si la base del laboratorio no tiene cupos futuros suficientes, resembrar con `db:seed -- --anchor <hoy>`.
- [ ] **Step 3: Verify** (§8 de la spec), cuando el usuario confirme el despliegue:
  1. `/docs` carga los tres contratos; en la pestaña de red no hay peticiones a terceros.
  2. «Authorize» con PKCE como `admin-clinica-norte` y `GET /knowledge-entries` en `200`.
  3. «Authorize» con `client_credentials` como `chatbot-platform` y `GET /api/platform/v1/me` en `200`; con `service-<tenant>`, `GET /api/v1/me` en `200`.
  4. `npm --prefix backend run postman:run -- --env <archivo>` dos veces seguidas en verde (la última petición de `cleanup` compara los cupos libres).
  5. Con `DOCS_ENABLED=false`, `/docs` → `404`.
- [ ] **Step 4: Update** `ROADMAP.md` (bloque **Estado**: 5.3 y Fase 5 cerradas, porcentajes recalculados según GOBERNANZA §7.1) y `CLAUDE.md` (estado de la Fase 5) solo después de que pasen los pasos 3.1 a 3.5 y de que el usuario confirme el cierre de la 5.2.
- [ ] **Step 5: Commit** `docs: fase 5.3 cerrada`.
