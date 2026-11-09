# Fase 5.2 — Frontend de referencia con login OIDC: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La consola (`/panel`, `/simulador`) entra y sale por el proveedor OIDC con Authorization Code + PKCE, ya no hay campos para pegar tokens, y una persona `platform` da de alta clínicas con su propia sesión.

**Architecture:** Un almacén de sesión síncrono (`lib/token.ts`) sigue siendo lo único que leen `apiFetcher` y los hooks. Un adaptador (`lib/auth/`) es el único que importa `oidc-client-ts` y alimenta ese almacén con los eventos del `UserManager`. El backend gana `GET /api/platform/v1/me`, y `idp:lab` gana el usuario `platform-lab`.

**Tech Stack:** Next.js 16 (App Router), React 19, TanStack Query 5, orval, `oidc-client-ts` 3.x, Vitest 5 (entorno `node`, sin RTL), Biome.

**Spec:** `docs/superpowers/specs/2026-10-28-fase-5-2-frontend-referencia-design.md`

## Global Constraints

- El texto `keycloak` no aparece en `frontend/src/**` ni en `backend/src/**` (suite `fronteras`). No se usa `keycloak-js`.
- Ningún secreto de cliente llega al navegador. Queda prohibido cualquier campo o camino para pegar un JWT.
- `process.env` solo se lee en `frontend/src/config/env.ts`, en el servidor y por petición, no en el build.
- `oidc-client-ts` solo se importa desde `frontend/src/lib/auth/**`.
- El frontend no decodifica el access token para decidir nada. Rol y clínica salen de `/me`.
- Cliente público `chatbot-reference-ui`, `redirect_uri` `<origen>/auth/callback`, `post_logout_redirect_uri` `<origen>/`.
- `/api/v1/me` no cambia y sigue sin aceptar `platform`.
- `openapi*.json` y los clientes orval se regeneran, nunca se editan a mano.
- Umbrales: ≤ 40 líneas por función, ≤ 400 por archivo, complejidad cognitiva ≤ 15.
- Documentación y comentarios en español. Código, nombres y rutas en inglés. Los textos de interfaz van en español y no dicen «token» al pedir sesión: dicen «Inicia sesión».
- Tests del frontend en `frontend/tests/*.test.ts`, en entorno `node`. Los `.tsx` no tienen test unitario (excluidos de cobertura): la UI la cubre el recorrido manual de la tarea 7.

## Review Focus

1. **Renovación sin parpadeo:** cuando el token se renueva (cada ~2,5 min con 300 s de vida), las listas no deben vaciarse ni recargarse como si fuera otra sesión. Las claves de consulta usan una clave de sesión estable (`sid`, o `sub` si falta), no un sufijo del token. Lo prueba la tarea 3.
2. **Varios `401` a la vez:** cinco consultas que fallan juntas deben disparar **una sola** renovación y reintentar una vez cada una. Si la renovación falla, la sesión local se borra y no hay bucle. Lo prueba la tarea 3.
3. **Callback ejecutado dos veces:** el modo estricto de React monta dos veces la página de retorno. El canje del `code` debe ocurrir una sola vez, porque un segundo canje falla con `invalid_grant`. Lo prueba la tarea 4.
4. **Configuración horneada en el build:** si `PUBLIC_OIDC_*` se leyera al compilar, la imagen de Easypanel apuntaría al proveedor de la máquina de build. El layout de la consola es dinámico y `env.ts` lee en cada llamada. Lo prueba la tarea 4 en `env.test.ts`, y en el recorrido manual se cambia la variable sin recompilar.
5. **Sesión `platform` en pantallas de clínica:** `/api/v1/me` responde `403` a un token `platform`. Ese `403` no debe mostrarse como «Sesión rechazada» si `/api/platform/v1/me` respondió `200`. Lo prueba la tarea 5.

---

### Task 1: `GET /api/platform/v1/me`

**Files:**
- Create: `backend/src/app/api/platform/v1/me/route.ts`
- Modify: `backend/src/http/openapi-platform.ts` (schema y path)
- Regenerate: `backend/openapi-platform.json`
- Test: `backend/tests/roles.test.ts`

**Interfaces:**
- Produces: `GET /api/platform/v1/me` → `200 { subject: string, role: "platform" }`. `operationId: "getPlatformIdentity"`. Schema `PlatformIdentity` (`required: ["subject", "role"]`, `role: { type: "string", enum: ["platform"] }`). Responses `okJson(...)` + `readErrors`, `security: platformAuth`.

- [ ] **Step 1: Write the failing tests** en `roles.test.ts`, dentro del `describe` HTTP que ya usa `signToken`/`authedRequest`:

```ts
import { GET as getPlatformIdentity } from "@/app/api/platform/v1/me/route";

it("platform se identifica en /api/platform/v1/me", async () => {
  const token = await signToken({ role: "platform" });
  const response = await getPlatformIdentity(
    authedRequest("http://localhost/api/platform/v1/me", token),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ subject: expect.any(String), role: "platform" });
});

it("un rol de clinica no alcanza /api/platform/v1/me", async () => {
  const token = await signToken({ role: "admin", tenantId: "tenant-a" });
  const response = await getPlatformIdentity(
    authedRequest("http://localhost/api/platform/v1/me", token),
  );
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("forbidden");
});
```

- [ ] **Step 2: Run** `npm --prefix backend exec vitest run tests/roles.test.ts`. Debe fallar porque no existe el módulo de la ruta.

- [ ] **Step 3: Implement the route** con `platformRoute(async ({ actor }) => ({ subject: actor.subject, role: actor.role }))` y `export const dynamic = "force-dynamic"`, igual que `tenants/route.ts`.

- [ ] **Step 4: Run** `roles.test.ts` (PASS) y `npm --prefix backend exec vitest run tests/contrato-api.test.ts`. Esta segunda debe fallar con «toda ruta de /api/platform/v1 esta declarada».

- [ ] **Step 5: Declare** `"/me"` y el schema `PlatformIdentity` en `openapi-platform.ts`. Después corre `npm --prefix backend run openapi:generate`.

- [ ] **Step 6: Run** `contrato-api.test.ts` y `npm --prefix backend run typecheck`. Los dos deben pasar.

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/api/platform/v1/me backend/src/http/openapi-platform.ts backend/openapi-platform.json backend/tests/roles.test.ts
git commit -m "feat(platform): GET /api/platform/v1/me para la identidad de plataforma"
```

### Task 2: usuario `platform-lab` en el laboratorio

**Files:**
- Modify: `backend/scripts/idp-lab/plan.ts` (`UserPlan`, `buildLabPlan`)
- Modify: `backend/scripts/idp-lab/apply.ts` (`createUser`, `ensureUser`)
- Modify: `backend/scripts/idp-lab/index.ts` (`printEnv`)
- Test: `backend/tests/idp-lab-plan.test.ts`

**Interfaces:**
- Produces: `UserPlan = { username: string; tenantId?: string; role: LabRole }`. `export function userAttributes(existing: Record<string, unknown> | undefined, plan: UserPlan): Record<string, unknown>` en `apply.ts`. La función es pura: con `tenantId` pone `tenant_id: [tenantId]`, y sin él **quita** `tenant_id` y conserva el resto.

- [ ] **Step 1: Write the failing tests.** Actualiza el test «usuarios admin y operator por tenant» para que la lista termine en `"platform-lab"`, y añade estos:

```ts
it("platform-lab tiene rol platform y no lleva tenant", () => {
  expect(plan.users.find((u) => u.username === "platform-lab")).toEqual({
    username: "platform-lab",
    role: "platform",
  });
});
it("userAttributes fija tenant_id o lo quita", () => {
  expect(userAttributes({ x: ["1"] }, { username: "a", role: "admin", tenantId: "t" }))
    .toEqual({ x: ["1"], tenant_id: ["t"] });
  expect(userAttributes({ x: ["1"], tenant_id: ["viejo"] }, { username: "p", role: "platform" }))
    .toEqual({ x: ["1"] });
  expect(userAttributes(undefined, { username: "p", role: "platform" })).toEqual({});
});
```

- [ ] **Step 2: Run** `npm --prefix backend exec vitest run tests/idp-lab-plan.test.ts`. Debe fallar.

- [ ] **Step 3: Implement.** `buildLabPlan` añade `{ username: "platform-lab", role: "platform" }` después de los usuarios por tenant. `createUser` usa `userAttributes(undefined, plan)` y `ensureUser` usa `userAttributes(user.attributes, plan)`. `printEnv` imprime `tenant_id=(sin clínica)` cuando falta.

- [ ] **Step 4: Run** el test (PASS) y `npm --prefix backend run typecheck`.

- [ ] **Step 5: Commit** con `feat(idp-lab): usuario platform-lab sin tenant`.

### Task 3: almacén de sesión y fetchers

`lib/token.ts` deja de guardar un JWT pegado y pasa a ser un almacén en memoria de la sesión que le entrega el adaptador OIDC. Además coordina la renovación ante un `401`.

**Files:**
- Rewrite: `frontend/src/lib/token.ts`
- Modify: `frontend/src/lib/api-fetcher.ts`
- Modify: `frontend/src/lib/use-session.ts` (solo `useToken`, `useSessionKey` y `useAuthStatus`; `useIdentity` es de la tarea 5)
- Rewrite: `frontend/tests/token.test.ts`, `frontend/tests/platform-fetcher.test.ts`
- Modify: `frontend/tests/api-fetcher.test.ts`

**Interfaces:**
- Produces (`lib/token.ts`):
  - `type AuthStatus = "unconfigured" | "loading" | "anonymous" | "authenticated"`
  - `type SessionSnapshot = { status: AuthStatus; accessToken: string | null; sessionKey: string | null }`
  - `setSession(session: { accessToken: string; sessionKey: string } | null): void`. Con `null` el estado queda `anonymous`.
  - `setAuthStatus(status: "unconfigured" | "loading"): void`
  - `getSession(): SessionSnapshot`. Devuelve la misma referencia mientras no cambie, porque `useSyncExternalStore` lo exige.
  - `getToken(): string | null` y `subscribeSession(listener): () => void`
  - `SERVER_SNAPSHOT: SessionSnapshot` (`{ status: "loading", accessToken: null, sessionKey: null }`)
  - `setRenewer(renew: (() => Promise<string | null>) | null): void` y `renewToken(): Promise<string | null>`. `renewToken` comparte una sola promesa en vuelo y devuelve `null` si no hay renovador.
- Produces (`lib/use-session.ts`): `useToken(): string | null`, `useSessionKey(): string | null`, `useAuthStatus(): AuthStatus`
- Produces (`lib/api-fetcher.ts`): `apiFetcher` y `platformFetcher` mandan `Authorization: Bearer <getToken()>`. Ante un `401` llaman a `renewToken()`. Si devuelve token, reintentan **una** vez con él, el mismo cuerpo y la misma `Idempotency-Key`. Si no, lanzan el `ApiClientError` del `401`.

- [ ] **Step 1: Write the failing tests** en `token.test.ts`:
  - `"sin sesión el estado es anonymous y no hay token"`: tras `setSession(null)`, `getSession()` es `{ status: "anonymous", accessToken: null, sessionKey: null }`.
  - `"setSession publica token y clave, y avisa"`: un suscriptor ve un cambio y `getToken()` es `"at-1"`.
  - `"getSession conserva la referencia si nada cambia"`: `getSession() === getSession()`.
  - `"renovar con la misma sesión cambia el token pero no la clave"`: dos `setSession` con el mismo `sessionKey` `"sid-1"` y tokens distintos. La clave sigue siendo `"sid-1"`.
  - `"renewToken comparte una sola renovación"`: con un renovador `vi.fn` que resuelve tras un tick, cinco llamadas simultáneas lo invocan **una** vez y las cinco resuelven a `"at-2"`. Una sexta llamada, después, lo invoca otra vez.
  - `"renewToken sin renovador devuelve null"`.

  En `api-fetcher.test.ts`:
  - `"un 401 renueva y reintenta una vez con el token nuevo"`: `fetch` responde `401` y luego `200`, y el renovador devuelve `"at-2"`. El segundo `fetch` lleva `Bearer at-2` y el mismo `Idempotency-Key`.
  - `"si la renovación falla, lanza el 401 sin reintentar"`: el renovador devuelve `null`. `fetch` se llama una vez y se rechaza con `status: 401`.
  - `"un segundo 401 tras renovar no vuelve a renovar"`: `fetch` responde `401` dos veces. El renovador se llama una vez y se lanza el `401`.

  En `platform-fetcher.test.ts`, reescrito: `"usa el token de la sesión"` (`setSession({ accessToken: "at-p", sessionKey: "s" })`, y la petición lleva `Bearer at-p`).

- [ ] **Step 2: Run** `npm --prefix frontend exec vitest run tests/token.test.ts tests/api-fetcher.test.ts tests/platform-fetcher.test.ts`. Deben fallar.

- [ ] **Step 3: Implement** `lib/token.ts`. Usa un objeto inmutable que se sustituye en cada cambio, y deja el estado inicial en `loading`. `sessionStorage` ya no se usa aquí: la persistencia es del adaptador.

- [ ] **Step 4: Implement** el reintento en `api-fetcher.ts`. Extrae una función compartida `authorizedFetch(url, options): Promise<Response>` que usan los dos fetchers. El reintento reutiliza los mismos `headers`, cambiando solo `Authorization`.

- [ ] **Step 5: Implement** los hooks de `use-session.ts` con `useSyncExternalStore(subscribeSession, getSession, () => SERVER_SNAPSHOT)`. Después sustituye `token?.slice(-16) ?? null` por `useSessionKey()` en todas las `queryKey`:
  - `use-panel-data.ts`
  - `use-knowledge.ts`
  - `use-bot-config.ts`
  - `inbox-board.tsx`
  - `panel/ajustes/page.tsx`
  - la `queryKey` de `useIdentity`

  Usa `rg "slice\(-16\)" frontend/src` para comprobar que no queda ninguno. `enabled: Boolean(token)` no cambia.

- [ ] **Step 6: Run** los tests (PASS) y `npm --prefix frontend run typecheck`. El typecheck fallará en `session-drawer.tsx` y `tenants-panel.tsx` porque usan `setToken`/`clearToken`. Para seguir, quita el formulario de token de `session-drawer.tsx` y deja solo `Claims`, y quita de `tenants-panel.tsx` el campo y el `bearer()`, que ya no hacen falta. La UI definitiva es de la tarea 6.

- [ ] **Step 7: Commit** con `feat(frontend): almacén de sesión con renovación única ante 401`.

### Task 4: adaptador OIDC, configuración y callback

**Files:**
- Modify: `frontend/package.json` (dependencia `oidc-client-ts` ^3, con `npm --prefix frontend install oidc-client-ts@^3`)
- Modify: `frontend/src/config/env.ts`
- Create: `frontend/src/lib/auth/settings.ts`
- Create: `frontend/src/lib/auth/bind.ts`
- Create: `frontend/src/lib/auth/auth-provider.tsx`
- Create: `frontend/src/app/(console)/auth/callback/page.tsx`
- Modify: `frontend/src/app/(console)/layout.tsx`
- Test: `frontend/tests/env.test.ts`, `frontend/tests/auth-settings.test.ts`, `frontend/tests/auth-bind.test.ts`

**Interfaces:**
- Consumes: `setSession`, `setAuthStatus`, `setRenewer` (tarea 3).
- Produces:
  - `env.ts`: `oidcConfig(): { issuer: string; clientId: string } | null`. Lee `PUBLIC_OIDC_ISSUER` (sin barras finales, con `withoutTrailingSlashes`) y `PUBLIC_OIDC_CLIENT_ID`. Devuelve `null` si falta alguna de las dos.
  - `settings.ts`: `type OidcConfig = { issuer: string; clientId: string }` y `buildSettings(config: OidcConfig, origin: string, store: Storage): UserManagerSettings`, con estos valores:
    - `authority: issuer`
    - `client_id: clientId`
    - `redirect_uri: ${origin}/auth/callback`
    - `post_logout_redirect_uri: ${origin}/`
    - `response_type: "code"`
    - `scope: "openid"`
    - `automaticSilentRenew: true`
    - `monitorSession: false`
    - `userStore: new WebStorageStateStore({ store })`
  - `bind.ts`:
    - `type ManagerLike = Pick<UserManager, "getUser" | "signinSilent" | "removeUser" | "events">`
    - `toSession(user: User | null): { accessToken: string; sessionKey: string } | null`. Devuelve `null` si no hay usuario o `user.expired`. `sessionKey = String(user.profile.sid ?? user.profile.sub)`.
    - `bindManager(manager: ManagerLike): Promise<() => void>`. Carga `getUser()` en el almacén, se suscribe a `addUserLoaded`, `addUserUnloaded`, `addSilentRenewError` y `addAccessTokenExpired` (los dos últimos llaman a `removeUser()`), registra `setRenewer` y devuelve la función que deshace todo.
    - El renovador hace `signinSilent()` y devuelve su `access_token`. Si lanza, llama a `removeUser()` y devuelve `null`.
  - `auth-provider.tsx`: `AuthProvider({ config: OidcConfig | null, children })` y `useAuthActions(): { signIn(): Promise<void>; signOut(): Promise<void> }`.
    - `signIn` llama a `signinRedirect({ state: { returnTo: location.pathname + location.search } })`.
    - `signOut` llama a `signoutRedirect()`.
    - Con `config === null` hace `setAuthStatus("unconfigured")` y no crea el manager.
    - El manager se crea en un efecto, solo en el cliente, con `window.sessionStorage`.
    - Los hijos se pintan siempre, sin esperar la carga, para que `/chat` abra sin sesión.
  - `bind.ts` exporta también `completeSignIn(manager: Pick<UserManager, "signinRedirectCallback">): Promise<string>`. Memoiza la promesa por `location.search`, así que dos llamadas con la misma URL hacen un solo canje. Devuelve `returnTo` del `state`, o `"/"`.

- [ ] **Step 1: Write the failing tests:**
  - `env.test.ts`, `"oidcConfig lee issuer y client id en cada llamada"`:
    - Con `vi.stubEnv` de `PUBLIC_OIDC_ISSUER="https://idp.x/realms/r/"` y `PUBLIC_OIDC_CLIENT_ID="ui"`, devuelve `{ issuer: "https://idp.x/realms/r", clientId: "ui" }`.
    - Si se cambia el env y se vuelve a llamar, devuelve el valor nuevo.
    - Si falta una de las dos variables, devuelve `null`.
  - `auth-settings.test.ts`, `"buildSettings usa PKCE por code, callback y vuelta al inicio"`: comprueba `redirect_uri` `"http://localhost:3000/auth/callback"`, `post_logout_redirect_uri` `"http://localhost:3000/"`, `response_type` `"code"`, `scope` `"openid"`, `automaticSilentRenew` `true` y `client_id` `"ui"`, sin campo `client_secret`.
  - `auth-bind.test.ts`, con un `ManagerLike` falso que guarda los callbacks de `events` y un almacén real limpiado entre tests:
    - `"sin usuario guardado queda anonymous"`.
    - `"un usuario guardado entra como authenticated con clave sid"`: `profile: { sub: "u", sid: "s-1" }`.
    - `"un usuario expirado cuenta como sin sesión"`.
    - `"userLoaded con otro token conserva la clave"`.
    - `"silentRenewError borra el usuario"`: `removeUser` se llama una vez.
    - `"el renovador devuelve el token nuevo"`.
    - `"si signinSilent falla, el renovador borra y devuelve null"`.
    - `"completeSignIn canjea una sola vez y vuelve a returnTo"`: dos llamadas seguidas ejecutan `signinRedirectCallback` una vez y resuelven a `"/simulador"`.
    - `"completeSignIn sin state vuelve a /"`.
    - `"la función devuelta quita los suscriptores"`.

- [ ] **Step 2: Run** `npm --prefix frontend exec vitest run tests/env.test.ts tests/auth-settings.test.ts tests/auth-bind.test.ts`. Deben fallar.

- [ ] **Step 3: Install** `oidc-client-ts` y comprueba que `npm --prefix frontend ls oidc-client-ts` lo lista. No necesita `allowScripts`. Si npm 12 lo bloquea, apruébalo como `prisma` en el backend.

- [ ] **Step 4: Implement** `env.ts`, `settings.ts` y `bind.ts`.

- [ ] **Step 5: Implement** `auth-provider.tsx` y la página de callback.
  - **Callback:** es un componente cliente. Llama a `completeSignIn` con el manager del contexto y hace `router.replace(returnTo)`.
  - **Error en el callback:** si la URL trae `error`, o el canje lanza, muestra `ErrorBox`/un `<p role="alert">` con `error_description` y un botón «Volver a intentar» que llama a `signIn`.
  - **Layout:** `(console)/layout.tsx` declara `export const dynamic = "force-dynamic"`, lee `oidcConfig()` y envuelve `<Providers>` en `<AuthProvider config={...}>`.

- [ ] **Step 6: Run** los tests (PASS), `npm --prefix frontend run typecheck` y `npm --prefix backend exec vitest run tests/fronteras.test.ts` (sin `keycloak` en `frontend/src`).

- [ ] **Step 7: Commit** con `feat(frontend): login OIDC con PKCE en la consola`.

### Task 5: identidad de clínica o de plataforma

**Files:**
- Regenerate: `frontend/src/platform/**` (`npm --prefix frontend run api:generate`, que produce `getPlatformIdentity`)
- Create: `frontend/src/lib/identity.ts`
- Modify: `frontend/src/lib/use-session.ts` (`useIdentity`)
- Modify (consumidores de la unión):
  - `components/shell/marquee.tsx`
  - `app/(console)/page.tsx`
  - `components/chat/chat-console.tsx`
  - `components/panel/bot-config-screen.tsx`
  - `components/panel/knowledge-board.tsx`
- Test: `frontend/tests/identity.test.ts`

**Interfaces:**
- Consumes: `getIdentity` (cliente `chatbot`) y `getPlatformIdentity` (cliente `platform`).
- Produces:
  - `type SessionIdentity = { kind: "tenant"; subject: string; role: "widget" | "operator" | "admin" | "service"; tenantId: string } | { kind: "platform"; subject: string; role: "platform" }`
  - `resolveIdentity(loadTenant: () => Promise<Identity>, loadPlatform: () => Promise<PlatformIdentity>): Promise<SessionIdentity>`. Hace las dos peticiones en paralelo y gana la de clínica si las dos responden. Si ninguna responde `200`, relanza el error de `loadTenant`.
  - `useIdentity()`: `useQuery<SessionIdentity>` con `queryKey: ["identity", sessionKey]`, `enabled: Boolean(token)`, `retry: false` y `staleTime: 60_000`.

- [ ] **Step 1: Write the failing tests** en `identity.test.ts`:
  - `"un token de clínica resuelve kind tenant"`: `loadTenant` resuelve y `loadPlatform` rechaza con un 403. El resultado es `{ kind: "tenant", tenantId: "t-1", ... }`.
  - `"un token platform resuelve kind platform aunque /api/v1/me dé 403"`.
  - `"si ninguna responde, relanza el error de /api/v1/me"`: los dos rechazan y se lanza el error de clínica, con `status: 401`.
  - `"las dos peticiones salen a la vez"`: las dos funciones se llaman antes de que se resuelva ninguna.

- [ ] **Step 2: Run** `npm --prefix frontend exec vitest run tests/identity.test.ts`. Debe fallar.

- [ ] **Step 3: Implement** `identity.ts` y `useIdentity`. Después ajusta los consumidores:
  - Leen `identity.data?.kind === "tenant"` antes de usar `tenantId`.
  - El chip de `marquee` muestra `platform` sin clínica.
  - `canAdd`, `canWrite` y similares solo valen `true` con `kind === "tenant" && role === "admin"`.

- [ ] **Step 4: Run** los tests (PASS) y `npm --prefix frontend run typecheck`.

- [ ] **Step 5: Commit** con `feat(frontend): identidad de clínica o de plataforma desde /me`.

### Task 6: pantallas sin token pegado

**Files:**
- Modify: `frontend/src/components/shell/session-drawer.tsx`
- Modify: `frontend/src/components/simulador/tenants-panel.tsx`
- Create: `frontend/src/components/shell/platform-notice.tsx`
- Modify: `frontend/src/app/(console)/layout.tsx` (monta `PlatformNotice` bajo `Marquee`)
- Modify (textos con «Pega»):
  - `app/(console)/page.tsx`
  - `components/panel/bot-config-screen.tsx`
  - `components/panel/knowledge-board.tsx`
  - `components/panel/schedules-board.tsx`
  - `components/simulador/inbox-board.tsx`
  - `components/chat/chat-console.tsx`

**Interfaces:**
- Consumes: `useAuthStatus` (tarea 3), `useAuthActions` (tarea 4), `useIdentity`/`SessionIdentity` (tarea 5).

- [ ] **Step 1: Session drawer.** Con `useAuthStatus()`:
  - `unconfigured`: muestra un aviso «Falta configurar el proveedor de identidad (`PUBLIC_OIDC_ISSUER`, `PUBLIC_OIDC_CLIENT_ID`).».
  - `loading`: muestra «Comprobando sesión…».
  - `anonymous`: muestra el botón primario «Iniciar sesión».
  - `authenticated`: muestra los claims y el botón «Cerrar sesión». Con `kind === "tenant"` los claims son `role`, `tenant_id` y `subject`. Con `kind === "platform"` son `role`, `tenant_id` con el texto «(sin clínica)» y `subject`.

  El texto de ayuda dice que el login lo hace el proveedor de identidad, con los usuarios que imprime `npm run idp:lab`.

- [ ] **Step 2: Tenants panel.** Sin campo de token y sin `bearer()`: `createTenant(body, idempotent(...))` ya lleva el token de la sesión (tarea 3).
  - El formulario solo se habilita con `identity.data?.kind === "platform"`.
  - Con otra sesión muestra «El alta de clínicas requiere una sesión `platform` (usuario `platform-lab` del laboratorio).».
  - Sin sesión muestra «Inicia sesión».

- [ ] **Step 3: Platform notice.** Si `identity.data?.kind === "platform"` y `usePathname()` empieza por `/panel` o `/simulador`, muestra una franja `role="status"` con el texto «La sesión `platform` no opera dentro de una clínica: solo da de alta tenants (Simulador → Tenants).». En cualquier otro caso no pinta nada.

- [ ] **Step 4: Textos.** Cambia cada «Pega un token…» por «Inicia sesión en la franja de sesión (tecla 0)…», adaptado a su pantalla. En `chat-console.tsx` queda «Pega una clave o inicia sesión de panel para usar la vigente.». Comprueba con `rg -n "Pega un (JWT|token)" frontend/src`: no debe devolver nada.

- [ ] **Step 5: Run**:
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend test`
  - `npm run ci`
  - `npm run doctor` (100/100)

- [ ] **Step 6: Commit** con `feat(frontend): consola sin tokens pegados`.

### Task 7: documentación, configuración y verificación

**Files:**
- Modify: `frontend/.env.example`
  - `PUBLIC_OIDC_ISSUER=https://keycloak.mangomorado.com/realms/chatbot-lab`
  - `PUBLIC_OIDC_CLIENT_ID=chatbot-reference-ui`
  - un comentario que diga que se leen en runtime
- Modify: `docker-compose.yml`, servicio `frontend`:
  - `PUBLIC_OIDC_ISSUER: ${PUBLIC_OIDC_ISSUER:-}`
  - `PUBLIC_OIDC_CLIENT_ID: ${PUBLIC_OIDC_CLIENT_ID:-chatbot-reference-ui}`
- Modify: `README.md`. Documenta:
  - las variables del frontend
  - que `LAB_FRONTEND_URLS` debe incluir la URL del frontend desplegado (`https://mango-chatbot-hermes-frontend.dxrulh.easypanel.host`) al correr `idp:lab`
  - el usuario `platform-lab`
  - el login de la consola
  - que el `401` tras logout solo se observa contra la API a la que apunta el back-channel

- [ ] **Step 1: Write** la documentación y la configuración de arriba.

- [ ] **Step 2: Run** la batería completa y deja la salida en el informe:
  - `npm run ci`
  - `npm run typecheck`
  - `npm test`
  - `npm run doctor`
  - `npm --prefix backend run test:db`, si Postgres local está en pie (memoria del proyecto: Laragon). Si no lo está, decirlo.

- [ ] **Step 3: Reconfigure the lab.** Corre `npm --prefix backend run idp:lab` con `LAB_FRONTEND_URLS=https://mango-chatbot-hermes-frontend.dxrulh.easypanel.host`. La salida debe listar `platform-lab tenant_id=(sin clínica)`.

- [ ] **Step 4: Manual local**, con `npm --prefix frontend run dev` contra el backend de Easypanel o uno local, pasos 1, 2, 3, 4 y 6 de la §6 de la spec:
  1. `admin-clinica-norte` carga `/panel` y `/simulador`, y la franja muestra rol y clínica.
  2. `operator-clinica-sur` ve solo lo de su clínica.
  3. `platform-lab` da de alta una clínica y ve la franja de `PlatformNotice` en `/panel`.
  4. Tras más de 5 minutos sigue operando y la lista no parpadea.
  6. `/chat` funciona sin login, y con sesión admin propone la clave vigente.

  Anota además el resultado del callback con error: cancelar en la pantalla del proveedor muestra el error y «Volver a intentar».

- [ ] **Step 5: Commit** con `docs: login OIDC de la consola y usuario platform-lab`.

- [ ] **Step 6: Hand off Easypanel to the user.** El frontend se despliega desde `main` y el usuario cierra el merge. Entrégale esta lista:
  1. Añadir `PUBLIC_OIDC_ISSUER` y `PUBLIC_OIDC_CLIENT_ID` al env del frontend.
  2. Pulsar Deploy.
  3. Repetir el paso 4 del recorrido.
  4. Paso 5 de la §6: copiar el access token de `sessionStorage` (clave `oidc.user:<issuer>:chatbot-reference-ui`), cerrar sesión y hacer `curl -H "Authorization: Bearer <token>" https://mango-chatbot-hermes-backend.dxrulh.easypanel.host/api/v1/me`. Esperado: `401`.

  Después de que lo confirme se actualizan `ROADMAP.md` (bloque **Estado**) y `CLAUDE.md` con la 5.2 cerrada.
