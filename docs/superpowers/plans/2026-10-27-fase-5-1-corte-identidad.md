# Fase 5.1 — Corte de identidad: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que toda credencial que acepta la API la emita un proveedor OIDC externo. Se retira el emisor HS256 sin dejar un modo de convivencia.

**Arquitectura:** puertos neutros en `modules/auth/domain` (`TokenVerifier`, `ClientTokenSource`, `ClosedSessions`, `LogoutTokenVerifier`, `MachineCredentialStore`), con adaptadores OIDC/OAuth2 estándar en `modules/auth/infrastructure`. Esos adaptadores usan `jose`, el discovery y `fetch`. Las pruebas no usan red: un proveedor falso en `tests/helpers/idp.ts` sustituye a `globalThis.fetch` en el issuer de pruebas, firma RS256 y responde discovery, JWKS y `client_credentials`. Lo propio de Keycloak solo vive en `backend/scripts/idp-lab/`.

**Stack:** Next.js 16 (App Router), Prisma 7 + Postgres, `jose` 6, Vitest 5, Biome. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-27-fase-5-identidad-oidc-contrato-design.md` (§2–§7, §9 y §11 aplican a la 5.1).

## Restricciones globales

- Corte total: al final de la PR no existen `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `PLATFORM_SECRET`, `token:dev`, `POST /api/platform/v1/tokens`, `TokenIssuer` ni `jose-token-issuer.ts`. No hay flags de compatibilidad.
- Algoritmos admitidos: `RS256` y `ES256`. Nunca `none` ni `HS*`.
- Variables (solo se leen en `config/env.ts`):
  - `OIDC_ISSUER` y `OIDC_AUDIENCE`: obligatorias.
  - `OIDC_TENANT_CLAIM`: por defecto `tenant_id`, con sufijos `[]` / `{}`.
  - `OIDC_ROLES_CLAIM`: por defecto `roles`.
  - `OIDC_ROLE_MAP`: `externo=producto,…`; vacío significa identidad.
  - `OIDC_CLOCK_TOLERANCE_SECONDS`: por defecto `30`.
  - `OIDC_LOGOUT_AUDIENCES`: lista separada por comas; vacía por defecto.
  - `OIDC_MAX_TOKEN_LIFETIME_SECONDS`: por defecto `300`.
  - `CREDENTIALS_ENCRYPTION_KEY`: 32 bytes en base64, obligatoria.
  - `HERMES_SIM_SERVICE_CLIENTS`: JSON, obligatoria solo con `HERMES_SIMULATOR_ENABLED=true`.
- Roles del producto: `widget` · `operator` · `admin` · `service` · `platform`. El rol `platform` no lleva tenant y solo alcanza `/api/platform/v1`.
- Recurso de otro tenant o conversación inalcanzable: `404`, nunca `403`.
- Ningún secreto de cliente sale en respuestas, auditoría ni logs.
- El texto `keycloak` (sin distinguir mayúsculas) no aparece en `backend/src/**` ni en `frontend/src/**`.
- Umbrales del repo: complejidad cognitiva ≤ 15 y ≤ 40 líneas por función, ≤ 400 líneas por archivo, `process.env` solo en `config/env.ts`.
- Si tocas `/api/v1` o `/api/platform/v1`: `npm --prefix backend run openapi:generate` y regenerar orval en `frontend/` en la misma tarea. `contrato-api` en verde.

## Decisiones de este plan (revisables por el usuario)

1. **Replay de la apertura del widget (spec §6.1.7):** la respuesta idempotente guarda `{ session_id, sealed_secret }`, con el `conversation_secret` sellado por `SecretBox`. El replay lo abre y devuelve el mismo secreto junto con un token nuevo.
2. **Sujeto del widget:** el `sub` del token es el mismo para todas las conversaciones de una clínica. Por eso, tras resolver la conversación, las rutas del widget sustituyen `actor.subject` por `widget:<sessionId>`. Así siguen igual la auditoría y el ámbito de idempotencia por sesión.
3. **`requireSession` / `reachesSession` se eliminan.** La búsqueda por hash dentro del tenant del token ya prueba la conversación (spec §6.1.5).
4. **Errores nuevos:**
   - `widget_not_configured` (409): la clínica no tiene credenciales de widget.
   - `identity_unavailable` (503): el proveedor no responde o rechaza las credenciales de un cliente máquina.
   - `invalid_request` (400): `logout_token` inválido, porque OIDC exige 400.
5. **Comodín `"*"` en `HERMES_SIM_SERVICE_CLIENTS`:** `{"*": {"client_id": "service-{tenant}", "client_secret": "…"}}` vale para cualquier tenant que no tenga entrada propia. Lo usan el laboratorio (todos los `service-*` comparten secreto) y las suites, cuyos tenants se crean al vuelo.
6. **Sesiones antiguas:** `widget_sessions.secret_hash` es *nullable*. Las sesiones creadas antes del corte quedan inalcanzables y vencen solas. No hay migración destructiva.
7. **Back-channel logout sin `Idempotency-Key`:** cerrar un `sid` es idempotente por naturaleza (upsert con `GREATEST`). Se documenta como excepción en GOBERNANZA.
8. **Token `platform` con claim de tenant:** se ignora el tenant, no se rechaza.
9. **Mientras la PR está abierta, el frontend de referencia pega tokens:** el panel de tenants del simulador pide un bearer `platform` y pierde el botón «adoptar», que emitía un token admin. El login OIDC llega en la 5.2.

## Foco de revisión

- **Un `Origin` distinto al de la sesión en `refresh`** (ruta pública sin bearer) → `403`, igual que en las rutas con token. Lo prueba la tarea 8.
- **Proveedor caído al abrir sesión de widget:** `503 identity_unavailable` y **ninguna** fila nueva en `widget_sessions`. El token se pide antes de la transacción. Lo prueba la tarea 8.
- **Rotación de credenciales de widget:** tras el `PUT widget-client`, la siguiente apertura usa el `client_id` nuevo y no el token en caché. La clave de la caché incluye la huella del secreto. Lo prueban las tareas 4 y 6.
- **Dos rutas de claim que llevan a valores no string** (número, `null`, objeto en `tenant_id`) → `401`, sin `500`. Lo prueba la tarea 3.
- **`X-Conversation-Secret` válido de la clínica A con token de la clínica B** → `404`. Lo prueba la tarea 8.

---

### Tarea 1: Configuración OIDC y proveedor falso de pruebas

**Archivos:**
- Modificar: `backend/src/config/env.ts` (añade el bloque `oidc`, `credentialsEncryptionKey` y `simServiceClients`; **conserva** `jwt` y `platformSecret` hasta la tarea 10)
- Crear: `backend/tests/helpers/idp.ts`
- Modificar: `backend/tests/setup-env.ts`
- Prueba: `backend/tests/config-oidc.test.ts`, `backend/tests/idp-falso.test.ts`

**Interfaces:**
- Produce:
  - `type ClaimPath = { readonly segments: readonly string[]; readonly pick: "value" | "single-element" | "single-key" }`, exportado de `src/config/env.ts`.
  - `AppConfig.oidc: { issuer: string; audience: string; tenantClaim: ClaimPath; rolesClaim: readonly string[]; roleMap: ReadonlyMap<string, Role>; clockToleranceSeconds: number; logoutAudiences: readonly string[]; maxTokenLifetimeSeconds: number }`.
  - `AppConfig.credentialsEncryptionKey: Uint8Array` (32 bytes).
  - `AppConfig.simServiceClients: ReadonlyMap<string, { clientId: string; clientSecret: string }>`. Vacío si el simulador está apagado. La clave `"*"` es el comodín y `{tenant}` se sustituye en `clientId`.
  - En `tests/helpers/idp.ts`:
    - `TEST_OIDC = { issuer: "https://idp.test/realms/chatbot-test", audience: "chatbot-api", logoutAudience: "chatbot-reference-ui" }`.
    - `TEST_CLIENT_SECRET = "test-client-secret"`.
    - `signToken(options: { role?: string; roles?: unknown; tenantId?: unknown; subject?: string; sid?: string; expiresIn?: string; issuer?: string; audience?: string; alg?: "RS256" | "ES256" | "HS256"; foreignKey?: boolean; extra?: Record<string, unknown> }): Promise<string>`. Por defecto emite `roles: [role]`, `tenant_id`, `sub` `"usuario-de-prueba"` y 5 min de vida.
    - `signLogoutToken(options: { sid?: string; audience?: string; events?: unknown; nonce?: string; issuer?: string }): Promise<string>`.
    - `installFakeIdp(): void`.
    - `fakeIdpCalls(): readonly { url: string; clientId?: string }[]` y `resetFakeIdp(): void`.
    - `setFakeIdpDown(down: boolean): void`.
  - `authorized` y `authedRequest` se mueven tal cual de `tests/helpers/token.ts` a `idp.ts`. `token.ts` se queda hasta la tarea 10.

- [ ] **Paso 1: Escribe las pruebas que fallan**

`tests/config-oidc.test.ts` (patrón de `tests/fhir/config.test.ts`: guarda y restaura `process.env`, llama a `loadConfig()`):

```ts
it("sin OIDC_ISSUER no arranca", () => expect(() => load({ OIDC_ISSUER: undefined })).toThrow(/OIDC_ISSUER/));
it("tenant claim con puntos y sufijos", () => {
  expect(load({ OIDC_TENANT_CLAIM: "org.tenant_id" }).oidc.tenantClaim).toEqual({ segments: ["org", "tenant_id"], pick: "value" });
  expect(load({ OIDC_TENANT_CLAIM: "organization[]" }).oidc.tenantClaim).toEqual({ segments: ["organization"], pick: "single-element" });
  expect(load({ OIDC_TENANT_CLAIM: "organization{}" }).oidc.tenantClaim).toEqual({ segments: ["organization"], pick: "single-key" });
});
it("un sufijo en medio de la ruta es invalido", () => expect(() => load({ OIDC_TENANT_CLAIM: "a[].b" })).toThrow(/OIDC_TENANT_CLAIM/));
it("OIDC_ROLE_MAP mapea a roles del producto", () =>
  expect([...load({ OIDC_ROLE_MAP: "clinic-staff=operator,clinic-admin=admin" }).oidc.roleMap]).toEqual([["clinic-staff", "operator"], ["clinic-admin", "admin"]]));
it("OIDC_ROLE_MAP con rol desconocido no arranca", () => expect(() => load({ OIDC_ROLE_MAP: "x=root" })).toThrow(/OIDC_ROLE_MAP/));
it("CREDENTIALS_ENCRYPTION_KEY exige 32 bytes", () => expect(() => load({ CREDENTIALS_ENCRYPTION_KEY: "AQID" })).toThrow(/32 bytes/));
it("con simulador encendido exige HERMES_SIM_SERVICE_CLIENTS", () =>
  expect(() => load({ HERMES_SIMULATOR_ENABLED: "true", FHIR_GATEWAY: "handlers", HERMES_SIM_SERVICE_CLIENTS: undefined })).toThrow(/HERMES_SIM_SERVICE_CLIENTS/));
it("defaults", () => expect(load({}).oidc).toMatchObject({ rolesClaim: ["roles"], clockToleranceSeconds: 30, logoutAudiences: [], maxTokenLifetimeSeconds: 300 }));
```

`tests/idp-falso.test.ts`:

```ts
it("discovery y JWKS responden en el issuer de pruebas", async () => {
  const d = await (await fetch(`${TEST_OIDC.issuer}/.well-known/openid-configuration`)).json();
  expect(d.issuer).toBe(TEST_OIDC.issuer);
  expect((await (await fetch(d.jwks_uri)).json()).keys).toHaveLength(2); // RS256 y ES256
});
it("client_credentials emite roles y tenant por convención de client_id", async () => {
  const body = await clientCredentials("widget-tenant-a", TEST_CLIENT_SECRET);
  const payload = decodeJwt(body.access_token);
  expect(payload).toMatchObject({ roles: ["widget"], tenant_id: "tenant-a", aud: "chatbot-api", iss: TEST_OIDC.issuer });
  expect(payload.sid).toBeUndefined();
  expect(body.expires_in).toBe(300);
});
it("secreto erróneo → 401 invalid_client", async () => expect((await rawClientCredentials("service-x", "mal")).status).toBe(401));
it("caído → fetch rechaza", async () => { setFakeIdpDown(true); await expect(fetch(`${TEST_OIDC.issuer}/.well-known/openid-configuration`)).rejects.toThrow(); setFakeIdpDown(false); });
```

- [ ] **Paso 2: Ejecútalas y comprueba que fallan**

Ejecuta `npm --prefix backend exec vitest run tests/config-oidc.test.ts tests/idp-falso.test.ts`. Resultado esperado: FAIL (no existen `oidc` ni `helpers/idp`).

- [ ] **Paso 3: Implementa el parseo en `env.ts` y el proveedor falso**

- **Formato de `HERMES_SIM_SERVICE_CLIENTS`:** `{ "<tenantId>|*": { "client_id": string, "client_secret": string } }`.
- **Rutas del proveedor falso (`installFakeIdp`):** envuelve `globalThis.fetch`, atiende las URLs que empiezan por `TEST_OIDC.issuer` y delega el resto.
  - `/.well-known/openid-configuration` → `{ issuer, jwks_uri: issuer+"/protocol/openid-connect/certs", token_endpoint: issuer+"/protocol/openid-connect/token" }`.
  - El JWKS publica una clave RS256 (`kid: "rs"`) y otra ES256 (`kid: "es"`), generadas con `generateKeyPair` al cargar el módulo (top-level await).
  - `token`: acepta `grant_type=client_credentials` con autenticación Basic. El secreto debe ser `TEST_CLIENT_SECRET`.
- **Claims según `client_id`:**
  - `platform-client` → `roles: ["platform"]`.
  - `widget-<t>` → `roles: ["widget"], tenant_id: t`.
  - `service-<t>` → `roles: ["service"], tenant_id: t`.
  - En todos los casos: `sub: "service-account-<client_id>"` y `expires_in: 300`.
- **Opciones de prueba:**
  - `foreignKey: true` firma con una clave que no está en el JWKS.
  - `alg: "HS256"` firma con un secreto compartido.
- **`setup-env.ts`:**
  - Añade `OIDC_ISSUER` y `OIDC_AUDIENCE` de `TEST_OIDC`.
  - `OIDC_LOGOUT_AUDIENCES=chatbot-reference-ui`.
  - `CREDENTIALS_ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=`.
  - `HERMES_SIM_SERVICE_CLIENTS={"*":{"client_id":"service-{tenant}","client_secret":"test-client-secret"}}`.
  - Llama a `installFakeIdp()`.

- [ ] **Paso 4: Comprueba que pasan**

Ejecuta `npm --prefix backend exec vitest run tests/config-oidc.test.ts tests/idp-falso.test.ts` y después `npm --prefix backend test`. Resultado esperado: PASS; el resto de suites sigue en verde.

- [ ] **Paso 5: Commit**

`git add backend/src/config/env.ts backend/tests/helpers/idp.ts backend/tests/setup-env.ts backend/tests/config-oidc.test.ts backend/tests/idp-falso.test.ts && git commit -m "test(auth): proveedor OIDC falso y configuracion OIDC"`

---

### Tarea 2: `SecretBox` (AES-256-GCM)

**Archivos:**
- Crear: `backend/src/modules/shared/domain/ports/secret-box.ts`, `backend/src/modules/shared/infrastructure/aes-gcm-secret-box.ts`
- Prueba: `backend/tests/secret-box.test.ts`

**Interfaces:**
- Produce:
  - `type SecretBox = { seal(plain: string): string; open(sealed: string): string }`.
  - `createAesGcmSecretBox(key: Uint8Array): SecretBox`. El formato es `v1.<base64url(iv12)>.<base64url(ciphertext||tag16)>`.
  - `open` lanza `Error("Secreto sellado invalido")` ante formato, clave o manipulación incorrectos.

- [ ] **Paso 1: Escribe las pruebas que fallan**

```ts
it("ida y vuelta", () => expect(box.open(box.seal("s3cr3t"))).toBe("s3cr3t"));
it("dos sellos del mismo texto difieren (iv aleatorio)", () => expect(box.seal("a")).not.toBe(box.seal("a")));
it("clave errónea falla", () => expect(() => otherBox.open(box.seal("a"))).toThrow("Secreto sellado invalido"));
it("manipulación detectada", () => { const s = box.seal("a"); expect(() => box.open(flipLastChar(s))).toThrow("Secreto sellado invalido"); });
it("el sello no contiene el texto", () => expect(box.seal("visible-text")).not.toContain("visible-text"));
it("clave de longitud distinta de 32 lanza al crear", () => expect(() => createAesGcmSecretBox(new Uint8Array(16))).toThrow());
```

- [ ] **Paso 2: Ejecútalas y comprueba que fallan:** `npm --prefix backend exec vitest run tests/secret-box.test.ts`. Resultado esperado: FAIL.
- [ ] **Paso 3: Implementa** con `node:crypto` (`createCipheriv("aes-256-gcm")`, `randomBytes(12)`).
- [ ] **Paso 4: Comprueba que pasan:** el mismo comando. Resultado esperado: PASS.
- [ ] **Paso 5: Commit:** `feat(shared): SecretBox AES-256-GCM`

---

### Tarea 3: Mapper de claims, discovery y verificador OIDC (sin cablear)

**Archivos:**
- Crear: `backend/src/modules/auth/infrastructure/claims-mapper.ts`, `oidc-discovery.ts`, `oidc-token-verifier.ts`
- Modificar: `backend/src/modules/auth/domain/role.ts` (añade `platform` y `TenantRole`), `backend/src/modules/auth/domain/ports/token-verifier.ts`
- Crear: `backend/src/modules/auth/domain/ports/logout-token-verifier.ts`
- Prueba: `backend/tests/claims-mapper.test.ts`, `backend/tests/oidc-verificador.test.ts`

**Interfaces:**
- Consume: `AppConfig.oidc` y `ClaimPath` de la tarea 1, y el proveedor falso.
- Produce:
  - `ROLES = ["widget","operator","admin","service","platform"]` y `type TenantRole = Exclude<Role, "platform">`.
  - `type TokenClaims = { subject: string; role: Role; tenantId: string | null; providerSessionId?: string }`. `tenantId` es `null` solo si `role === "platform"`. **Durante esta tarea** `sessionId?: string` sigue en el tipo; se borra en la tarea 5.
  - `mapClaims(payload: Record<string, unknown>, settings: Pick<AppConfig["oidc"], "tenantClaim" | "rolesClaim" | "roleMap">): TokenClaims`. Lanza `Error` si el token es inválido.
  - `type OidcDiscovery = { jwksUri: string; tokenEndpoint: string }`.
  - `createOidcDiscovery(issuer: string, fetchFn?: typeof fetch): () => Promise<OidcDiscovery>`. Memoiza y, si falla, se reinicia para reintentar en la siguiente llamada. Exige que el `issuer` del documento sea igual al configurado.
  - `createOidcTokenVerifier(settings: AppConfig["oidc"], discovery: () => Promise<OidcDiscovery>): TokenVerifier & LogoutTokenVerifier`.
  - `type LogoutTokenVerifier = { verifyLogout(token: string): Promise<{ providerSessionId: string }> }`.

- [ ] **Paso 1: Escribe las pruebas que fallan**

`claims-mapper.test.ts` (puro, sin red):

```ts
const base = { tenantClaim: { segments: ["tenant_id"], pick: "value" }, rolesClaim: ["roles"], roleMap: new Map() };
it("contrato por defecto", () => expect(mapClaims({ sub: "u", tenant_id: "t", roles: ["operator"], sid: "s1" }, base)).toEqual({ subject: "u", role: "operator", tenantId: "t", providerSessionId: "s1" }));
it("ignora roles desconocidos", () => expect(mapClaims({ sub: "u", tenant_id: "t", roles: ["offline_access", "default-roles-x", "admin"] }, base).role).toBe("admin"));
it("cero roles → error", () => expect(() => mapClaims({ sub: "u", tenant_id: "t", roles: ["x"] }, base)).toThrow());
it("dos roles → error", () => expect(() => mapClaims({ sub: "u", tenant_id: "t", roles: ["admin", "operator"] }, base)).toThrow());
it("role map", () => expect(mapClaims({ sub: "u", tenant_id: "t", roles: ["clinic-staff"] }, { ...base, roleMap: new Map([["clinic-staff", "operator"]]) }).role).toBe("operator"));
it("ruta anidada de roles", () => expect(mapClaims({ sub: "u", tenant_id: "t", realm_access: { roles: ["service"] } }, { ...base, rolesClaim: ["realm_access", "roles"] }).role).toBe("service"));
it.each([[123], [null], [{}], [""], [undefined]])("tenant no string (%j) → error", (v) => expect(() => mapClaims({ sub: "u", tenant_id: v, roles: ["admin"] }, base)).toThrow());
it("single-element", () => expect(mapClaims({ sub: "u", organization: ["clinica-x"], roles: ["admin"] }, { ...base, tenantClaim: { segments: ["organization"], pick: "single-element" } }).tenantId).toBe("clinica-x"));
it.each([[[]], [["a", "b"]], [[1]]])("single-element inválido %j", (v) => expect(() => mapClaims({ sub: "u", organization: v, roles: ["admin"] }, { ...base, tenantClaim: { segments: ["organization"], pick: "single-element" } })).toThrow());
it("single-key", () => expect(mapClaims({ sub: "u", organization: { "clinica-x": { id: "9" } }, roles: ["admin"] }, { ...base, tenantClaim: { segments: ["organization"], pick: "single-key" } }).tenantId).toBe("clinica-x"));
it.each([[{}], [{ a: 1, b: 2 }], [["a"]]])("single-key inválido %j", (v) => expect(() => mapClaims({ sub: "u", organization: v, roles: ["admin"] }, { ...base, tenantClaim: { segments: ["organization"], pick: "single-key" } })).toThrow());
it("platform sin tenant", () => expect(mapClaims({ sub: "p", roles: ["platform"] }, base)).toEqual({ subject: "p", role: "platform", tenantId: null }));
it("platform con tenant lo ignora", () => expect(mapClaims({ sub: "p", tenant_id: "t", roles: ["platform"] }, base).tenantId).toBeNull());
it("sin sub → error", () => expect(() => mapClaims({ tenant_id: "t", roles: ["admin"] }, base)).toThrow());
```

`oidc-verificador.test.ts` (con el proveedor falso):

```ts
it("acepta RS256 y ES256 válidos", async () => { /* signToken({role:"admin",tenantId:"t"}) y alg ES256 → verify ok */ });
it.each([
  ["firma con clave ajena", { foreignKey: true }],
  ["HS256", { alg: "HS256" }],
  ["emisor ajeno", { issuer: "https://otro" }],
  ["audiencia ajena", { audience: "otra" }],
  ["expirado más allá de la tolerancia", { expiresIn: "-31s" }],
])("rechaza %s", async (_, opts) => await expect(verifier.verify(await signToken({ role: "admin", tenantId: "t", ...opts }))).rejects.toThrow());
it("expirado dentro de la tolerancia pasa", async () => expect((await verifier.verify(await signToken({ role: "admin", tenantId: "t", expiresIn: "-10s" }))).role).toBe("admin"));
it("proveedor caído → rechaza", async () => { setFakeIdpDown(true); await expect(verifier.verify(await signToken({ role: "admin", tenantId: "t" }))).rejects.toThrow(); setFakeIdpDown(false); });
it("logout token válido devuelve sid", async () => expect(await verifier.verifyLogout(await signLogoutToken({ sid: "s1" }))).toEqual({ providerSessionId: "s1" }));
it.each([
  ["sin evento", { events: {} }], ["con nonce", { nonce: "n" }], ["sin sid", { sid: undefined }],
  ["audiencia no listada", { audience: "chatbot-api" }],
])("logout rechaza %s", async (_, opts) => await expect(verifier.verifyLogout(await signLogoutToken({ sid: "s1", ...opts }))).rejects.toThrow());
```

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.** Resultado esperado: FAIL.
- [ ] **Paso 3: Implementa**
  - `verify`: `jwtVerify(token, createRemoteJWKSet(new URL(jwksUri)), { issuer, audience, algorithms: ["RS256","ES256"], clockTolerance })` y después `mapClaims`. El JWKS remoto se crea una vez, cuando el discovery resuelve.
  - `verifyLogout`: mismas claves e issuer, con `audience: logoutAudiences`. Exige `events["http://schemas.openid.net/event/backchannel-logout"]` como objeto, que no haya `nonce` y que `sid` sea un string no vacío.
  - Ningún archivo nombra a Keycloak.
- [ ] **Paso 4: Comprueba que pasan:** `npm --prefix backend test`. Resultado esperado: PASS.
- [ ] **Paso 5: Commit:** `feat(auth): verificador OIDC y mapper de claims configurable`

---

### Tarea 4: Credenciales de clientes máquina, `ClientTokenSource` y sesiones cerradas (sin cablear)

**Archivos:**
- Modificar: `backend/prisma/schema.prisma`. Añade los modelos `MachineCredential` (`machine_credentials`: `tenant_id`, `kind`, `client_id`, `secret_sealed`, `created_at`, `updated_at`; `@@id([tenantId, kind])`; FK a `Tenant`) y `ClosedProviderSession` (`closed_provider_sessions`: `sid` PK, `closed_until timestamptz(3)`).
- Crear: migración `backend/prisma/migrations/<ts>_fase5_1_identidad/` (la genera `prisma migrate dev --name fase5_1_identidad`). En la misma migración, `widget_sessions.secret_hash TEXT NULL UNIQUE`.
- Crear en `backend/src/modules/auth/domain/ports/`: `client-token-source.ts`, `machine-credentials.ts`, `closed-sessions.ts`
- Crear en `backend/src/modules/auth/domain/`: `machine-credential-error.ts`
- Crear en `backend/src/modules/auth/infrastructure/`: `oidc-client-credentials.ts`, `prisma-machine-credential-store.ts`, `prisma-closed-sessions.ts`
- Prueba: `backend/tests/client-credentials.test.ts`, `backend/tests/db/credenciales-maquina.test.ts`

**Interfaces:**
- Consume: `SecretBox` (tarea 2) y `OidcDiscovery` (tarea 3).
- Produce:
  - `type MachineCredentialRef = { readonly kind: "widget" | "service"; readonly tenantId: string }`.
  - `type ClientToken = { readonly accessToken: string; readonly expiresAt: Date }`.
  - `type ClientTokenSource = { tokenFor(ref: MachineCredentialRef): Promise<ClientToken> }`.
  - `type MachineCredential = { clientId: string; clientSecret: string }` y `type MachineCredentialResolver = (ref: MachineCredentialRef) => Promise<MachineCredential | null>`.
  - `type MachineCredentialStore = { put(tenantId: TenantId, kind: "widget", credential: MachineCredential, now: Date): Promise<void>; get(tenantId: TenantId, kind: "widget"): Promise<MachineCredential | null> }`.
  - `class MachineCredentialMissingError extends Error { kind }` e `class IdentityUnavailableError extends Error`.
  - `createOidcClientCredentials(deps: { discovery; resolve: MachineCredentialResolver; clock: Clock; fetchFn?: typeof fetch }): ClientTokenSource`.
    - Si `resolve` devuelve `null`, lanza `MachineCredentialMissingError`.
    - Si el endpoint de token responde distinto de 2xx o la red falla, lanza `IdentityUnavailableError`.
    - Caché por `clientId + ":" + sha256(secret)` hasta `expiresAt − 30 s`.
  - `configServiceResolver(clients: AppConfig["simServiceClients"]): MachineCredentialResolver`. Busca primero la entrada exacta y, si no hay, `"*"` con `{tenant}` sustituido.
  - `createPrismaMachineCredentialStore(db: PrismaExecutor, box: SecretBox): MachineCredentialStore`. `put` hace upsert.
  - `type ClosedSessions = { close(providerSessionId: string, until: Date): Promise<void>; isClosed(providerSessionId: string, now: Date): Promise<boolean> }` y `createPrismaClosedSessions(db)`. `close` usa upsert con `GREATEST(closed_until, until)`.

- [ ] **Paso 1: Escribe las pruebas que fallan**

`client-credentials.test.ts` (proveedor falso y reloj mutable):

```ts
it("obtiene token con roles del cliente", async () => { const t = await source.tokenFor({ kind: "service", tenantId: "t1" }); expect(decodeJwt(t.accessToken)).toMatchObject({ roles: ["service"], tenant_id: "t1" }); });
it("cachea hasta expiresAt − 30 s", async () => { await source.tokenFor(ref); await source.tokenFor(ref); expect(tokenCalls()).toBe(1); clock.advance(271_000); await source.tokenFor(ref); expect(tokenCalls()).toBe(2); });
it("rotar el secreto invalida la caché", async () => { /* resolver devuelve otro secreto → nueva llamada */ });
it("sin credenciales → MachineCredentialMissingError", async () => await expect(sourceWith(async () => null).tokenFor(ref)).rejects.toBeInstanceOf(MachineCredentialMissingError));
it("secreto rechazado → IdentityUnavailableError", async () => await expect(sourceWith(async () => ({ clientId: "service-t1", clientSecret: "mal" })).tokenFor(ref)).rejects.toBeInstanceOf(IdentityUnavailableError));
it("proveedor caído → IdentityUnavailableError", async () => { setFakeIdpDown(true); await expect(source.tokenFor(ref)).rejects.toBeInstanceOf(IdentityUnavailableError); setFakeIdpDown(false); });
it("comodín de service", async () => expect(await configServiceResolver(new Map([["*", { clientId: "service-{tenant}", clientSecret: "s" }]]))({ kind: "service", tenantId: "t9" })).toEqual({ clientId: "service-t9", clientSecret: "s" }));
it("widget nunca se resuelve desde config", async () => expect(await configServiceResolver(map)({ kind: "widget", tenantId: "t9" })).toBeNull());
```

`db/credenciales-maquina.test.ts`:

```ts
it("put/get con secreto sellado en base", async () => { await store.put(t, "widget", { clientId: "widget-a", clientSecret: "abc" }, now); const row = await prisma.machineCredential.findFirstOrThrow(); expect(row.secretSealed).not.toContain("abc"); expect(await store.get(t, "widget")).toEqual({ clientId: "widget-a", clientSecret: "abc" }); });
it("put reemplaza", async () => { /* segundo put con otro client_id → get devuelve el nuevo */ });
it("otro tenant no ve la credencial", async () => expect(await store.get(other, "widget")).toBeNull());
it("closed sessions: cerrado hasta until, luego no", async () => { await closed.close("s1", t0plus5m); expect(await closed.isClosed("s1", t0)).toBe(true); expect(await closed.isClosed("s1", t0plus6m)).toBe(false); });
it("close nunca acorta", async () => { await closed.close("s1", late); await closed.close("s1", early); expect(await closed.isClosed("s1", between)).toBe(true); });
```

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.**
- [ ] **Paso 3: Implementa.** Ejecuta `npm --prefix backend run db:generate` después de la migración. Autenticación en el endpoint de token: HTTP Basic (`client_secret_basic`).
- [ ] **Paso 4: Comprueba que pasan:** `npm --prefix backend test` y `npm --prefix backend run test:db`. Resultado esperado: PASS.
- [ ] **Paso 5: Commit:** `feat(auth): credenciales de clientes maquina y sesiones cerradas`

---

### Tarea 5: Cablear el verificador OIDC y la nueva forma del actor

Desde aquí el verificador ya no acepta HS256. **Suites que quedan en rojo de forma declarada hasta su tarea:** `sesion-widget`, `flujo`, `verificacion`, `cors` y `pre-registro-handoff` (widget, tarea 8), `alta-chatbot` (tarea 6), y `hermes-simulador` y `pre-agenda-bandeja` (tarea 7). Todas las demás tienen que acabar en verde.

**Archivos:**
- Modificar en `backend/src/modules/auth/`: `domain/actor.ts`, `domain/ports/token-verifier.ts` (quita `sessionId`), `application/authenticate.ts` y `application/authorize.ts`
- Modificar en `backend/src/`: `composition-root.ts`, `http/route.ts`, `http/idempotent-route.ts`, `http/fhir-route.ts`, `http/fhir-idempotent-route.ts` y `app/api/v1/me/route.ts` (si narra el actor)
- Modificar: todas las pruebas que importan `signToken` desde `helpers/token`, que pasan a importarlo de `helpers/idp`. Incluye `tests/helpers/fhir.ts`, donde `serviceToken` emite `roles: ["service"]`.
- Prueba: `backend/tests/roles.test.ts` (se reescribe el bloque «emisión de tokens»)

**Interfaces:**
- Consume: `createOidcTokenVerifier` y `createOidcDiscovery` (tarea 3), y `createPrismaClosedSessions` (tarea 4).
- Produce:
  - Tipos de actor:
    - `type Actor = { readonly subject: string; readonly tenantId: TenantId; readonly role: TenantRole }` (sin `sessionId`).
    - `type PlatformActor = { readonly subject: string; readonly role: "platform" }`.
    - `type AuthenticatedActor = Actor | PlatformActor`.
  - `createAuthenticate(deps: { verifier: TokenVerifier; closedSessions: ClosedSessions; clock: Clock }): Authenticate`, con `Authenticate = (header: string | null) => Promise<AuthenticatedActor>`. Un `providerSessionId` cerrado → `unauthorized`.
  - `requireTenantActor(actor: AuthenticatedActor, allowed: readonly TenantRole[]): Actor` y `requirePlatformActor(actor: AuthenticatedActor): PlatformActor`. Ambos lanzan `forbidden`. Sustituyen a `requireRole`. Se borran `requireSession` y `reachesSession`.
  - `privateRoute(allowedRoles: readonly TenantRole[], handler)` e `idempotentRoute(...)` mantienen la firma; el handler recibe `Actor`.
  - `Container.closedSessions: ClosedSessions` y `Container.oidcDiscovery: () => Promise<OidcDiscovery>` (una sola instancia, reutilizada en las tareas 6–9).
  - Mientras tanto, la clave HMAC de `sensitiveBody` en `idempotent-route.ts` sale de `config.credentialsEncryptionKey`: `createHmac("sha256", key).update("idempotency-request-hash")`.

- [ ] **Paso 1: Reescribe `roles.test.ts`**
  - El bloque «roles: ruta autenticada» firma con `helpers/idp` y conserva los casos actuales: 401 sin token, 401 con firma ajena sin revelar la causa, expirado, emisor ajeno, tenant del claim, tenant inyectado ignorado y widget → 403 en dominio.
  - El bloque «emisión de tokens» y los de plataforma se sustituyen por:

```ts
it("platform no alcanza rutas de tenant", async () => expect((await getIdentity(authorized(await signToken({ role: "platform" })))).status).toBe(403));
it("tenant fuera de una ruta FHIR con token platform → 403", async () => expect((await fhirGet("Patient", await signToken({ role: "platform" }))).response.status).toBe(403));
it("sesión del proveedor cerrada → 401", async () => { await container().closedSessions.close("sid-x", inFiveMinutes()); expect((await getIdentity(authorized(await signToken({ role: "admin", tenantId: "t", sid: "sid-x" })))).status).toBe(401); });
it("token sin sid se acepta", async () => expect((await getIdentity(authorized(await signToken({ role: "admin", tenantId: "t" })))).status).toBe(200));
it("cero o dos roles → 401", async () => expect((await getIdentity(authorized(await signToken({ roles: ["admin", "operator"], tenantId: "t" })))).status).toBe(401));
```

Los casos de sesión cerrada van en una suite `db` si `closedSessions` necesita Postgres: `tests/db/sesion-cerrada.test.ts`.

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.**
- [ ] **Paso 3: Implementa.** El composition root crea el verificador con `config.oidc` y el discovery compartido. En `authenticate`, `isClosed` va **fuera** del `try` que convierte los fallos en 401: una base caída da 500, no 401.
- [ ] **Paso 4: Comprueba:** `npm --prefix backend run typecheck`, `npm --prefix backend test` y `npm --prefix backend run test:db`. Resultado esperado: verde salvo las suites declaradas.
- [ ] **Paso 5: Commit:** `feat(auth): verificador OIDC cableado y actor platform`

---

### Tarea 6: Plataforma por rol `platform` y credenciales de widget

**Archivos:**
- Modificar: `backend/src/http/platform-route.ts` (`requirePlatform` por secreto → `authenticate` + `requirePlatformActor`; el handler recibe `actor: PlatformActor`)
- Modificar en `backend/src/modules/platform/`: `application/register-tenant.ts`, `domain/tenant-registration.ts` y `domain/platform-actor.ts` (se elimina `PLATFORM_AUDIT_ACTOR`)
- Crear: `backend/src/modules/platform/application/set-widget-client.ts` y `backend/src/modules/platform/domain/widget-client.ts`
- Crear: `backend/src/app/api/platform/v1/tenants/[id]/widget-client/route.ts`
- Borrar: `backend/src/app/api/platform/v1/tokens/route.ts` y `backend/src/modules/platform/application/issue-token.ts`, `domain/token-request.ts`
- Modificar: `backend/src/composition/platform-wiring.ts`, `backend/src/http/openapi-platform.ts`, `backend/src/http/serializers-chatbot.ts` y `backend/src/http/error-codes.ts`. En `errors.ts`: `MachineCredentialMissingError` → `widget_not_configured` 409 e `IdentityUnavailableError` → `identity_unavailable` 503. También se añade `invalid_request` 400, que se usa en la tarea 9.
- Frontend: regenerar el cliente `platform` con orval. En `frontend/src/components/simulador/tenants-panel.tsx`, el campo «secreto» pasa a «token de plataforma» y se quitan `adopt` y `issueToken`. En `frontend/src/lib/api-fetcher.ts`, actualizar el comentario de `platformFetcher`.
- Prueba: `backend/tests/db/alta-chatbot.test.ts` (se reescribe) y `backend/tests/dominio/plataforma.test.ts`

**Interfaces:**
- Consume: `MachineCredentialStore` (tarea 4) y `requirePlatformActor` (tarea 5).
- Produce:
  - `parseWidgetClient(raw: unknown): MachineCredential`. Exige `client_id` y `client_secret` no vacíos, de 200 caracteres como máximo. Si falla, lanza `ValidationError` con `field`.
  - `createSetWidgetClient(deps: { registry; credentials: MachineCredentialStore; audit; clock }): (input: { tenantId: string; raw: unknown; actor: PlatformActor; requestId: string }) => Promise<{ clientId: string; updatedAt: Date }>`. Tenant inexistente → `NotFoundError`. Audita `widget_client.set` con `resourceId = clientId` y nunca el secreto.
  - `RegisterTenant` recibe `actor: PlatformActor`. El cuerpo admite `widget_client?: { client_id, client_secret }`, que se guarda en la misma transacción. La respuesta añade `widget_client: { client_id } | null`.
  - La auditoría de plataforma usa `actorSubject = actor.subject` y `actorRole = "platform"`.
  - Contrato de `PUT /api/platform/v1/tenants/{id}/widget-client`: cuerpo `{ client_id, client_secret }`, respuesta 200 `{ client_id, updated_at }` y `Idempotency-Key` obligatoria. Con la misma clave y el mismo cuerpo, repite la respuesta.
  - OpenAPI de plataforma: `securitySchemes.platformBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" }` (OAuth2 llega en la 5.3). Se quitan `issueToken` y `TokenRequest`.

- [ ] **Paso 1: Escribe las pruebas que fallan** (`alta-chatbot`):

```ts
it("sin token → 401; token admin de tenant → 403", ...);
it("alta con token platform (client_credentials del proveedor falso) crea tenant, bot-config, KB y clave", ...);
it("alta con widget_client guarda la credencial sellada y responde solo client_id", async () => { expect(body.widget_client).toEqual({ client_id: "widget-x" }); expect(JSON.stringify(body)).not.toContain(TEST_CLIENT_SECRET); });
it("auditoría registra el sub del token platform y no el secreto", async () => { const ev = await prisma.auditEvent.findMany(); expect(ev.map(e => e.actorSubject)).toContain("service-account-platform-client"); expect(JSON.stringify(ev)).not.toContain(TEST_CLIENT_SECRET); });
it("PUT widget-client reemplaza y es idempotente", ...);
it("PUT widget-client de tenant inexistente → 404", ...);
it("PUT widget-client sin Idempotency-Key → 422", ...);
it("/api/platform/v1/tokens ya no existe", () => expect(existsSync(join("src/app/api/platform/v1/tokens/route.ts"))).toBe(false));
```

El token platform de las pruebas se obtiene con `ClientTokenSource`/`fetch` contra el proveedor falso usando `platform-client` + `TEST_CLIENT_SECRET`. Añade a `idp.ts` un helper `platformToken(): Promise<string>`.

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.**
- [ ] **Paso 3: Implementa** y después ejecuta `npm --prefix backend run openapi:generate` y la regeneración de orval en `frontend/`.
- [ ] **Paso 4: Comprueba:** `npm --prefix backend run test:db -- alta-chatbot`, `npm test` (raíz), `npm run typecheck` y `npm run doctor`. Resultado esperado: verde, salvo las suites declaradas en la tarea 5 que aún no se han tratado.
- [ ] **Paso 5: Commit:** `feat(platform): rol platform del proveedor y credenciales de widget`

---

### Tarea 7: Token `service` del simulador por `client_credentials`

**Archivos:**
- Modificar: `backend/src/modules/hermes-simulator/application/service-tokens.ts`. Pasa a `createServiceTokens(source: ClientTokenSource): ServiceTokenIssuer`, con `issue(tenantId)` = `(await source.tokenFor({ kind: "service", tenantId })).accessToken`.
- Modificar: `backend/src/composition/chatbot-requests.ts` y `backend/scripts/hermes-sync.ts`. Crean `createOidcClientCredentials({ discovery, resolve: configServiceResolver(config.simServiceClients), clock: systemClock })`. El composition root comparte la instancia de discovery.
- Prueba: `backend/tests/db/hermes-simulador.test.ts` y `backend/tests/db/pre-agenda-bandeja.test.ts`

- [ ] **Paso 1: Adapta las pruebas.** `hermes-simulador` crea `createServiceTokens` con la fuente del proveedor falso. Añade el caso:

```ts
it("el sujeto auditado de una escritura FHIR es el sub del proveedor", async () => {
  await sync(alpha.tenantId);
  const ev = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: alpha.tenantId, actorRole: "service" } });
  expect(ev.actorSubject).toBe(`service-account-service-${alpha.tenantId}`);
});
```

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.**
- [ ] **Paso 3: Implementa.**
- [ ] **Paso 4: Comprueba:** `npm --prefix backend run test:db -- hermes-simulador pre-agenda-bandeja`. Resultado esperado: PASS.
- [ ] **Paso 5: Commit:** `feat(simulador): token service por client_credentials`

---

### Tarea 8: Sesión del widget por el proveedor con `conversation_secret`

**Archivos:**
- Modificar en `backend/src/modules/widget/`:
  - `domain/widget-session.ts`: `WidgetSession` gana `secretHash: string | null`.
  - `domain/ports/ports.ts`: `WidgetSessionRepository.getBySecretHash(tenantId, hash)` y el puerto `ConversationSecrets`.
  - `application/widget-sessions.ts`: se borra `createIssueSessionToken`.
  - `infrastructure/prisma-widget-session-repository.ts`.
- Crear: `backend/src/modules/widget/infrastructure/crypto-conversation-secrets.ts`
- Modificar: `backend/src/composition/widget-wiring.ts`, `backend/src/http/widget-session-response.ts`, `backend/src/http/cors.ts` (`ALLOW_HEADERS` añade `X-Conversation-Secret`), las cuatro rutas de `backend/src/app/api/v1/widget/**` y `backend/src/http/openapi.ts`
- Frontend: regenerar orval del widget y adaptar `frontend/src/widget/session.ts` y `frontend/src/widget/widget-api.ts`, junto con sus pruebas
- Prueba: `backend/tests/db/sesion-widget.test.ts` (se reescribe), `backend/tests/db/chat-support.ts` y `backend/tests/db/support.ts`. `insertChatbotTenant` guarda la credencial `widget-<tenantId>`/`TEST_CLIENT_SECRET` con `SecretBox`; se añade la opción `{ widgetClient: false }`.

**Interfaces:**
- Consume: `ClientTokenSource` (tarea 4), resolver de widget `(ref) => ref.kind === "widget" ? store.get(ref.tenantId, "widget") : null` y `SecretBox` (tarea 2).
- Produce:
  - `type ConversationSecrets = { generate(): string; hash(secret: string): string }`. Genera 32 bytes aleatorios en base64url; el hash es sha256 en hex.
  - `createStartWidgetSession` devuelve `{ session: WidgetSession; conversationSecret: string }` y guarda solo el hash.
  - `createFindWidgetSessionBySecret(deps: { sessions; secrets; clock }): (tenantId: TenantId, secret: string) => Promise<WidgetSession>`. Si no existe o está vencida, lanza `NotFoundError`.
  - `Container.widgetTokenFor(tenantId: TenantId): Promise<ClientToken>`.
  - `CONVERSATION_SECRET_HEADER = "X-Conversation-Secret"`, en `widget-session-response.ts`.
  - `resolveWidgetConversation(actor: Actor, request: Request): Promise<{ session: WidgetSession; actor: Actor }>`.
    - Lee la cabecera; si falta, `NotFoundError`.
    - Busca dentro de `actor.tenantId` y aplica `assertSessionOrigin`.
    - Devuelve el actor con `subject = sessionSubject(session.id)`.
  - Contrato:
    - `POST /api/v1/widget/sessions` → 201 `{ access_token, expires_at, conversation_secret, session_expires_at }`.
    - `POST /api/v1/widget/sessions/refresh` es pública. Recibe el cuerpo `{ widget_key }` y las cabeceras `X-Conversation-Secret`, `Origin` e `Idempotency-Key`, y responde 200 `{ access_token, expires_at, session_expires_at }`.
    - Las rutas de conversación exigen `Authorization` y `X-Conversation-Secret`.

- [ ] **Paso 1: Reescribe `sesion-widget` (casos que fallan)**

```ts
it("apertura devuelve token del proveedor y conversation_secret; en base solo el hash", async () => {
  const body = await (await open(seed.widgetKey)).json();
  expect(decodeJwt(body.access_token)).toMatchObject({ roles: ["widget"], tenant_id: seed.tenantId });
  const row = await prisma.widgetSession.findFirstOrThrow();
  expect(row.secretHash).toBe(sha256hex(body.conversation_secret));
  expect(JSON.stringify(row)).not.toContain(body.conversation_secret);
});
it("clínica sin credenciales → 409 widget_not_configured y sin sesión creada", ...);
it("proveedor caído → 503 identity_unavailable y sin sesión creada", ...);
it("replay de la apertura devuelve el mismo conversation_secret y un token válido", ...);
it("la respuesta idempotente guardada no contiene el secreto en claro", async () => expect(JSON.stringify(await prisma.idempotencyKey.findMany())).not.toContain(body.conversation_secret));
it("conversación sin X-Conversation-Secret → 404", ...);
it("secreto de la clínica A con token de la clínica B → 404", ...);
it("token de widget sin secreto no alcanza la conversación de otro paciente de la misma clínica", ...);
it("refresh sin bearer con secreto + clave + origen extiende la sesión y da token nuevo", ...);
it("refresh con Origin distinto → 403", ...);
it("refresh con secreto vencido o desconocido → 404", ...);
it("refresh respeta el rate limit de la apertura → 429", ...);
it("auditoría y claves de idempotencia del chat usan widget:<sessionId>", ...);
```

Se conservan los casos actuales de clave inválida, origen, rate limit por IP y longitud mínima de `Idempotency-Key`.

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.**
- [ ] **Paso 3: Implementa**
  - **Apertura:**
    1. `admitWidget`.
    2. `widgetTokenFor(access.tenantId)`, **antes** de `runIdempotent`, para que un fallo del proveedor no cree estado.
    3. `runIdempotent`, que crea la sesión y el secreto y guarda `{ session_id, sealed_secret }`.
    - El `rebuild` busca la sesión activa, abre el secreto y pide un token nuevo.
  - **Refresh:**
    - Lee `widget_key` del cuerpo y llama a `admitWidget` (origen + rate limit).
    - Busca la sesión con `findWidgetSessionBySecret(access.tenantId, secret)` y aplica `assertSessionOrigin`.
    - Ejecuta `runIdempotent` en `tenantScope` con `actorSubject = sessionSubject(id)` y extiende la sesión.
    - El `rebuild` comprueba que el `session_id` guardado coincide con el resuelto (si no, `ConflictError`) y pide un token nuevo.
  - **Conversación:** `privateRoute(["widget"])` + `resolveWidgetConversation`. `messages` usa `idempotentRoute` con `guard` y pasa el actor resuelto al handler (añade a `IdempotentRouteOptions` un `resolveActor?: (actor, request) => Promise<Actor>`, que se aplica antes de leer la clave).
  - **Frontend:**
    - `StoredSession` guarda `{ accessToken, expiresAt, conversationSecret, sessionExpiresAt, obtainedAt }`.
    - `refreshSession(conversationSecret, idempotencyKey)` envía `widget_key` en el cuerpo, sin bearer.
    - Las llamadas de conversación envían ambas cabeceras.
    - Un `401` o `404` de conversación o de refresh → `open()`.
    - Se descarta el formato anterior guardado (`parseStored` devuelve `null`).
- [ ] **Paso 4: Comprueba:** `npm --prefix backend run test:db` (todas, incluidas `flujo`, `verificacion`, `cors` y `pre-registro-handoff`, que vuelven a verde), `npm test`, `npm run typecheck` y `npm run doctor`.
- [ ] **Paso 5: Commit:** `feat(widget): token del proveedor y conversation_secret`

---

### Tarea 9: Back-channel logout

**Archivos:**
- Crear: `backend/src/modules/auth/application/close-provider-session.ts` y `backend/src/app/api/v1/auth/backchannel-logout/route.ts`
- Modificar: `backend/src/composition-root.ts` (`Container.closeProviderSession`) y `backend/src/http/openapi.ts`
- Prueba: `backend/tests/db/backchannel-logout.test.ts`

**Interfaces:**
- Consume: `LogoutTokenVerifier` (tarea 3) y `ClosedSessions` (tarea 4).
- Produce: `createCloseProviderSession(deps: { verifier: LogoutTokenVerifier; closedSessions: ClosedSessions; clock: Clock; maxTokenLifetimeSeconds: number }): (logoutToken: unknown) => Promise<void>`.
  - Un token ausente o inválido → `InvalidRequestError` (400 `invalid_request`).
  - Si es válido → `close(sid, now + maxTokenLifetimeSeconds)`.
  - Ruta: `publicRoute`. Lee `application/x-www-form-urlencoded` con `request.formData()`. Éxito → 200 `{}`, con `Cache-Control: no-store`.

- [ ] **Paso 1: Escribe las pruebas que fallan**

```ts
it("logout válido → 200 y el bearer con ese sid pasa a 401", async () => {
  const bearer = await signToken({ role: "operator", tenantId: t, sid: "sid-1" });
  expect((await getIdentity(authorized(bearer))).status).toBe(200);
  expect((await logout(await signLogoutToken({ sid: "sid-1" }))).status).toBe(200);
  expect((await getIdentity(authorized(bearer))).status).toBe(401);
});
it("otro sid sigue vivo", ...);
it("tras maxTokenLifetime el cierre caduca", ...);
it.each(["sin logout_token", "audiencia chatbot-api", "con nonce", "firma ajena"])("%s → 400 invalid_request", ...);
it("repetir el mismo logout es inocuo → 200", ...);
```

- [ ] **Paso 2: Ejecútalas y comprueba que fallan.**
- [ ] **Paso 3: Implementa** y ejecuta `openapi:generate` (requestBody `application/x-www-form-urlencoded`, `security: []`).
- [ ] **Paso 4: Comprueba:** `npm --prefix backend run test:db -- backchannel-logout` y `npm --prefix backend test` (`contrato-api`).
- [ ] **Paso 5: Commit:** `feat(auth): back-channel logout OIDC`

---

### Tarea 10: Retiro del emisor HS256 y regla de agnosticismo

**Archivos:**
- Borrar en `backend/src/modules/auth/`: `domain/ports/token-issuer.ts`, `infrastructure/jose-token-issuer.ts` y `infrastructure/jose-token-verifier.ts`
- Borrar: `backend/scripts/token-dev.ts`, `backend/tests/helpers/token.ts` y el script `token:dev` de `backend/package.json`
- Modificar: `backend/src/config/env.ts` (se quitan `jwt` y `platformSecret`), `backend/tests/setup-env.ts` y `backend/tests/fhir/config.test.ts`
- Modificar: `backend/scripts/demo.ts`. Deja de firmar; tras sembrar, imprime el `tenant_id` y la instrucción «obtén un token del laboratorio (`npm run idp:lab` imprime usuarios y clientes)». Se quitan `--role` y el TTL.
- Modificar: `docker-compose.yml`, `.env.example` y `backend/.env.example` (variables de la sección «Restricciones globales», sin `JWT_*` ni `PLATFORM_SECRET`)
- Modificar: `backend/tests/fronteras.test.ts`

- [ ] **Paso 1: Escribe la prueba que falla** en `fronteras`:

```ts
it("ningun archivo de backend/src ni frontend/src menciona keycloak", () => {
  const roots = [join(process.cwd(), "src"), join(process.cwd(), "..", "frontend", "src")];
  const offenders = roots.flatMap(listAllFiles).filter((f) => /keycloak/i.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
it("no queda emisor de tokens en el backend", () => {
  const offenders = listAllFiles(join(process.cwd(), "src")).filter((f) => /\bSignJWT\b|TokenIssuer\b|JWT_SECRET|PLATFORM_SECRET/.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
```

`listAllFiles` recorre `.ts`, `.tsx`, `.js`, `.json` y `.css`, y omite `node_modules`.

- [ ] **Paso 2: Comprueba que la segunda falla** mientras existan los archivos.
- [ ] **Paso 3: Borra y adapta.** Ejecuta `rg -n "JWT_SECRET|PLATFORM_SECRET|token:dev|jose-token|signToken.*helpers/token"` en todo el repo (salvo `docs/` históricos y `node_modules`). El resultado tiene que salir vacío.
- [ ] **Paso 4: Comprueba:** `npm run ci`, `npm run typecheck`, `npm test`, `npm --prefix backend run test:db` y `npm run doctor`. Resultado esperado: **todo verde**, sin suites declaradas pendientes.
- [ ] **Paso 5: Commit:** `refactor(auth): retira el emisor HS256 y token:dev`

---

### Tarea 11: Script del laboratorio (`backend/scripts/idp-lab/`)

**Archivos:**
- Crear en `backend/scripts/idp-lab/`:
  - `plan.ts`: puro. A partir de los tenants y las URLs devuelve el estado deseado.
  - `admin-client.ts`: `fetch` contra la API de administración.
  - `apply.ts`: reconcilia; si no existe crea y si existe actualiza.
  - `index.ts`: entrada.
- Modificar: `backend/package.json`, script `"idp:lab": "tsx scripts/idp-lab/index.ts"`
- Prueba: `backend/tests/idp-lab-plan.test.ts`

**Interfaces:**
- Entradas (env del script, leídas en `index.ts`; los scripts quedan fuera de la regla de `process.env`, como `demo.ts`):
  - Conexión: `IDP_ADMIN_URL`, `IDP_ADMIN_REALM` (por defecto `master`), `IDP_ADMIN_CLIENT_ID` e `IDP_ADMIN_CLIENT_SECRET`.
  - URLs: `LAB_API_URL` y `LAB_FRONTEND_URLS` (lista con comas; siempre incluye `http://localhost:3000`).
  - Credenciales: `LAB_USER_PASSWORD` y `LAB_SERVICE_SECRET`.
  - `LAB_PUSH_WIDGET_CLIENTS` (por defecto `true`).
- `buildLabPlan(input: { tenants: { id: string; slug: string }[]; apiUrl: string; frontendUrls: string[] }): LabPlan`. Los tenants salen de `seedId("tenant:" + slug)` con los slugs `clinica-norte` y `clinica-sur` de `prisma/seed/data.ts`.
- `LabPlan`:
  - Realm `chatbot-lab` con `accessTokenLifespan: 300`.
  - User Profile con el atributo `tenant_id`.
  - Roles de realm: `widget`, `operator`, `admin`, `service` y `platform`.
  - Client scope `chatbot-contract` (por defecto en todos nuestros clientes) con tres mappers:
    - `oidc-usermodel-realm-role-mapper` → claim `roles`, multivaluado, en el access token.
    - `oidc-usermodel-attribute-mapper` → `tenant_id`.
    - `oidc-audience-mapper` → `chatbot-api`.
  - Clientes:
    - `chatbot-platform`: confidencial, service account con rol `platform`.
    - `widget-<tenantId>` y `service-<tenantId>`: confidenciales, con service account del rol correspondiente y un mapper `oidc-hardcoded-claim-mapper` `tenant_id=<tenantId>`. Los `service-*` usan el secreto `LAB_SERVICE_SECRET`.
    - `chatbot-reference-ui`: público, `pkce.code.challenge.method=S256`, redirects `<url>/*` de `frontendUrls`, `backchannel.logout.url=<apiUrl>/api/v1/auth/backchannel-logout` y `backchannel.logout.session.required=true`.
    - `chatbot-swagger`: público, PKCE, redirect `<apiUrl>/docs/*`.
  - Usuarios `admin-<slug>` y `operator-<slug>`, con el atributo `tenant_id` y el rol.
- Salida de `index.ts`:
  - Imprime `OIDC_ISSUER=<IDP_ADMIN_URL>/realms/chatbot-lab`, `OIDC_AUDIENCE=chatbot-api`, `OIDC_LOGOUT_AUDIENCES=chatbot-reference-ui` y `HERMES_SIM_SERVICE_CLIENTS={"*":{"client_id":"service-{tenant}","client_secret":"<LAB_SERVICE_SECRET>"}}`.
  - Imprime también el `client_id` de `chatbot-platform` con su secreto y los usuarios.
  - Con `LAB_PUSH_WIDGET_CLIENTS=true`, obtiene un token `chatbot-platform` del realm y llama a `PUT <LAB_API_URL>/api/platform/v1/tenants/<id>/widget-client` por tenant, con `Idempotency-Key` `idp-lab:<tenantId>:<sha256(secret)[0..16]>`. Un 404 (tenant aún no sembrado) se informa y no aborta.

- [ ] **Paso 1: Escribe la prueba que falla** (solo `plan.ts`, sin red):

```ts
const plan = buildLabPlan({ tenants: [{ id: "t-n", slug: "clinica-norte" }], apiUrl: "https://api.x", frontendUrls: ["http://localhost:3000"] });
it("un widget y un service por tenant, con claim fijo", () => expect(plan.clients.find(c => c.clientId === "widget-t-n")?.hardcodedTenant).toBe("t-n"));
it("reference-ui público, PKCE y back-channel a la API", () => expect(plan.clients.find(c => c.clientId === "chatbot-reference-ui")).toMatchObject({ public: true, pkce: "S256", backchannelLogoutUrl: "https://api.x/api/v1/auth/backchannel-logout" }));
it("atributo tenant_id declarado en el user profile", () => expect(plan.userProfileAttributes).toContain("tenant_id"));
it("vida de acceso 300 s", () => expect(plan.realm.accessTokenLifespan).toBe(300));
it("usuarios admin y operator por tenant", () => expect(plan.users.map(u => u.username)).toEqual(["admin-clinica-norte", "operator-clinica-norte"]));
```

- [ ] **Paso 2: Ejecútala y comprueba que falla.**
- [ ] **Paso 3: Implementa** `plan.ts`, `admin-client.ts`, `apply.ts` e `index.ts`. `apply` es idempotente: dos ejecuciones seguidas no crean duplicados.
- [ ] **Paso 4: Verificación manual contra `keycloak.mangomorado.com`**
  1. Crea en `master` un cliente admin para el script, o reutiliza credenciales admin que el usuario facilite.
  2. Ejecuta `npm --prefix backend run idp:lab` dos veces. La segunda ejecución no puede crear nada nuevo.
  3. Verifica con el MCP de Keycloak: `chatbot-lab` existe, los clientes y mappers están, y un token `client_credentials` de `widget-<id>` decodifica a `{ roles: ["widget", …], tenant_id, aud ⊇ ["chatbot-api"] }`.
  4. Arranca el backend con las `OIDC_*` impresas y comprueba que `GET /api/v1/me` responde 200 con un token de `admin-clinica-norte` (password grant solo en esta prueba manual, o Postman con PKCE).
- [ ] **Paso 5: Commit:** `feat(idp-lab): script reconstruible del laboratorio OIDC`

---

### Tarea 12: Gobernanza, roadmap y README

**Archivos:**
- Modificar: `GOBERNANZA.md`
  - §1.3: plataforma con rol `platform` del proveedor; no emite tokens.
  - §1.4: token del widget del proveedor, conversación por `conversation_secret`, cinco roles.
  - Regla nueva de agnosticismo del proveedor (el test de `fronteras`).
  - Excepción documentada: back-channel logout sin `Idempotency-Key`.
- Modificar: `ROADMAP.md` §Fase 5. Entregable 5: el `session_id` deja de ser claim. Entregable 7: `token:dev` se elimina. Bloque **Estado**: 5.1 cerrada.
- Modificar: `README.md`
  - Variables nuevas y laboratorio (`npm run idp:lab`).
  - Sección «Integración con Hermes»: emitir el contrato §4 o configurar `OIDC_TENANT_CLAIM`/`OIDC_ROLES_CLAIM`/`OIDC_ROLE_MAP`; crear un cliente de widget por clínica y entregarlo por `PUT …/widget-client`; registrar `<API>/api/v1/auth/backchannel-logout` como back-channel logout de sus clientes interactivos con sesión requerida.
- Modificar: `CLAUDE.md`, sección «Estado actual». Fase 5 abierta y 5.1 cerrada; `token:dev` deja de existir.

- [ ] **Paso 1: Edita.** Sin código.
- [ ] **Paso 2: Comprueba:** `npm run ci` (Biome formatea el markdown si aplica), `npm test` y `npm --prefix backend run test:db`. Resultado esperado: todo verde.
- [ ] **Paso 3: Commit:** `docs: gobernanza, roadmap y README de la Fase 5.1`

---

## Cierre de la 5.1

- Criterios del roadmap 1–6 de la spec §3: suites verdes, verificación manual de la tarea 11 y logout manual con `chatbot-reference-ui`. Este último puede esperar a la 5.2 si hace falta el login PKCE en el navegador; se deja anotado en el PR.
- PR a `main` con resumen y lista de suites. El usuario hace el merge.
