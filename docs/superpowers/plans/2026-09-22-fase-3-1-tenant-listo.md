# Fase 3.1 — Tenant listo para chatear: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar de alta tenants con `bot-config`, base de conocimiento y clave de widget; emitir tokens desde el servidor (plataforma y sesiones de widget) sin persistir credenciales.

**Architecture:** Cuatro módulos hexagonales nuevos (`bot-config`, `knowledge`, `widget`, `platform`) que solo importan `shared` y `auth`; cada uno declara sus puertos y el composition root los cumple con casos de uso del módulo dueño. Tercera superficie HTTP `/api/platform/v1` autenticada con `PLATFORM_SECRET`. El núcleo de idempotencia se extrae a `http/idempotency-core.ts` y lo comparten tenant, plataforma y sesión del widget.

**Tech Stack:** Next.js 16 (route handlers), Prisma 7 + Postgres, `jose` (HS256), Vitest 5 (proyectos `unit` y `db`), Biome 2, orval.

**Spec:** `docs/superpowers/specs/2026-09-22-fase-3-1-tenant-listo-design.md`

## Global Constraints

- Sin IA: ninguna dependencia ni import de LLM, embeddings, vectores o n8n.
- `tenant_id` solo del claim del JWT en `/api/v1`; en `/api/platform/v1` viaja en el cuerpo porque la plataforma es un actor fuera de todo tenant.
- Recurso de otro tenant → `404`, nunca `403`.
- Rol `widget` → `403` en toda ruta de dominio, KB y config.
- Toda escritura exige `Idempotency-Key` persistida en base de datos, excepto `POST /api/platform/v1/tokens` (no escribe dominio).
- Ningún JWT se persiste: ni en `idempotency_keys.response_body`, ni en `audit_events`, ni en logs.
- `audit_events` registra el hecho, nunca valores.
- `domain` y `application` no importan `next`, `@prisma/client`, `node:*` ni `react`.
- Los módulos `bot-config`, `knowledge`, `widget` y `platform` solo importan `shared` y `auth` de otros módulos.
- `process.env` solo en `backend/src/config/env.ts`.
- Clean Code: complejidad cognitiva ≤ 15, ≤ 40 líneas por función (sin blancos), ≤ 400 líneas por archivo de lógica, 0 ciclos.
- Código, rutas y campos en inglés; comentarios y mensajes en español.
- `openapi.json` y `openapi-platform.json` son generados: se edita `src/http/openapi*.ts` y se corre `npm --prefix backend run openapi:generate`.
- Params de `bot-config`: `widget_session_ttl_minutes` 30 (5–120), `widget_sessions_per_ip_per_minute` 10 (1–100), `widget_key_grace_hours` 24 (0–168), `kb_max_results` 3 (1–10).
- Textos: `welcome`, `kb_see_more_label`; texto plano 1–1000 caracteres; único marcador `{clinic_name}`.
- KB: `category` 1–60, `question` 1–200, `answer` 1–1000, `detail` ≤ 4000, `keywords` ≤ 20 (ya normalizadas), 500 entradas por tenant.
- Clave de widget: `wk_` + 32 bytes aleatorios en base64url (43 caracteres); una sola vigente por tenant (índice único parcial).
- TTL de tokens de plataforma: 480 min por defecto y tope 720 para `operator`/`admin`; 60 min y tope 1440 para `service`.
- `allowed_origins`: máximo 20, origen exacto `https://host[:puerto]`, `http://localhost[:puerto]` solo fuera de producción; lista vacía niega todo.
- **El usuario trabaja en paralelo en la misma rama.** Commitear solo los archivos de cada tarea con `git add <rutas>`; nunca `git add -A`, `git stash`, `git checkout --` ni `reset`. No tocar `ROADMAP.md`. `CLAUDE.md` tiene cambios suyos sin commitear: se edita pero **no se commitea** (Tarea 13).

## Review Focus

- **Replay anónimo de la sesión del widget.** Quien conozca la clave pública y la `Idempotency-Key` de otro navegador obtendría un token de esa sesión. Se espera que las claves de menos de 32 caracteres se rechacen con `422` en `POST /widget/sessions` (Tarea 11).
- **Dos rotaciones de clave concurrentes.** Se espera que una responda `200` y la otra `409`, con exactamente una clave vigente, nunca un `500` (Tarea 8).
- **Alta con slug repetido o origen inválido.** Se espera un `409` o `422` sin filas a medias (ni `bot_configs`, ni claves, ni KB) y sin reservar la `Idempotency-Key` (Tarea 10).
- **`Origin` con mayúsculas o un origen guardado con mayúsculas.** Se espera que se compare en minúsculas y que se guarde normalizado (Tareas 3 y 11).
- **`X-Forwarded-For` falsificado con `TRUST_PROXY=false`.** Se espera que no abra cubos nuevos: todo cae en un único cubo por tenant (Tarea 11).

---

## Mapa de archivos

```
backend/prisma/schema.prisma                                  # modelos nuevos
backend/prisma/migrations/<ts>_fase3_1_tenant_listo/          # migración + SQL manual
backend/src/config/env.ts                                     # PLATFORM_SECRET, TRUST_PROXY
backend/src/composition-root.ts                               # ensamblado
backend/src/http/
  error-codes.ts, errors.ts                                   # rate_limited + Retry-After
  idempotency-core.ts                                         # núcleo compartido (nuevo)
  idempotent-route.ts                                         # usa el núcleo; opción rebuild
  platform-route.ts                                           # auth de plataforma (nuevo)
  client-ip.ts                                                # IP para rate limit (nuevo)
  serializers-chatbot.ts                                      # JSON de config, KB, sesiones, tenants (nuevo)
  openapi-shared.ts                                           # piezas comunes (nuevo, extraído)
  openapi.ts                                                  # + rutas nuevas de /api/v1
  openapi-platform.ts                                         # contrato de plataforma (nuevo)
backend/scripts/generate-openapi.ts, token-dev.ts
backend/src/modules/shared/domain/rate-limited-error.ts       # nuevo
backend/src/modules/shared/domain/audit-event.ts              # + AuditActor
backend/src/modules/shared/domain/ports/idempotency-store.ts  # + PlatformIdempotencyStore
backend/src/modules/shared/infrastructure/prisma-platform-idempotency-store.ts
backend/src/modules/auth/domain/ports/token-issuer.ts
backend/src/modules/auth/infrastructure/jose-token-issuer.ts
backend/src/modules/bot-config/
  domain/bot-config.ts, allowed-origins.ts, widget-key.ts
  domain/ports/repositories.ts, widget-key-generator.ts
  application/bot-config.ts, widget-keys.ts, provisioning.ts
  infrastructure/prisma-bot-config-repository.ts, prisma-widget-key-repository.ts, crypto-widget-key-generator.ts
backend/src/modules/knowledge/
  domain/normalize.ts, knowledge-entry.ts, search.ts, default-entries.ts
  domain/ports/knowledge-repository.ts
  application/knowledge-entries.ts
  infrastructure/prisma-knowledge-repository.ts
backend/src/modules/widget/
  domain/widget-session.ts, domain/ports/ports.ts
  application/admit-widget.ts, widget-sessions.ts
  infrastructure/prisma-widget-session-repository.ts, in-memory-rate-limiter.ts
backend/src/modules/platform/
  domain/tenant-registration.ts, token-request.ts, platform-actor.ts
  domain/ports/tenant-registry.ts, provisioning.ts
  application/register-tenant.ts, issue-token.ts, list-tenants.ts
  infrastructure/prisma-tenant-registry.ts
backend/src/app/api/v1/bot-config/route.ts
backend/src/app/api/v1/bot-config/widget-keys/rotate/route.ts
backend/src/app/api/v1/knowledge-entries/route.ts
backend/src/app/api/v1/knowledge-entries/[id]/route.ts
backend/src/app/api/v1/widget/sessions/route.ts
backend/src/app/api/v1/widget/sessions/refresh/route.ts
backend/src/app/api/platform/v1/tenants/route.ts
backend/src/app/api/platform/v1/tokens/route.ts
backend/tests/...                                             # ver cada tarea
```

Comandos de prueba (desde la raíz):

- Unitaria: `npm --prefix backend exec vitest run --project unit <ruta>`
- Postgres: `npm --prefix backend exec vitest run --project db <ruta>` (requiere `TEST_DATABASE_URL` terminada en `_test`)

---

### Task 1: Esquema y migración

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_fase3_1_tenant_listo/migration.sql` (generada + SQL manual)
- Test: `backend/tests/db/esquema-chatbot-config.test.ts`

**Interfaces:**
- Produces: modelos Prisma `BotConfig` (`prisma.botConfig`), `WidgetKey` (`prisma.widgetKey`), `KnowledgeEntry` (`prisma.knowledgeEntry`), `WidgetSession` (`prisma.widgetSession`), `PlatformIdempotencyKey` (`prisma.platformIdempotencyKey`).

- [ ] **Step 1: Write the failing test**

`backend/tests/db/esquema-chatbot-config.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const KEY_A = `wk_${"a".repeat(43)}`;
const KEY_B = `wk_${"b".repeat(43)}`;

describe("alta-chatbot: esquema de configuracion del chatbot", () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantId = await insertTenant(prisma, "a");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("crea las cinco tablas nuevas en public", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename IN ('bot_configs','widget_keys','knowledge_entries','widget_sessions','platform_idempotency_keys')
      ORDER BY tablename`;
    expect(rows.map((row) => row.tablename)).toEqual([
      "bot_configs",
      "knowledge_entries",
      "platform_idempotency_keys",
      "widget_keys",
      "widget_sessions",
    ]);
  });

  it("un tenant no puede tener dos claves vigentes", async () => {
    const now = new Date("2026-09-22T12:00:00Z");
    await prisma.widgetKey.create({ data: { id: "k1", tenantId, key: KEY_A, createdAt: now } });
    await expect(
      prisma.widgetKey.create({ data: { id: "k2", tenantId, key: KEY_B, createdAt: now } }),
    ).rejects.toThrow();

    await prisma.widgetKey.update({
      where: { id: "k1" },
      data: { retiredAt: now, graceUntil: new Date("2026-09-23T12:00:00Z") },
    });
    await prisma.widgetKey.create({ data: { id: "k2", tenantId, key: KEY_B, createdAt: now } });
    expect(await prisma.widgetKey.count()).toBe(2);
  });

  it("una clave no puede tener gracia sin estar retirada", async () => {
    await expect(
      prisma.widgetKey.create({
        data: {
          id: "k1",
          tenantId,
          key: KEY_A,
          createdAt: new Date(),
          graceUntil: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("la sesion del widget no guarda la IP", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'widget_sessions' ORDER BY column_name`;
    expect(rows.map((row) => row.column_name)).toEqual([
      "created_at",
      "expires_at",
      "id",
      "last_seen_at",
      "origin",
      "tenant_id",
    ]);
  });

  it("la posicion de una entrada de la KB no es negativa", async () => {
    await expect(
      prisma.knowledgeEntry.create({
        data: {
          id: "e1",
          tenantId,
          category: "General",
          question: "¿Horario?",
          answer: "De 8 a 5",
          position: -1,
        },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/esquema-chatbot-config.test.ts`
Expected: FAIL: la aserción de tablas devuelve `[]`, y `prisma.widgetKey` o `prisma.knowledgeEntry` no existen.

- [ ] **Step 3: Add the models**

En `backend/prisma/schema.prisma`, dentro de `model Tenant` añade las relaciones después de `idempotencyKeys IdempotencyKey[]`:

```prisma
  botConfig        BotConfig?
  widgetKeys       WidgetKey[]
  knowledgeEntries KnowledgeEntry[]
  widgetSessions   WidgetSession[]
```

Y antes del bloque del simulador (`// ----` de `hermes_sim`), añade:

```prisma
// Configuracion del bot por tenant. Solo guarda lo que el tenant sobrescribe:
// los predeterminados viven en el dominio (modules/bot-config/domain/bot-config.ts).
model BotConfig {
  tenantId       String   @id @map("tenant_id")
  texts          Json     @default("{}")
  params         Json     @default("{}")
  allowedOrigins String[] @default([]) @map("allowed_origins")
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("bot_configs")
  @@schema("public")
}

// Clave publica del widget. Una sola vigente por tenant (indice unico parcial en la migracion).
model WidgetKey {
  id         String    @id
  tenantId   String    @map("tenant_id")
  key        String    @unique
  createdAt  DateTime  @map("created_at") @db.Timestamptz(3)
  retiredAt  DateTime? @map("retired_at") @db.Timestamptz(3)
  graceUntil DateTime? @map("grace_until") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId])
  @@map("widget_keys")
  @@schema("public")
}

model KnowledgeEntry {
  id        String   @id
  tenantId  String   @map("tenant_id")
  category  String
  question  String
  answer    String
  detail    String?
  keywords  String[] @default([])
  position  Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, id])
  @@index([tenantId, category, position])
  @@map("knowledge_entries")
  @@schema("public")
}

// Sesion del widget. Sin IP: solo vive en memoria para el rate limit.
model WidgetSession {
  id         String   @id
  tenantId   String   @map("tenant_id")
  origin     String
  createdAt  DateTime @map("created_at") @db.Timestamptz(3)
  expiresAt  DateTime @map("expires_at") @db.Timestamptz(3)
  lastSeenAt DateTime @map("last_seen_at") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, id])
  @@map("widget_sessions")
  @@schema("public")
}

// Idempotencia de la superficie de plataforma: sin tenant, porque el alta lo crea.
model PlatformIdempotencyKey {
  key            String   @id
  method         String
  path           String
  requestHash    String   @map("request_hash")
  responseStatus Int      @map("response_status")
  responseBody   Json     @map("response_body")
  createdAt      DateTime @map("created_at") @db.Timestamptz(3)

  @@map("platform_idempotency_keys")
  @@schema("public")
}
```

- [ ] **Step 4: Generate the migration and append manual SQL**

Run: `npm --prefix backend exec prisma migrate dev -- --create-only --name fase3_1_tenant_listo`
(Usa `DATABASE_URL` de `backend/.env`, que es la base de desarrollo.)

Al final del `migration.sql` generado, añade:

```sql
-- Una sola clave vigente por tenant: dos rotaciones concurrentes no pueden dejar dos.
CREATE UNIQUE INDEX "widget_keys_one_current_per_tenant" ON "widget_keys"("tenant_id") WHERE "retired_at" IS NULL;

-- La gracia solo tiene sentido en una clave retirada.
ALTER TABLE "widget_keys"
  ADD CONSTRAINT "widget_keys_grace_check" CHECK ("grace_until" IS NULL OR "retired_at" IS NOT NULL);

ALTER TABLE "knowledge_entries"
  ADD CONSTRAINT "knowledge_entries_position_check" CHECK ("position" >= 0);

ALTER TABLE "widget_sessions"
  ADD CONSTRAINT "widget_sessions_expiry_check" CHECK ("expires_at" > "created_at");
```

Luego aplica y regenera el cliente:
Run: `npm --prefix backend exec prisma migrate dev` y `npm --prefix backend run db:generate`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix backend exec vitest run --project db tests/db/esquema-chatbot-config.test.ts`
Expected: PASS (5 tests). Corre también `npm --prefix backend exec vitest run --project db tests/db/esquema-simulador.test.ts`: la prueba «ninguna FK cruza entre public y hermes_sim» sigue en verde.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/db/esquema-chatbot-config.test.ts
git commit -m "feat(db): tablas de bot-config, claves y sesiones del widget, KB e idempotencia de plataforma"
```

---

### Task 2: Error `rate_limited` con `Retry-After`

**Files:**
- Create: `backend/src/modules/shared/domain/rate-limited-error.ts`
- Modify: `backend/src/http/error-codes.ts`, `backend/src/http/errors.ts`
- Regenerate: `backend/openapi.json`
- Test: `backend/tests/contrato-api.test.ts`

**Interfaces:**
- Produces: `class RateLimitedError extends Error { readonly retryAfterSeconds: number; constructor(retryAfterSeconds: number) }`; código `rate_limited` → `429` con cabecera `Retry-After`.

- [ ] **Step 1: Write the failing test**

Añade al final de `backend/tests/contrato-api.test.ts` (y los imports `errorResponse, toApiError` de `@/http/errors` y `RateLimitedError` de `@/modules/shared/domain/rate-limited-error`):

```ts
describe("contrato-api: rate_limited", () => {
  it("responde 429 con Retry-After y el mismo valor en details", async () => {
    const response = errorResponse(toApiError(new RateLimitedError(17)), "peticion-rl");
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(body.error).toMatchObject({
      code: "rate_limited",
      request_id: "peticion-rl",
      details: { retry_after_seconds: 17 },
    });
  });

  it("otros errores no llevan Retry-After", () => {
    const response = errorResponse(toApiError(new Error("x")), "peticion-500");
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/contrato-api.test.ts`
Expected: FAIL: no se resuelve el módulo `rate-limited-error`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/modules/shared/domain/rate-limited-error.ts`:

```ts
/** Demasiadas peticiones en la ventana. HTTP → `rate_limited` 429 con `Retry-After`. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Demasiadas peticiones; intenta mas tarde");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
```

En `backend/src/http/error-codes.ts` añade `"rate_limited"` después de `"method_not_allowed"` en `ERROR_CODES`, y `rate_limited: 429,` en `STATUS_BY_CODE`.

En `backend/src/http/errors.ts`:

```ts
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
```

Dentro de `toApiError`, antes de `if (error instanceof AuthError)`:

```ts
  if (error instanceof RateLimitedError) {
    return new ApiError("rate_limited", error.message, {
      retry_after_seconds: error.retryAfterSeconds,
    });
  }
```

Reemplaza el cuerpo final de `errorResponse` (desde `return NextResponse.json(body, {`) por:

```ts
  const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
  const retryAfter = retryAfterOf(error);
  if (retryAfter !== null) {
    headers["Retry-After"] = String(retryAfter);
  }
  return NextResponse.json(body, { status: STATUS_BY_CODE[error.code], headers });
}

function retryAfterOf(error: ApiError): number | null {
  if (error.code !== "rate_limited" || !error.details || typeof error.details !== "object") {
    return null;
  }
  const seconds = (error.details as { retry_after_seconds?: unknown }).retry_after_seconds;
  return typeof seconds === "number" ? seconds : null;
}
```

Regenera el contrato (el enum de códigos de error forma parte de `openapi.json`):
Run: `npm --prefix backend run openapi:generate`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix backend exec vitest run --project unit tests/contrato-api.test.ts`
Expected: PASS, incluida «openapi.json esta al dia con el generador».

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/shared/domain/rate-limited-error.ts backend/src/http/error-codes.ts backend/src/http/errors.ts backend/openapi.json backend/tests/contrato-api.test.ts
git commit -m "feat(http): codigo rate_limited con cabecera Retry-After"
```

---

### Task 3: Dominio de `bot-config` y orígenes permitidos

**Files:**
- Create: `backend/src/modules/shared/domain/input.ts`
- Create: `backend/src/modules/bot-config/domain/bot-config.ts`
- Create: `backend/src/modules/bot-config/domain/allowed-origins.ts`
- Test: `backend/tests/dominio/bot-config.test.ts`

**Interfaces:**
- Produces (`shared/domain/input.ts`, lo reusan `knowledge` y `platform`): `isRecord(value: unknown): value is Record<string, unknown>`, `asRecord(value: unknown, field: string): Record<string, unknown>` (lanza `ValidationError` «`<field>` debe ser un objeto» con `{ field }`), `requiredText(value: unknown, field: string, max: number): string` (recorta; vacío o > `max` → `ValidationError` con `{ field, max }`).
- Produces (`bot-config.ts`):
  - `DEFAULT_TEXTS: { welcome: string; kb_see_more_label: string }`, `type TextKey`
  - `PARAM_SPECS`, `type ParamKey`, `type BotParams = Readonly<Record<ParamKey, number>>`
  - `type BotConfigOverrides = { texts: Partial<Record<TextKey,string>>; params: Partial<BotParams>; allowedOrigins: readonly string[] }`
  - `EMPTY_OVERRIDES: BotConfigOverrides`
  - `type EffectiveBotConfig = { texts: Record<TextKey, { value: string; overridden: boolean }>; params: BotParams; allowedOrigins: readonly string[] }`
  - `effectiveConfig(overrides: BotConfigOverrides): EffectiveBotConfig`
  - `type BotConfigPatch = { texts?: unknown; params?: unknown; allowedOrigins?: unknown }`
  - `parseBotConfigPatch(raw: unknown): BotConfigPatch` (cuerpo HTTP con `allowed_origins`)
  - `applyPatch(current: BotConfigOverrides, patch: BotConfigPatch, policy: OriginPolicy): BotConfigOverrides`
  - `sanitizeOverrides(raw: { texts: unknown; params: unknown; allowedOrigins: readonly string[] }): BotConfigOverrides` (lectura defensiva desde la base)
- Produces (`allowed-origins.ts`): `type OriginPolicy = { allowLocalhost: boolean }`, `MAX_ALLOWED_ORIGINS = 20`, `validateAllowedOrigins(raw: unknown, policy: OriginPolicy): string[]`

- [ ] **Step 1: Write the failing test**

`backend/tests/dominio/bot-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateAllowedOrigins } from "@/modules/bot-config/domain/allowed-origins";
import {
  applyPatch,
  DEFAULT_TEXTS,
  EMPTY_OVERRIDES,
  effectiveConfig,
  PARAM_SPECS,
  parseBotConfigPatch,
  sanitizeOverrides,
} from "@/modules/bot-config/domain/bot-config";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const DEV = { allowLocalhost: true };
const PROD = { allowLocalhost: false };

describe("conocimiento-config: bot-config efectivo", () => {
  it("sin sobrescrituras devuelve los predeterminados", () => {
    const config = effectiveConfig(EMPTY_OVERRIDES);
    expect(config.texts.welcome).toEqual({ value: DEFAULT_TEXTS.welcome, overridden: false });
    expect(config.params).toEqual({
      widget_session_ttl_minutes: 30,
      widget_sessions_per_ip_per_minute: 10,
      widget_key_grace_hours: 24,
      kb_max_results: 3,
    });
    expect(config.allowedOrigins).toEqual([]);
  });

  it("marca como sobrescrito lo que el tenant cambio", () => {
    const config = effectiveConfig({
      texts: { welcome: "Bienvenido a {clinic_name}" },
      params: { kb_max_results: 5 },
      allowedOrigins: [],
    });
    expect(config.texts.welcome).toEqual({ value: "Bienvenido a {clinic_name}", overridden: true });
    expect(config.texts.kb_see_more_label.overridden).toBe(false);
    expect(config.params.kb_max_results).toBe(5);
  });
});

describe("conocimiento-config: parche de bot-config", () => {
  it("aplica textos y params validos", () => {
    const next = applyPatch(
      EMPTY_OVERRIDES,
      { texts: { welcome: "Hola desde {clinic_name}" }, params: { widget_key_grace_hours: 0 } },
      DEV,
    );
    expect(next.texts).toEqual({ welcome: "Hola desde {clinic_name}" });
    expect(next.params).toEqual({ widget_key_grace_hours: 0 });
  });

  it("null devuelve el texto o el param al predeterminado", () => {
    const current = { texts: { welcome: "Hola" }, params: { kb_max_results: 7 }, allowedOrigins: [] };
    const next = applyPatch(current, { texts: { welcome: null }, params: { kb_max_results: null } }, DEV);
    expect(next.texts).toEqual({});
    expect(next.params).toEqual({});
  });

  it("lo que no viene en el parche no cambia", () => {
    const current = { texts: { welcome: "Hola" }, params: {}, allowedOrigins: ["https://a.test"] };
    expect(applyPatch(current, {}, DEV)).toEqual(current);
  });

  it.each([
    [{ texts: { despedida: "Chao" } }, "texts.despedida"],
    [{ texts: { welcome: "" } }, "texts.welcome"],
    [{ texts: { welcome: "x".repeat(1001) } }, "texts.welcome"],
    [{ texts: { welcome: "Hola {nombre}" } }, "texts.welcome"],
    [{ texts: { welcome: "<b>Hola</b>" } }, "texts.welcome"],
    [{ texts: { welcome: 5 } }, "texts.welcome"],
    [{ params: { kb_max_results: 11 } }, "params.kb_max_results"],
    [{ params: { widget_session_ttl_minutes: 4 } }, "params.widget_session_ttl_minutes"],
    [{ params: { kb_max_results: 2.5 } }, "params.kb_max_results"],
    [{ params: { desconocido: 1 } }, "params.desconocido"],
    [{ texts: ["welcome"] }, "texts"],
  ])("rechaza %j", (patch, field) => {
    try {
      applyPatch(EMPTY_OVERRIDES, patch, DEV);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });

  it("los rangos de los params coinciden con la spec", () => {
    expect(PARAM_SPECS.widget_key_grace_hours).toEqual({ default: 24, min: 0, max: 168 });
    expect(PARAM_SPECS.widget_sessions_per_ip_per_minute).toEqual({ default: 10, min: 1, max: 100 });
  });
});

describe("conocimiento-config: cuerpo HTTP del parche", () => {
  it("traduce allowed_origins y deja fuera lo ausente", () => {
    expect(parseBotConfigPatch({ allowed_origins: ["https://a.test"] })).toEqual({
      allowedOrigins: ["https://a.test"],
    });
  });

  it("rechaza campos desconocidos y cuerpos que no son objeto", () => {
    expect(() => parseBotConfigPatch({ colores: {} })).toThrow(ValidationError);
    expect(() => parseBotConfigPatch([])).toThrow(ValidationError);
    expect(() => parseBotConfigPatch(null)).toThrow(ValidationError);
  });
});

describe("conocimiento-config: origenes permitidos", () => {
  it("normaliza a minusculas y quita duplicados", () => {
    expect(validateAllowedOrigins(["https://Clinica.Test", "https://clinica.test"], PROD)).toEqual([
      "https://clinica.test",
    ]);
  });

  it("acepta puerto explicito", () => {
    expect(validateAllowedOrigins(["https://clinica.test:8443"], PROD)).toEqual([
      "https://clinica.test:8443",
    ]);
  });

  it("localhost solo fuera de produccion", () => {
    expect(validateAllowedOrigins(["http://localhost:3000"], DEV)).toEqual(["http://localhost:3000"]);
    expect(() => validateAllowedOrigins(["http://localhost:3000"], PROD)).toThrow(ValidationError);
  });

  it.each([
    "http://clinica.test",
    "https://clinica.test/",
    "https://clinica.test/widget",
    "https://*.clinica.test",
    "clinica.test",
    "",
  ])("rechaza %s", (origin) => {
    expect(() => validateAllowedOrigins([origin], DEV)).toThrow(ValidationError);
  });

  it("rechaza mas de 20 origenes y valores que no son lista", () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://c${i}.test`);
    expect(() => validateAllowedOrigins(many, PROD)).toThrow(ValidationError);
    expect(() => validateAllowedOrigins("https://a.test", PROD)).toThrow(ValidationError);
  });
});

describe("conocimiento-config: lectura defensiva", () => {
  it("descarta claves desconocidas o valores fuera de rango guardados", () => {
    const overrides = sanitizeOverrides({
      texts: { welcome: "Hola", viejo: "x" },
      params: { kb_max_results: 99, widget_key_grace_hours: 12 },
      allowedOrigins: ["https://a.test"],
    });
    expect(overrides).toEqual({
      texts: { welcome: "Hola" },
      params: { widget_key_grace_hours: 12 },
      allowedOrigins: ["https://a.test"],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/bot-config.test.ts`
Expected: FAIL: no se resuelve `@/modules/bot-config/domain/...`.

- [ ] **Step 3: Write `shared/domain/input.ts`**

```ts
import { ValidationError } from "./validation-error";

/** Ayudas para desempaquetar entradas sin tipo (cuerpos HTTP ya parseados). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${field} debe ser un objeto`, { field });
  }
  return value;
}

/** Texto obligatorio, recortado, de 1 a `max` caracteres. */
export function requiredText(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || text.length > max) {
    throw new ValidationError(`${field} debe tener entre 1 y ${max} caracteres`, { field, max });
  }
  return text;
}
```

- [ ] **Step 3b: Write `allowed-origins.ts`**

```ts
import { ValidationError } from "@/modules/shared/domain/validation-error";

/** Fuera de produccion se admite localhost para probar el widget en local. */
export type OriginPolicy = { readonly allowLocalhost: boolean };

export const MAX_ALLOWED_ORIGINS = 20;

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const PORT = "(?::\\d{1,5})?";
const HTTPS_ORIGIN = new RegExp(`^https://${LABEL}(?:\\.${LABEL})*${PORT}$`);
const LOCALHOST_ORIGIN = new RegExp(`^http://localhost${PORT}$`);

/** Valida y normaliza (minusculas, sin duplicados) la lista de origenes del widget. */
export function validateAllowedOrigins(raw: unknown, policy: OriginPolicy): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("allowed_origins debe ser una lista", { field: "allowed_origins" });
  }
  if (raw.length > MAX_ALLOWED_ORIGINS) {
    throw new ValidationError(`allowed_origins admite como maximo ${MAX_ALLOWED_ORIGINS}`, {
      field: "allowed_origins",
      max: MAX_ALLOWED_ORIGINS,
    });
  }
  const origins = raw.map((value, index) => validateOrigin(value, index, policy));
  return [...new Set(origins)];
}

function validateOrigin(value: unknown, index: number, policy: OriginPolicy): string {
  const origin = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (HTTPS_ORIGIN.test(origin) || (policy.allowLocalhost && LOCALHOST_ORIGIN.test(origin))) {
    return origin;
  }
  const field = `allowed_origins.${index}`;
  throw new ValidationError(`${field} no es un origen valido (https://host[:puerto])`, { field });
}
```

- [ ] **Step 4: Write `bot-config.ts`**

```ts
import { asRecord, isRecord } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { type OriginPolicy, validateAllowedOrigins } from "./allowed-origins";

/** Textos del bot. Los predeterminados viven aqui; el tenant solo guarda los que sobrescribe. */
export const DEFAULT_TEXTS = {
  welcome: "Hola, soy el asistente virtual de {clinic_name}. ¿En qué te puedo ayudar?",
  kb_see_more_label: "Ver más",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

export const PARAM_SPECS = {
  widget_session_ttl_minutes: { default: 30, min: 5, max: 120 },
  widget_sessions_per_ip_per_minute: { default: 10, min: 1, max: 100 },
  widget_key_grace_hours: { default: 24, min: 0, max: 168 },
  kb_max_results: { default: 3, min: 1, max: 10 },
} as const;

export type ParamKey = keyof typeof PARAM_SPECS;
export type BotParams = Readonly<Record<ParamKey, number>>;

export type BotConfigOverrides = {
  readonly texts: Readonly<Partial<Record<TextKey, string>>>;
  readonly params: Readonly<Partial<BotParams>>;
  readonly allowedOrigins: readonly string[];
};

export type EffectiveText = { readonly value: string; readonly overridden: boolean };

export type EffectiveBotConfig = {
  readonly texts: Readonly<Record<TextKey, EffectiveText>>;
  readonly params: BotParams;
  readonly allowedOrigins: readonly string[];
};

/** Parche ya desempaquetado del cuerpo HTTP; los valores se validan al aplicarlo. */
export type BotConfigPatch = {
  readonly texts?: unknown;
  readonly params?: unknown;
  readonly allowedOrigins?: unknown;
};

export const EMPTY_OVERRIDES: BotConfigOverrides = { texts: {}, params: {}, allowedOrigins: [] };

const TEXT_MAX_LENGTH = 1000;
const ALLOWED_PLACEHOLDERS = new Set(["clinic_name"]);
const PLACEHOLDER = /\{([^{}]*)\}/g;
const PATCH_FIELDS = new Set(["texts", "params", "allowed_origins"]);

const TEXT_KEYS = Object.keys(DEFAULT_TEXTS) as TextKey[];
const PARAM_KEYS = Object.keys(PARAM_SPECS) as ParamKey[];

function isTextKey(key: string): key is TextKey {
  return Object.hasOwn(DEFAULT_TEXTS, key);
}

function isParamKey(key: string): key is ParamKey {
  return Object.hasOwn(PARAM_SPECS, key);
}

export function effectiveConfig(overrides: BotConfigOverrides): EffectiveBotConfig {
  const texts = Object.fromEntries(
    TEXT_KEYS.map((key) => {
      const own = overrides.texts[key];
      return [key, { value: own ?? DEFAULT_TEXTS[key], overridden: own !== undefined }];
    }),
  ) as Record<TextKey, EffectiveText>;
  const params = Object.fromEntries(
    PARAM_KEYS.map((key) => [key, overrides.params[key] ?? PARAM_SPECS[key].default]),
  ) as Record<ParamKey, number>;
  return { texts, params, allowedOrigins: overrides.allowedOrigins };
}

export function parseBotConfigPatch(raw: unknown): BotConfigPatch {
  const data = asRecord(raw, "body");
  const unknown = Object.keys(data).find((key) => !PATCH_FIELDS.has(key));
  if (unknown !== undefined) {
    throw new ValidationError(`Campo desconocido: ${unknown}`, { field: unknown });
  }
  return {
    ...(Object.hasOwn(data, "texts") ? { texts: data.texts } : {}),
    ...(Object.hasOwn(data, "params") ? { params: data.params } : {}),
    ...(Object.hasOwn(data, "allowed_origins") ? { allowedOrigins: data.allowed_origins } : {}),
  };
}

export function applyPatch(
  current: BotConfigOverrides,
  patch: BotConfigPatch,
  policy: OriginPolicy,
): BotConfigOverrides {
  return {
    texts: patch.texts === undefined ? current.texts : patchTexts(current.texts, patch.texts),
    params: patch.params === undefined ? current.params : patchParams(current.params, patch.params),
    allowedOrigins:
      patch.allowedOrigins === undefined
        ? current.allowedOrigins
        : validateAllowedOrigins(patch.allowedOrigins, policy),
  };
}

/** Lectura desde la base: descarta lo que ya no es valido en vez de fallar. */
export function sanitizeOverrides(raw: {
  texts: unknown;
  params: unknown;
  allowedOrigins: readonly string[];
}): BotConfigOverrides {
  const texts: Partial<Record<TextKey, string>> = {};
  for (const [key, value] of Object.entries(isRecord(raw.texts) ? raw.texts : {})) {
    if (isTextKey(key) && isValid(() => validateText(key, value))) {
      texts[key] = value as string;
    }
  }
  const params: Partial<Record<ParamKey, number>> = {};
  for (const [key, value] of Object.entries(isRecord(raw.params) ? raw.params : {})) {
    if (isParamKey(key) && isValid(() => validateParam(key, value))) {
      params[key] = value as number;
    }
  }
  return { texts, params, allowedOrigins: raw.allowedOrigins };
}

function patchTexts(current: BotConfigOverrides["texts"], raw: unknown) {
  const next: Partial<Record<TextKey, string>> = { ...current };
  for (const [key, value] of Object.entries(asRecord(raw, "texts"))) {
    if (!isTextKey(key)) {
      throw new ValidationError(`Texto desconocido: ${key}`, { field: `texts.${key}` });
    }
    if (value === null) {
      delete next[key];
    } else {
      next[key] = validateText(key, value);
    }
  }
  return next;
}

function patchParams(current: BotConfigOverrides["params"], raw: unknown) {
  const next: Partial<Record<ParamKey, number>> = { ...current };
  for (const [key, value] of Object.entries(asRecord(raw, "params"))) {
    if (!isParamKey(key)) {
      throw new ValidationError(`Parametro desconocido: ${key}`, { field: `params.${key}` });
    }
    if (value === null) {
      delete next[key];
    } else {
      next[key] = validateParam(key, value);
    }
  }
  return next;
}

function validateText(key: TextKey, value: unknown): string {
  const field = `texts.${key}`;
  if (typeof value !== "string" || value.trim() === "" || value.length > TEXT_MAX_LENGTH) {
    throw new ValidationError(`${field} debe tener entre 1 y ${TEXT_MAX_LENGTH} caracteres`, {
      field,
      max: TEXT_MAX_LENGTH,
    });
  }
  if (/[<>]/.test(value)) {
    throw new ValidationError(`${field} es texto plano: no admite HTML`, { field });
  }
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!ALLOWED_PLACEHOLDERS.has(match[1] ?? "")) {
      throw new ValidationError(`Marcador desconocido en ${field}: {${match[1] ?? ""}}`, {
        field,
        allowed: [...ALLOWED_PLACEHOLDERS],
      });
    }
  }
  return value;
}

function validateParam(key: ParamKey, value: unknown): number {
  const spec = PARAM_SPECS[key];
  const field = `params.${key}`;
  if (typeof value !== "number" || !Number.isInteger(value) || value < spec.min || value > spec.max) {
    throw new ValidationError(`${field} debe ser un entero entre ${spec.min} y ${spec.max}`, {
      field,
      min: spec.min,
      max: spec.max,
    });
  }
  return value;
}

function isValid(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/bot-config.test.ts tests/fronteras.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/shared/domain/input.ts backend/src/modules/bot-config/domain backend/tests/dominio/bot-config.test.ts
git commit -m "feat(bot-config): textos y params tipados con predeterminados y origenes permitidos"
```

---

### Task 4: Dominio de claves del widget y generador

**Files:**
- Create: `backend/src/modules/bot-config/domain/widget-key.ts`
- Create: `backend/src/modules/bot-config/domain/ports/widget-key-generator.ts`
- Create: `backend/src/modules/bot-config/infrastructure/crypto-widget-key-generator.ts`
- Test: `backend/tests/dominio/widget-key.test.ts`

**Interfaces:**
- Produces:
  - `type WidgetKey = { id: string; tenantId: TenantId; key: string; createdAt: Date; retiredAt: Date | null; graceUntil: Date | null }`
  - `WIDGET_KEY_PATTERN: RegExp` (`/^wk_[A-Za-z0-9_-]{43}$/`)
  - `isKeyAccepted(key: WidgetKey, now: Date): boolean`
  - `type KeyRetirement = { id: string; retiredAt: Date; graceUntil: Date }`
  - `planRotation(accepted: readonly WidgetKey[], now: Date, graceHours: number): KeyRetirement[]`
  - `splitKeys(accepted: readonly WidgetKey[]): { current: WidgetKey | null; grace: WidgetKey | null }`
  - `type WidgetKeyGenerator = { next(): string }`, `cryptoWidgetKeyGenerator: WidgetKeyGenerator`

- [ ] **Step 1: Write the failing test**

`backend/tests/dominio/widget-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isKeyAccepted,
  planRotation,
  splitKeys,
  WIDGET_KEY_PATTERN,
  type WidgetKey,
} from "@/modules/bot-config/domain/widget-key";
import { cryptoWidgetKeyGenerator } from "@/modules/bot-config/infrastructure/crypto-widget-key-generator";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const HOUR = 3_600_000;

function key(overrides: Partial<WidgetKey> = {}): WidgetKey {
  return {
    id: "k1",
    tenantId: toTenantId("tenant-a"),
    key: `wk_${"a".repeat(43)}`,
    createdAt: new Date(NOW.getTime() - 10 * HOUR),
    retiredAt: null,
    graceUntil: null,
    ...overrides,
  };
}

describe("conocimiento-config: aceptacion de claves del widget", () => {
  it("la vigente se acepta", () => {
    expect(isKeyAccepted(key(), NOW)).toBe(true);
  });

  it("la retirada se acepta solo antes de que venza su gracia", () => {
    const retired = { retiredAt: new Date(NOW.getTime() - HOUR) };
    expect(isKeyAccepted(key({ ...retired, graceUntil: new Date(NOW.getTime() + 1) }), NOW)).toBe(true);
    expect(isKeyAccepted(key({ ...retired, graceUntil: NOW }), NOW)).toBe(false);
    expect(isKeyAccepted(key({ ...retired, graceUntil: null }), NOW)).toBe(false);
  });
});

describe("conocimiento-config: rotacion de claves", () => {
  it("la vigente pasa a gracia por las horas del tenant", () => {
    expect(planRotation([key()], NOW, 24)).toEqual([
      { id: "k1", retiredAt: NOW, graceUntil: new Date(NOW.getTime() + 24 * HOUR) },
    ]);
  });

  it("la que ya estaba en gracia muere al instante", () => {
    const inGrace = key({
      id: "k0",
      retiredAt: new Date(NOW.getTime() - HOUR),
      graceUntil: new Date(NOW.getTime() + HOUR),
    });
    expect(planRotation([key(), inGrace], NOW, 24)).toEqual([
      { id: "k1", retiredAt: NOW, graceUntil: new Date(NOW.getTime() + 24 * HOUR) },
      { id: "k0", retiredAt: inGrace.retiredAt, graceUntil: NOW },
    ]);
  });

  it("gracia de 0 horas retira la vigente sin ventana", () => {
    expect(planRotation([key()], NOW, 0)).toEqual([{ id: "k1", retiredAt: NOW, graceUntil: NOW }]);
  });

  it("separa la vigente de la que esta en gracia", () => {
    const inGrace = key({ id: "k0", retiredAt: NOW, graceUntil: new Date(NOW.getTime() + HOUR) });
    expect(splitKeys([inGrace, key()])).toEqual({ current: key(), grace: inGrace });
    expect(splitKeys([])).toEqual({ current: null, grace: null });
  });
});

describe("conocimiento-config: generador de claves", () => {
  it("produce wk_ + 43 caracteres base64url, distintos cada vez", () => {
    const first = cryptoWidgetKeyGenerator.next();
    const second = cryptoWidgetKeyGenerator.next();
    expect(first).toMatch(WIDGET_KEY_PATTERN);
    expect(second).toMatch(WIDGET_KEY_PATTERN);
    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/widget-key.test.ts`
Expected: FAIL: no se resuelve el módulo.

- [ ] **Step 3: Write minimal implementation**

`backend/src/modules/bot-config/domain/widget-key.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";

/**
 * Clave publica del widget. Esta en el HTML de la clinica: solo identifica al tenant y
 * abre sesiones. Se guarda en claro porque un hash no protege una clave publica.
 */
export type WidgetKey = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly key: string;
  readonly createdAt: Date;
  readonly retiredAt: Date | null;
  readonly graceUntil: Date | null;
};

export const WIDGET_KEY_PATTERN = /^wk_[A-Za-z0-9_-]{43}$/;

const HOUR_MS = 3_600_000;

export type KeyRetirement = {
  readonly id: string;
  readonly retiredAt: Date;
  readonly graceUntil: Date;
};

/** Vigente, o retirada con la gracia aun sin vencer (`now` estrictamente anterior). */
export function isKeyAccepted(key: WidgetKey, now: Date): boolean {
  if (key.retiredAt === null) {
    return true;
  }
  return key.graceUntil !== null && now.getTime() < key.graceUntil.getTime();
}

/**
 * Rotar: la vigente pasa a gracia y la que ya estaba en gracia muere ahora. Asi nunca hay
 * mas de dos claves aceptadas.
 */
export function planRotation(
  accepted: readonly WidgetKey[],
  now: Date,
  graceHours: number,
): KeyRetirement[] {
  return accepted.map((key) =>
    key.retiredAt === null
      ? { id: key.id, retiredAt: now, graceUntil: new Date(now.getTime() + graceHours * HOUR_MS) }
      : { id: key.id, retiredAt: key.retiredAt, graceUntil: now },
  );
}

export function splitKeys(accepted: readonly WidgetKey[]): {
  current: WidgetKey | null;
  grace: WidgetKey | null;
} {
  return {
    current: accepted.find((key) => key.retiredAt === null) ?? null,
    grace: accepted.find((key) => key.retiredAt !== null) ?? null,
  };
}
```

`backend/src/modules/bot-config/domain/ports/widget-key-generator.ts`:

```ts
/** Puerto: el nucleo no sabe de donde sale la aleatoriedad de la clave. */
export type WidgetKeyGenerator = {
  next(): string;
};
```

`backend/src/modules/bot-config/infrastructure/crypto-widget-key-generator.ts`:

```ts
import { randomBytes } from "node:crypto";
import type { WidgetKeyGenerator } from "../domain/ports/widget-key-generator";

/** Adaptador: `wk_` + 32 bytes aleatorios en base64url (43 caracteres). */
export const cryptoWidgetKeyGenerator: WidgetKeyGenerator = {
  next: () => `wk_${randomBytes(32).toString("base64url")}`,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/widget-key.test.ts tests/fronteras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bot-config/domain/widget-key.ts backend/src/modules/bot-config/domain/ports/widget-key-generator.ts backend/src/modules/bot-config/infrastructure/crypto-widget-key-generator.ts backend/tests/dominio/widget-key.test.ts
git commit -m "feat(bot-config): claves del widget con rotacion y gracia"
```

---

### Task 5: Dominio de la base de conocimiento

**Files:**
- Create: `backend/src/modules/knowledge/domain/normalize.ts`
- Create: `backend/src/modules/knowledge/domain/knowledge-entry.ts`
- Create: `backend/src/modules/knowledge/domain/search.ts`
- Create: `backend/src/modules/knowledge/domain/default-entries.ts`
- Test: `backend/tests/dominio/knowledge.test.ts`

**Interfaces:**
- Produces:
  - `normalizeTokens(text: string): string[]`
  - `type KnowledgeEntryDraft = { category: string; question: string; answer: string; detail: string | null; keywords: readonly string[]; position: number; active: boolean }`
  - `type KnowledgeEntry = KnowledgeEntryDraft & { id: string; tenantId: TenantId }`
  - `KNOWLEDGE_LIMITS = { category: 60, question: 200, answer: 1000, detail: 4000, keywords: 20, position: 100000, entriesPerTenant: 500 }`
  - `parseEntryDraft(raw: unknown): KnowledgeEntryDraft`
  - `mergeEntryPatch(existing: KnowledgeEntryDraft, raw: unknown): KnowledgeEntryDraft`
  - `searchEntries<T extends Pick<KnowledgeEntry, "id" | "keywords" | "position" | "active">>(entries: readonly T[], query: string, maxResults: number): T[]`
  - `DEFAULT_KNOWLEDGE_ENTRIES: readonly KnowledgeEntryDraft[]`

- [ ] **Step 1: Write the failing test**

`backend/tests/dominio/knowledge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_KNOWLEDGE_ENTRIES } from "@/modules/knowledge/domain/default-entries";
import {
  KNOWLEDGE_LIMITS,
  mergeEntryPatch,
  parseEntryDraft,
} from "@/modules/knowledge/domain/knowledge-entry";
import { normalizeTokens } from "@/modules/knowledge/domain/normalize";
import { searchEntries } from "@/modules/knowledge/domain/search";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const VALID = {
  category: "Citas",
  question: "¿Cómo agendo?",
  answer: "Desde este chat.",
  keywords: ["Agendar", "cita médica"],
};

describe("conocimiento-config: normalizacion", () => {
  it("quita tildes, signos, mayusculas, stopwords y duplicados", () => {
    expect(normalizeTokens("¿Cuál es el HORARIO de atención? ¡Horario!")).toEqual([
      "horario",
      "atencion",
    ]);
  });

  it("la eñe pierde la virgulilla", () => {
    expect(normalizeTokens("Mañana")).toEqual(["manana"]);
  });

  it("un texto sin tokens utiles queda vacio", () => {
    expect(normalizeTokens("¿de la?")).toEqual([]);
  });
});

describe("conocimiento-config: entradas", () => {
  it("aplica predeterminados y normaliza las keywords", () => {
    expect(parseEntryDraft(VALID)).toEqual({
      category: "Citas",
      question: "¿Cómo agendo?",
      answer: "Desde este chat.",
      detail: null,
      keywords: ["agendar", "cita", "medica"],
      position: 0,
      active: true,
    });
  });

  it("recorta espacios de los textos", () => {
    expect(parseEntryDraft({ ...VALID, category: "  Citas  " }).category).toBe("Citas");
  });

  it.each([
    [{ ...VALID, category: "" }, "category"],
    [{ ...VALID, category: "x".repeat(61) }, "category"],
    [{ ...VALID, question: "x".repeat(201) }, "question"],
    [{ ...VALID, answer: undefined }, "answer"],
    [{ ...VALID, detail: "x".repeat(4001) }, "detail"],
    [{ ...VALID, keywords: "agendar" }, "keywords"],
    [{ ...VALID, keywords: [1] }, "keywords"],
    [{ ...VALID, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }, "keywords"],
    [{ ...VALID, position: -1 }, "position"],
    [{ ...VALID, position: 1.5 }, "position"],
    [{ ...VALID, active: "si" }, "active"],
  ])("rechaza %j", (raw, field) => {
    try {
      parseEntryDraft(raw);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });

  it("el parche solo cambia lo que trae y revalida el conjunto", () => {
    const existing = parseEntryDraft(VALID);
    expect(mergeEntryPatch(existing, { active: false, detail: "Mas info" })).toEqual({
      ...existing,
      active: false,
      detail: "Mas info",
    });
    expect(mergeEntryPatch(existing, { detail: null }).detail).toBeNull();
    expect(() => mergeEntryPatch(existing, { question: "" })).toThrow(ValidationError);
  });

  it("el tope por tenant es 500", () => {
    expect(KNOWLEDGE_LIMITS.entriesPerTenant).toBe(500);
  });
});

describe("conocimiento-config: busqueda por tokens", () => {
  const entries = [
    { id: "b", keywords: ["cita", "agendar"], position: 2, active: true },
    { id: "a", keywords: ["cita"], position: 1, active: true },
    { id: "c", keywords: ["horario"], position: 0, active: true },
    { id: "d", keywords: ["cita", "agendar"], position: 0, active: false },
  ];

  it("ordena por coincidencias, luego posicion y luego id; excluye inactivas", () => {
    expect(searchEntries(entries, "Quiero agendar una cita", 3).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("respeta el maximo de resultados", () => {
    expect(searchEntries(entries, "cita", 1).map((e) => e.id)).toEqual(["a"]);
  });

  it("sin coincidencias o sin tokens no devuelve nada", () => {
    expect(searchEntries(entries, "parqueadero", 3)).toEqual([]);
    expect(searchEntries(entries, "¿de la?", 3)).toEqual([]);
  });
});

describe("alta-chatbot: entradas de ejemplo", () => {
  it("son tres y ya estan validadas y normalizadas", () => {
    expect(DEFAULT_KNOWLEDGE_ENTRIES).toHaveLength(3);
    for (const entry of DEFAULT_KNOWLEDGE_ENTRIES) {
      expect(parseEntryDraft(entry)).toEqual(entry);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/knowledge.test.ts`
Expected: FAIL: no se resuelve el módulo.

- [ ] **Step 3: Write `normalize.ts`**

```ts
/** Palabras vacias en espanol: no ayudan a distinguir una entrada de otra. */
const STOPWORDS = new Set([
  "a", "al", "como", "con", "cual", "cuales", "cuando", "de", "del", "donde", "el", "en",
  "es", "hay", "la", "las", "lo", "los", "me", "mi", "o", "para", "por", "puedo", "que",
  "quiero", "se", "su", "sus", "te", "tu", "un", "una", "y",
]);

/**
 * Normalizacion determinista para buscar en la KB: minusculas, sin diacriticos, todo lo
 * que no sea alfanumerico a espacio, sin stopwords y sin duplicados (en orden de aparicion).
 */
export function normalizeTokens(text: string): string[] {
  const plain = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ");
  const tokens = plain.split(" ").filter((token) => token !== "" && !STOPWORDS.has(token));
  return [...new Set(tokens)];
}
```

> Biome puede reordenar el `Set` en una lista por línea; acepta el formato que deje `npm run lint -- --write`.

- [ ] **Step 4: Write `knowledge-entry.ts`**

```ts
import { asRecord, requiredText } from "@/modules/shared/domain/input";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { normalizeTokens } from "./normalize";

export const KNOWLEDGE_LIMITS = {
  category: 60,
  question: 200,
  answer: 1000,
  detail: 4000,
  keywords: 20,
  position: 100_000,
  entriesPerTenant: 500,
} as const;

export type KnowledgeEntryDraft = {
  readonly category: string;
  readonly question: string;
  readonly answer: string;
  readonly detail: string | null;
  readonly keywords: readonly string[];
  readonly position: number;
  readonly active: boolean;
};

export type KnowledgeEntry = KnowledgeEntryDraft & {
  readonly id: string;
  readonly tenantId: TenantId;
};

type RawDraft = Record<keyof KnowledgeEntryDraft, unknown>;

const FIELDS: readonly (keyof KnowledgeEntryDraft)[] = [
  "category",
  "question",
  "answer",
  "detail",
  "keywords",
  "position",
  "active",
];

export function parseEntryDraft(raw: unknown): KnowledgeEntryDraft {
  const data = asRecord(raw, "body");
  return validateDraft({
    category: data.category,
    question: data.question,
    answer: data.answer,
    detail: data.detail ?? null,
    keywords: data.keywords ?? [],
    position: data.position ?? 0,
    active: data.active ?? true,
  });
}

/** Parche parcial: lo ausente conserva el valor actual y el resultado se revalida entero. */
export function mergeEntryPatch(existing: KnowledgeEntryDraft, raw: unknown): KnowledgeEntryDraft {
  const data = asRecord(raw, "body");
  const merged = Object.fromEntries(
    FIELDS.map((field) => [field, Object.hasOwn(data, field) ? data[field] : existing[field]]),
  ) as RawDraft;
  return validateDraft(merged);
}

function validateDraft(raw: RawDraft): KnowledgeEntryDraft {
  return {
    category: requiredText(raw.category, "category", KNOWLEDGE_LIMITS.category),
    question: requiredText(raw.question, "question", KNOWLEDGE_LIMITS.question),
    answer: requiredText(raw.answer, "answer", KNOWLEDGE_LIMITS.answer),
    detail: raw.detail === null ? null : requiredText(raw.detail, "detail", KNOWLEDGE_LIMITS.detail),
    keywords: keywordsOf(raw.keywords),
    position: positionOf(raw.position),
    active: booleanOf(raw.active, "active"),
  };
}

function keywordsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError("keywords debe ser una lista de textos", { field: "keywords" });
  }
  const tokens = [...new Set(value.flatMap((item: string) => normalizeTokens(item)))];
  if (tokens.length > KNOWLEDGE_LIMITS.keywords) {
    throw new ValidationError(`keywords admite como maximo ${KNOWLEDGE_LIMITS.keywords}`, {
      field: "keywords",
      max: KNOWLEDGE_LIMITS.keywords,
    });
  }
  return tokens;
}

function positionOf(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > KNOWLEDGE_LIMITS.position) {
    throw new ValidationError(`position debe ser un entero entre 0 y ${KNOWLEDGE_LIMITS.position}`, {
      field: "position",
    });
  }
  return value as number;
}

function booleanOf(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} debe ser booleano`, { field });
  }
  return value;
}
```

- [ ] **Step 5: Write `search.ts` and `default-entries.ts`**

`backend/src/modules/knowledge/domain/search.ts`:

```ts
import type { KnowledgeEntry } from "./knowledge-entry";
import { normalizeTokens } from "./normalize";

type Searchable = Pick<KnowledgeEntry, "id" | "keywords" | "position" | "active">;

/**
 * Busqueda determinista (sin IA): score = tokens de la consulta presentes en las keywords.
 * Solo entradas activas con score > 0; orden score desc, position asc, id asc.
 */
export function searchEntries<T extends Searchable>(
  entries: readonly T[],
  query: string,
  maxResults: number,
): T[] {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) {
    return [];
  }
  return entries
    .filter((entry) => entry.active)
    .map((entry) => ({ entry, score: tokens.filter((t) => entry.keywords.includes(t)).length }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.position - b.entry.position ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, maxResults)
    .map(({ entry }) => entry);
}
```

`backend/src/modules/knowledge/domain/default-entries.ts`:

```ts
import type { KnowledgeEntryDraft } from "./knowledge-entry";

/** Entradas que recibe un tenant recien dado de alta; la clinica las edita. */
export const DEFAULT_KNOWLEDGE_ENTRIES: readonly KnowledgeEntryDraft[] = [
  {
    category: "Información general",
    question: "¿Cuál es el horario de atención?",
    answer: "Edita esta respuesta con el horario de atención de tu clínica.",
    detail: null,
    keywords: ["horario", "hora", "atencion", "abierto"],
    position: 0,
    active: true,
  },
  {
    category: "Información general",
    question: "¿Dónde están ubicados?",
    answer: "Edita esta respuesta con la dirección de tu clínica.",
    detail: null,
    keywords: ["ubicacion", "direccion", "sede", "llegar"],
    position: 1,
    active: true,
  },
  {
    category: "Citas",
    question: "¿Cómo agendo una cita?",
    answer: "Puedes solicitar una cita desde este chat. Te pediremos tu documento para identificarte.",
    detail: null,
    keywords: ["agendar", "cita", "citas", "reservar", "turno"],
    position: 0,
    active: true,
  },
];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/knowledge.test.ts tests/fronteras.test.ts`
Expected: PASS. Si la primera prueba de normalización falla por un token, revisa que `cual`, `es`, `el` y `de` estén en `STOPWORDS`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/knowledge/domain backend/tests/dominio/knowledge.test.ts
git commit -m "feat(knowledge): entradas de la KB, normalizacion y busqueda por tokens"
```

---
### Task 6: Emisor de tokens y bloqueo de `token:dev` en producción

**Files:**
- Create: `backend/src/modules/auth/domain/ports/token-issuer.ts`
- Create: `backend/src/modules/auth/infrastructure/jose-token-issuer.ts`
- Modify: `backend/scripts/token-dev.ts`
- Test: `backend/tests/roles.test.ts`

**Interfaces:**
- Consumes: `JwtSettings` de `backend/src/modules/auth/infrastructure/jose-token-verifier.ts`; `createJoseTokenVerifier`.
- Produces:
  - `type IssueTokenInput = { subject: string; tenantId: string; role: Role; sessionId?: string; issuedAt: Date; expiresAt: Date }`
  - `type TokenIssuer = { issue(input: IssueTokenInput): Promise<string> }`
  - `createJoseTokenIssuer(settings: JwtSettings): TokenIssuer`

- [ ] **Step 1: Write the failing test**

Añade a `backend/tests/roles.test.ts` (imports: `createJoseTokenIssuer` de `@/modules/auth/infrastructure/jose-token-issuer`, `createJoseTokenVerifier` de `@/modules/auth/infrastructure/jose-token-verifier`, y `TEST_JWT` de `./helpers/token`):

```ts
describe("roles: emision de tokens", () => {
  const issuer = createJoseTokenIssuer(TEST_JWT);
  const verifier = createJoseTokenVerifier(TEST_JWT);

  it("un token emitido lo acepta el verificador con los mismos claims", async () => {
    const now = new Date();
    const token = await issuer.issue({
      subject: "ana@clinica",
      tenantId: "tenant-a",
      role: "admin",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(await verifier.verify(token)).toEqual({
      subject: "ana@clinica",
      tenantId: "tenant-a",
      role: "admin",
    });
  });

  it("el token de widget lleva su sesion", async () => {
    const now = new Date();
    const token = await issuer.issue({
      subject: "widget:s-1",
      tenantId: "tenant-a",
      role: "widget",
      sessionId: "s-1",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect((await verifier.verify(token)).sessionId).toBe("s-1");
  });

  it("un token ya vencido no se acepta", async () => {
    const past = new Date(Date.now() - 120_000);
    const token = await issuer.issue({
      subject: "ana",
      tenantId: "tenant-a",
      role: "operator",
      issuedAt: past,
      expiresAt: new Date(past.getTime() + 60_000),
    });
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/roles.test.ts`
Expected: FAIL: no se resuelve `jose-token-issuer`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/modules/auth/domain/ports/token-issuer.ts`:

```ts
import type { Role } from "../role";

export type IssueTokenInput = {
  readonly subject: string;
  readonly tenantId: string;
  readonly role: Role;
  /** Solo para el rol `widget`. */
  readonly sessionId?: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
};

/** Puerto de emision. Firma y algoritmo son detalle del adaptador. */
export type TokenIssuer = {
  issue(input: IssueTokenInput): Promise<string>;
};
```

`backend/src/modules/auth/infrastructure/jose-token-issuer.ts`:

```ts
import { SignJWT } from "jose";
import type { TokenIssuer } from "../domain/ports/token-issuer";
import type { JwtSettings } from "./jose-token-verifier";

const toSeconds = (instant: Date) => Math.floor(instant.getTime() / 1000);

/** Adaptador: firma HS256 con los mismos emisor y audiencia que exige el verificador. */
export function createJoseTokenIssuer(settings: JwtSettings): TokenIssuer {
  const key = new TextEncoder().encode(settings.secret);

  return {
    async issue(input) {
      const claims: Record<string, string> = { tenant_id: input.tenantId, role: input.role };
      if (input.sessionId) {
        claims.session_id = input.sessionId;
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(input.subject)
        .setIssuer(settings.issuer)
        .setAudience(settings.audience)
        .setIssuedAt(toSeconds(input.issuedAt))
        .setExpirationTime(toSeconds(input.expiresAt))
        .sign(key);
    },
  };
}
```

En `backend/scripts/token-dev.ts`, justo después de `const config = loadConfig();`:

```ts
  if (config.nodeEnv === "production") {
    process.stderr.write(
      "token:dev no se usa en produccion: emite tokens con POST /api/platform/v1/tokens\n",
    );
    process.exit(1);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix backend exec vitest run --project unit tests/roles.test.ts tests/fronteras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/auth/domain/ports/token-issuer.ts backend/src/modules/auth/infrastructure/jose-token-issuer.ts backend/scripts/token-dev.ts backend/tests/roles.test.ts
git commit -m "feat(auth): emisor de tokens HS256; token:dev bloqueado en produccion"
```

---

### Task 7: Repositorios Prisma de `bot-config`, claves y KB

**Files:**
- Create: `backend/src/modules/shared/infrastructure/prisma-errors.ts`
- Modify: `backend/src/modules/shared/infrastructure/prisma-idempotency-store.ts` (usa `isUniqueViolation`)
- Create: `backend/src/modules/bot-config/domain/ports/repositories.ts`
- Create: `backend/src/modules/bot-config/infrastructure/prisma-bot-config-repository.ts`
- Create: `backend/src/modules/bot-config/infrastructure/prisma-widget-key-repository.ts`
- Create: `backend/src/modules/knowledge/domain/ports/knowledge-repository.ts`
- Create: `backend/src/modules/knowledge/infrastructure/prisma-knowledge-repository.ts`
- Modify: `backend/tests/db/support.ts` (añade `insertChatbotTenant`)
- Test: `backend/tests/db/conocimiento-config-repos.test.ts`

**Interfaces:**
- Consumes: `BotConfigOverrides`, `sanitizeOverrides` (Task 3); `WidgetKey`, `KeyRetirement` (Task 4); `KnowledgeEntry` (Task 5).
- Produces:
  - `isUniqueViolation(error: unknown): boolean`
  - `type BotConfigRepository = { get(tenantId: TenantId): Promise<BotConfigOverrides | null>; create(tenantId: TenantId, overrides: BotConfigOverrides): Promise<void>; update(tenantId: TenantId, overrides: BotConfigOverrides): Promise<boolean> }`
  - `type WidgetKeyRepository = { listAccepted(tenantId: TenantId, now: Date): Promise<WidgetKey[]>; findByKey(key: string): Promise<WidgetKey | null>; insert(key: WidgetKey): Promise<void>; retire(tenantId: TenantId, retirement: KeyRetirement): Promise<void> }`. `insert` lanza `ConflictError` si ya hay una vigente.
  - `type KnowledgeListFilter = { tenantId: TenantId; category?: string; active?: boolean; cursor?: string | null; limit: number }`
  - `type KnowledgeRepository = { list(filter): Promise<Page<KnowledgeEntry>>; get(tenantId, id): Promise<KnowledgeEntry | null>; count(tenantId): Promise<number>; create(entry: KnowledgeEntry): Promise<KnowledgeEntry>; update(entry: KnowledgeEntry): Promise<KnowledgeEntry | null>; delete(tenantId, id): Promise<boolean> }`
  - `createPrismaBotConfigRepository(db: PrismaExecutor)`, `createPrismaWidgetKeyRepository(db: PrismaExecutor)`, `createPrismaKnowledgeRepository(db: PrismaExecutor)`
  - En tests: `insertChatbotTenant(prisma, slug, options?: { allowedOrigins?: string[] }): Promise<{ tenantId: string; widgetKey: string }>`

- [ ] **Step 1: Add the test helper**

Al final de `backend/tests/db/support.ts`:

```ts
export type ChatbotTenantSeed = { readonly tenantId: string; readonly widgetKey: string };

/** Tenant con bot-config vacio y una clave vigente, como lo deja el alta. */
export async function insertChatbotTenant(
  prisma: PrismaClient,
  slug: string,
  options: { allowedOrigins?: string[] } = {},
): Promise<ChatbotTenantSeed> {
  const tenantId = await insertTenant(prisma, slug);
  const widgetKey = `wk_${slug.repeat(43).slice(0, 43)}`;
  await prisma.botConfig.create({
    data: { tenantId, allowedOrigins: options.allowedOrigins ?? [] },
  });
  await prisma.widgetKey.create({
    data: { id: `${tenantId}-key`, tenantId, key: widgetKey, createdAt: new Date() },
  });
  return { tenantId, widgetKey };
}
```

(El `slug` de las pruebas usa solo letras minúsculas, que son base64url válido.)

- [ ] **Step 2: Write the failing test**

`backend/tests/db/conocimiento-config-repos.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaBotConfigRepository } from "@/modules/bot-config/infrastructure/prisma-bot-config-repository";
import { createPrismaWidgetKeyRepository } from "@/modules/bot-config/infrastructure/prisma-widget-key-repository";
import type { KnowledgeEntry } from "@/modules/knowledge/domain/knowledge-entry";
import { createPrismaKnowledgeRepository } from "@/modules/knowledge/infrastructure/prisma-knowledge-repository";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const configs = createPrismaBotConfigRepository(prisma);
const keys = createPrismaWidgetKeyRepository(prisma);
const knowledge = createPrismaKnowledgeRepository(prisma);
const NOW = new Date("2026-09-22T12:00:00.000Z");

function entry(tenantId: TenantId, id: string, category: string, position: number): KnowledgeEntry {
  return {
    id,
    tenantId,
    category,
    question: `Pregunta ${id}`,
    answer: `Respuesta ${id}`,
    detail: null,
    keywords: ["cita"],
    position,
    active: true,
  };
}

describe("conocimiento-config: repositorios Prisma", () => {
  let tenantA: TenantId;
  let tenantB: TenantId;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantA = toTenantId((await insertChatbotTenant(prisma, "a")).tenantId);
    tenantB = toTenantId((await insertChatbotTenant(prisma, "b")).tenantId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bot-config ida y vuelta, y un tenant inexistente devuelve null", async () => {
    const overrides = {
      texts: { welcome: "Hola" },
      params: { kb_max_results: 5 },
      allowedOrigins: ["https://a.test"],
    };
    expect(await configs.update(tenantA, overrides)).toBe(true);
    expect(await configs.get(tenantA)).toEqual(overrides);
    expect(await configs.get(tenantB)).toEqual({ texts: {}, params: {}, allowedOrigins: [] });
    expect(await configs.get(toTenantId("tenant-x"))).toBeNull();
    expect(await configs.update(toTenantId("tenant-x"), overrides)).toBe(false);
  });

  it("insertar una segunda clave vigente es un conflicto", async () => {
    await expect(
      keys.insert({
        id: "k-extra",
        tenantId: tenantA,
        key: `wk_${"z".repeat(43)}`,
        createdAt: NOW,
        retiredAt: null,
        graceUntil: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("listAccepted incluye la vigente y la que sigue en gracia, no la vencida", async () => {
    const [current] = await keys.listAccepted(tenantA, NOW);
    await keys.retire(tenantA, {
      id: current?.id ?? "",
      retiredAt: NOW,
      graceUntil: new Date(NOW.getTime() + 3_600_000),
    });
    await keys.insert({
      id: "k-new",
      tenantId: tenantA,
      key: `wk_${"n".repeat(43)}`,
      createdAt: NOW,
      retiredAt: null,
      graceUntil: null,
    });
    expect((await keys.listAccepted(tenantA, NOW)).map((k) => k.id).sort()).toEqual(
      ["k-new", current?.id].sort(),
    );
    const later = new Date(NOW.getTime() + 7_200_000);
    expect((await keys.listAccepted(tenantA, later)).map((k) => k.id)).toEqual(["k-new"]);
    expect((await keys.findByKey(`wk_${"n".repeat(43)}`))?.tenantId).toBe(tenantA);
  });

  it("la KB pagina por categoria, posicion e id, y aisla por tenant", async () => {
    await knowledge.create(entry(tenantA, "e3", "Citas", 1));
    await knowledge.create(entry(tenantA, "e1", "Citas", 0));
    await knowledge.create(entry(tenantA, "e2", "Ubicacion", 0));
    await knowledge.create(entry(tenantB, "eb", "Citas", 0));

    const first = await knowledge.list({ tenantId: tenantA, limit: 2 });
    expect(first.data.map((e) => e.id)).toEqual(["e1", "e3"]);
    const second = await knowledge.list({ tenantId: tenantA, limit: 2, cursor: first.nextCursor });
    expect(second.data.map((e) => e.id)).toEqual(["e2"]);
    expect(second.nextCursor).toBeNull();

    expect(await knowledge.get(tenantA, "eb")).toBeNull();
    expect(await knowledge.count(tenantA)).toBe(3);
    expect(await knowledge.delete(tenantA, "eb")).toBe(false);
    expect(await knowledge.update({ ...entry(tenantA, "eb", "X", 0) })).toBeNull();
  });

  it("la KB filtra por categoria y por activa", async () => {
    await knowledge.create(entry(tenantA, "e1", "Citas", 0));
    await knowledge.create({ ...entry(tenantA, "e2", "Citas", 1), active: false });
    await knowledge.create(entry(tenantA, "e3", "Ubicacion", 0));

    const citas = await knowledge.list({ tenantId: tenantA, category: "Citas", limit: 50 });
    expect(citas.data.map((e) => e.id)).toEqual(["e1", "e2"]);
    const activas = await knowledge.list({ tenantId: tenantA, active: true, limit: 50 });
    expect(activas.data.map((e) => e.id)).toEqual(["e1", "e3"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/conocimiento-config-repos.test.ts`
Expected: FAIL: no se resuelven los repositorios.

- [ ] **Step 4: Write `prisma-errors.ts` and reuse it**

`backend/src/modules/shared/infrastructure/prisma-errors.ts`:

```ts
import { Prisma } from "@prisma/client";

/** Violacion de restriccion unica (P2002). La traduce cada adaptador a su error de dominio. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
```

En `prisma-idempotency-store.ts`, sustituye la constante `UNIQUE_VIOLATION` y la condición del `catch` por `if (isUniqueViolation(error)) { throw new IdempotencyKeyTakenError(); }`, importando `isUniqueViolation` de `./prisma-errors`. Deja el import de `Prisma` solo si sigue usándose (para `Prisma.InputJsonValue`).

- [ ] **Step 5: Write the ports**

`backend/src/modules/bot-config/domain/ports/repositories.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { BotConfigOverrides } from "../bot-config";
import type { KeyRetirement, WidgetKey } from "../widget-key";

/** `null` / `false` significan que el tenant no tiene bot-config (no existe). */
export type BotConfigRepository = {
  get(tenantId: TenantId): Promise<BotConfigOverrides | null>;
  create(tenantId: TenantId, overrides: BotConfigOverrides): Promise<void>;
  update(tenantId: TenantId, overrides: BotConfigOverrides): Promise<boolean>;
};

export type WidgetKeyRepository = {
  /** Vigente y en gracia a `now`, la mas reciente primero. */
  listAccepted(tenantId: TenantId, now: Date): Promise<WidgetKey[]>;
  findByKey(key: string): Promise<WidgetKey | null>;
  /** Lanza `ConflictError` si el tenant ya tiene una clave vigente. */
  insert(key: WidgetKey): Promise<void>;
  retire(tenantId: TenantId, retirement: KeyRetirement): Promise<void>;
};
```

`backend/src/modules/knowledge/domain/ports/knowledge-repository.ts`:

```ts
import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { KnowledgeEntry } from "../knowledge-entry";

export type KnowledgeListFilter = {
  readonly tenantId: TenantId;
  readonly category?: string;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limit: number;
};

/** Orden estable: category, position, id. `null` / `false` = no existe en ese tenant. */
export type KnowledgeRepository = {
  list(filter: KnowledgeListFilter): Promise<Page<KnowledgeEntry>>;
  get(tenantId: TenantId, id: string): Promise<KnowledgeEntry | null>;
  count(tenantId: TenantId): Promise<number>;
  create(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  update(entry: KnowledgeEntry): Promise<KnowledgeEntry | null>;
  delete(tenantId: TenantId, id: string): Promise<boolean>;
};
```

- [ ] **Step 6: Write the bot-config adapters**

`backend/src/modules/bot-config/infrastructure/prisma-bot-config-repository.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { type BotConfigOverrides, sanitizeOverrides } from "../domain/bot-config";
import type { BotConfigRepository } from "../domain/ports/repositories";

function toData(overrides: BotConfigOverrides) {
  return {
    texts: overrides.texts as Prisma.InputJsonObject,
    params: overrides.params as Prisma.InputJsonObject,
    allowedOrigins: [...overrides.allowedOrigins],
  };
}

export function createPrismaBotConfigRepository(db: PrismaExecutor): BotConfigRepository {
  return {
    async get(tenantId) {
      const row = await db.botConfig.findUnique({ where: { tenantId } });
      if (!row) {
        return null;
      }
      return sanitizeOverrides({
        texts: row.texts,
        params: row.params,
        allowedOrigins: row.allowedOrigins,
      });
    },
    async create(tenantId, overrides) {
      await db.botConfig.create({ data: { tenantId, ...toData(overrides) } });
    },
    async update(tenantId, overrides) {
      const result = await db.botConfig.updateMany({ where: { tenantId }, data: toData(overrides) });
      return result.count > 0;
    },
  };
}
```

`backend/src/modules/bot-config/infrastructure/prisma-widget-key-repository.ts`:

```ts
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import type { WidgetKeyRepository } from "../domain/ports/repositories";
import type { WidgetKey } from "../domain/widget-key";

type Row = {
  id: string;
  tenantId: string;
  key: string;
  createdAt: Date;
  retiredAt: Date | null;
  graceUntil: Date | null;
};

function mapKey(row: Row): WidgetKey {
  return { ...row, tenantId: toTenantId(row.tenantId) };
}

export function createPrismaWidgetKeyRepository(db: PrismaExecutor): WidgetKeyRepository {
  return {
    async listAccepted(tenantId, now) {
      const rows = await db.widgetKey.findMany({
        where: { tenantId, OR: [{ retiredAt: null }, { graceUntil: { gt: now } }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(mapKey);
    },
    async findByKey(key) {
      const row = await db.widgetKey.findUnique({ where: { key } });
      return row ? mapKey(row) : null;
    },
    async insert(key) {
      try {
        await db.widgetKey.create({ data: { ...key } });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("El tenant ya tiene una clave de widget vigente");
        }
        throw error;
      }
    },
    async retire(tenantId, retirement) {
      await db.widgetKey.updateMany({
        where: { tenantId, id: retirement.id },
        data: { retiredAt: retirement.retiredAt, graceUntil: retirement.graceUntil },
      });
    },
  };
}
```

- [ ] **Step 7: Write the KB adapter**

`backend/src/modules/knowledge/infrastructure/prisma-knowledge-repository.ts`:

```ts
import { decodeCursor, toPage } from "@/modules/shared/domain/pagination";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { KnowledgeEntry } from "../domain/knowledge-entry";
import type { KnowledgeRepository } from "../domain/ports/knowledge-repository";

type Row = Omit<KnowledgeEntry, "tenantId"> & { tenantId: string; createdAt: Date; updatedAt: Date };

function mapEntry(row: Row): KnowledgeEntry {
  return {
    id: row.id,
    tenantId: toTenantId(row.tenantId),
    category: row.category,
    question: row.question,
    answer: row.answer,
    detail: row.detail,
    keywords: row.keywords,
    position: row.position,
    active: row.active,
  };
}

function toData(entry: KnowledgeEntry) {
  return {
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    detail: entry.detail,
    keywords: [...entry.keywords],
    position: entry.position,
    active: entry.active,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** La clave de orden del cursor es `[category, position]`. */
function parseSortKey(key: string): [string, number] {
  const parsed = safeJson(key);
  if (Array.isArray(parsed) && typeof parsed[0] === "string" && Number.isInteger(parsed[1])) {
    return [parsed[0], parsed[1] as number];
  }
  throw new ValidationError("cursor invalido", { field: "cursor" });
}

function afterCursor(cursor: string | null | undefined) {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  const [category, order] = parseSortKey(position.key);
  return {
    OR: [
      { category: { gt: category } },
      { category, position: { gt: order } },
      { category, position: order, id: { gt: position.id } },
    ],
  };
}

export function createPrismaKnowledgeRepository(db: PrismaExecutor): KnowledgeRepository {
  async function get(tenantId: string, id: string) {
    const row = await db.knowledgeEntry.findFirst({ where: { tenantId, id } });
    return row ? mapEntry(row) : null;
  }

  return {
    async list(filter) {
      const rows = await db.knowledgeEntry.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.category !== undefined ? { category: filter.category } : {}),
          ...(filter.active !== undefined ? { active: filter.active } : {}),
          ...afterCursor(filter.cursor),
        },
        orderBy: [{ category: "asc" }, { position: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return toPage(rows.map(mapEntry), filter.limit, (entry) => ({
        key: JSON.stringify([entry.category, entry.position]),
        id: entry.id,
      }));
    },
    get,
    count: (tenantId) => db.knowledgeEntry.count({ where: { tenantId } }),
    async create(entry) {
      const row = await db.knowledgeEntry.create({
        data: { id: entry.id, tenantId: entry.tenantId, ...toData(entry) },
      });
      return mapEntry(row);
    },
    async update(entry) {
      const result = await db.knowledgeEntry.updateMany({
        where: { tenantId: entry.tenantId, id: entry.id },
        data: toData(entry),
      });
      return result.count === 0 ? null : get(entry.tenantId, entry.id);
    },
    async delete(tenantId, id) {
      const result = await db.knowledgeEntry.deleteMany({ where: { tenantId, id } });
      return result.count > 0;
    },
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix backend exec vitest run --project db tests/db/conocimiento-config-repos.test.ts tests/db/idempotencia-store.test.ts`
Expected: PASS (la suite de idempotencia confirma que el refactor de `isUniqueViolation` no rompió nada).
Run: `npm --prefix backend run typecheck`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/shared/infrastructure/prisma-errors.ts backend/src/modules/shared/infrastructure/prisma-idempotency-store.ts backend/src/modules/bot-config/domain/ports/repositories.ts backend/src/modules/bot-config/infrastructure/prisma-bot-config-repository.ts backend/src/modules/bot-config/infrastructure/prisma-widget-key-repository.ts backend/src/modules/knowledge/domain/ports backend/src/modules/knowledge/infrastructure backend/tests/db/support.ts backend/tests/db/conocimiento-config-repos.test.ts
git commit -m "feat(db): repositorios Prisma de bot-config, claves del widget y KB"
```

---

### Task 8: `/bot-config` y rotación de clave

**Files:**
- Modify: `backend/src/modules/shared/domain/audit-event.ts` (añade `AuditActor`)
- Create: `backend/src/modules/bot-config/application/bot-config.ts`
- Create: `backend/src/modules/bot-config/application/widget-keys.ts`
- Create: `backend/src/http/openapi-shared.ts` (extraído de `openapi.ts`)
- Create: `backend/src/http/openapi-paths-chatbot.ts`
- Modify: `backend/src/http/openapi.ts`
- Create: `backend/src/http/serializers-chatbot.ts`
- Modify: `backend/src/composition-root.ts`
- Create: `backend/src/app/api/v1/bot-config/route.ts`
- Create: `backend/src/app/api/v1/bot-config/widget-keys/rotate/route.ts`
- Regenerate: `backend/openapi.json`
- Test: `backend/tests/db/conocimiento-config-http.test.ts`, `backend/tests/db/aislamiento-tenant.test.ts`

**Interfaces:**
- Consumes: repositorios (Task 7), `applyPatch`, `effectiveConfig`, `parseBotConfigPatch` (Task 3), `planRotation`, `splitKeys` (Task 4), `cryptoWidgetKeyGenerator`.
- Produces:
  - `type AuditActor = { actorSubject: string; actorRole: string; requestId: string }` en `shared/domain/audit-event.ts`
  - `type BotConfigView = { config: EffectiveBotConfig; currentKey: WidgetKey | null; graceKey: WidgetKey | null }`
  - `createGetBotConfig(deps: { configs; keys; clock }): (tenantId: TenantId) => Promise<BotConfigView>`
  - `createUpdateBotConfig(deps: { configs; keys; audit; clock; originPolicy }): (input: { tenantId: TenantId; patch: BotConfigPatch } & AuditActor) => Promise<BotConfigView>`
  - `createRotateWidgetKey(deps: { configs; keys; generator; ids; audit; clock }): (input: { tenantId: TenantId } & AuditActor) => Promise<BotConfigView>`
  - `openapi-shared.ts` exporta: `REQUEST_ID_PARAMETER`, `REQUEST_ID_RESPONSE_HEADER`, `IDEMPOTENCY_PARAMETER`, `errorResponses`, `pageParams`, `okJson`, `createdJson`, `authErrors`, `writeErrors`, `ERROR_SCHEMA`, `PAGE_SCHEMA`
  - `serializers-chatbot.ts` exporta `botConfigJson(view: BotConfigView)`
  - `composition-root.ts`: `WritePorts` gana `botConfigs`, `widgetKeys`, `updateBotConfig`, `rotateWidgetKey`; `Container` gana `getBotConfig`. Se introduce `originPolicyOf(config: AppConfig): OriginPolicy`.

- [ ] **Step 1: Write the failing test**

`backend/tests/db/conocimiento-config-http.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getBotConfig, PATCH as patchBotConfig } from "@/app/api/v1/bot-config/route";
import { POST as rotateKey } from "@/app/api/v1/bot-config/widget-keys/rotate/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/token";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const CONFIG_URL = "http://localhost/api/v1/bot-config";
const ROTATE_URL = "http://localhost/api/v1/bot-config/widget-keys/rotate";
const HOUR = 3_600_000;
let keySeq = 0;

function write(url: string, token: string, body?: unknown, key = `k-${++keySeq}`, method = "PATCH") {
  return authedRequest(url, token, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("conocimiento-config: /bot-config", () => {
  let seed: ChatbotTenantSeed;
  let admin: string;
  let operator: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: ["https://clinica-a.test"] });
    admin = await signToken({ role: "admin", tenantId: seed.tenantId, subject: "admin-a" });
    operator = await signToken({ role: "operator", tenantId: seed.tenantId });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("GET devuelve predeterminados, origenes y la clave vigente", async () => {
    const response = await getBotConfig(authedRequest(CONFIG_URL, operator));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.texts.welcome.overridden).toBe(false);
    expect(body.params.widget_session_ttl_minutes).toBe(30);
    expect(body.allowed_origins).toEqual(["https://clinica-a.test"]);
    expect(body.widget_keys.current.key).toBe(seed.widgetKey);
    expect(body.widget_keys.grace).toBeNull();
  });

  it("PATCH sobrescribe texto y param y audita sin valores", async () => {
    const response = await patchBotConfig(
      write(CONFIG_URL, admin, {
        texts: { welcome: "Bienvenidos a {clinic_name}" },
        params: { widget_session_ttl_minutes: 60 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.texts.welcome).toEqual({ value: "Bienvenidos a {clinic_name}", overridden: true });
    expect(body.params.widget_session_ttl_minutes).toBe(60);

    const events = await prisma.auditEvent.findMany();
    expect(events.map((event) => event.action)).toEqual(["bot_config.updated"]);
    expect(JSON.stringify(events)).not.toContain("Bienvenidos");
  });

  it("PATCH con null devuelve el texto al predeterminado", async () => {
    await patchBotConfig(write(CONFIG_URL, admin, { texts: { welcome: "Hola" } }));
    const response = await patchBotConfig(write(CONFIG_URL, admin, { texts: { welcome: null } }));
    expect((await response.json()).texts.welcome.overridden).toBe(false);
  });

  it("PATCH normaliza los origenes a minusculas", async () => {
    const response = await patchBotConfig(
      write(CONFIG_URL, admin, { allowed_origins: ["https://Clinica-A.test"] }),
    );
    expect((await response.json()).allowed_origins).toEqual(["https://clinica-a.test"]);
  });

  it.each([
    [{ texts: { despedida: "Chao" } }, "texts.despedida"],
    [{ params: { kb_max_results: 0 } }, "params.kb_max_results"],
    [{ texts: { welcome: "Hola {paciente}" } }, "texts.welcome"],
    [{ colores: {} }, "colores"],
    [{ allowed_origins: ["http://clinica.test"] }, "allowed_origins.0"],
  ])("PATCH %j responde 422 con el campo", async (payload, field) => {
    const response = await patchBotConfig(write(CONFIG_URL, admin, payload));
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error.details.field).toBe(field);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("operator no escribe y widget no lee", async () => {
    const denied = await patchBotConfig(write(CONFIG_URL, operator, { texts: { welcome: "x" } }));
    expect(denied.status).toBe(403);

    const widget = await signToken({ role: "widget", tenantId: seed.tenantId, sessionId: "s-1" });
    expect((await getBotConfig(authedRequest(CONFIG_URL, widget))).status).toBe(403);
  });

  it("rotar deja la nueva vigente y la anterior en gracia 24 h", async () => {
    const before = Date.now();
    const response = await rotateKey(write(ROTATE_URL, admin, undefined, "rot-1", "POST"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.widget_keys.current.key).toMatch(/^wk_[A-Za-z0-9_-]{43}$/);
    expect(body.widget_keys.current.key).not.toBe(seed.widgetKey);
    expect(body.widget_keys.grace.key).toBe(seed.widgetKey);
    const graceUntil = new Date(body.widget_keys.grace.grace_until).getTime();
    expect(graceUntil).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(graceUntil).toBeLessThanOrEqual(Date.now() + 24 * HOUR);
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual(["widget_key.rotated"]);
  });

  it("rotar dos veces mata la que estaba en gracia", async () => {
    await rotateKey(write(ROTATE_URL, admin, undefined, "rot-1", "POST"));
    const second = await (await rotateKey(write(ROTATE_URL, admin, undefined, "rot-2", "POST"))).json();

    expect(second.widget_keys.grace.key).not.toBe(seed.widgetKey);
    const accepted = await prisma.widgetKey.count({
      where: { OR: [{ retiredAt: null }, { graceUntil: { gt: new Date() } }] },
    });
    expect(accepted).toBe(2);
  });

  it("idempotencia: rotar con la misma Idempotency-Key no rota dos veces", async () => {
    const first = await (await rotateKey(write(ROTATE_URL, admin, undefined, "rot-x", "POST"))).json();
    const again = await (await rotateKey(write(ROTATE_URL, admin, undefined, "rot-x", "POST"))).json();
    expect(again).toEqual(first);
    expect(await prisma.widgetKey.count()).toBe(2);
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it("dos rotaciones concurrentes nunca dejan dos claves vigentes", async () => {
    const responses = await Promise.all([
      rotateKey(write(ROTATE_URL, admin, undefined, "rot-c1", "POST")),
      rotateKey(write(ROTATE_URL, admin, undefined, "rot-c2", "POST")),
    ]);
    for (const response of responses) {
      expect([200, 409]).toContain(response.status);
    }
    expect(await prisma.widgetKey.count({ where: { retiredAt: null } })).toBe(1);
  });
});
```

Y añade a `backend/tests/db/aislamiento-tenant.test.ts` (import `GET as getBotConfig, PATCH as patchBotConfig` de `@/app/api/v1/bot-config/route` e `insertChatbotTenant` de `./support`):

```ts
describe("aislamiento-tenant: bot-config", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("cada tenant lee y cambia solo su configuracion", async () => {
    const a = await insertChatbotTenant(prisma, "a");
    const b = await insertChatbotTenant(prisma, "b");
    const adminA = await signToken({ role: "admin", tenantId: a.tenantId });
    const operatorB = await signToken({ role: "operator", tenantId: b.tenantId });

    const patched = await patchBotConfig(
      authedRequest("http://localhost/api/v1/bot-config", adminA, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "iso-1" },
        body: JSON.stringify({ texts: { welcome: "Solo A" } }),
      }),
    );
    expect(patched.status).toBe(200);

    const { body } = await jsonGet(getBotConfig, "http://localhost/api/v1/bot-config", operatorB);
    expect(body.texts.welcome.overridden).toBe(false);
    expect(body.widget_keys.current.key).toBe(b.widgetKey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/conocimiento-config-http.test.ts`
Expected: FAIL: no se resuelve `@/app/api/v1/bot-config/route`.

- [ ] **Step 3: Add `AuditActor`**

Al final de `backend/src/modules/shared/domain/audit-event.ts`:

```ts
/** Quien origina un cambio auditable; los casos de uso lo reciben junto a su entrada. */
export type AuditActor = {
  readonly actorSubject: string;
  readonly actorRole: string;
  readonly requestId: string;
};
```

- [ ] **Step 4: Write the use cases**

`backend/src/modules/bot-config/application/bot-config.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { OriginPolicy } from "../domain/allowed-origins";
import {
  applyPatch,
  type BotConfigOverrides,
  type BotConfigPatch,
  type EffectiveBotConfig,
  effectiveConfig,
} from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import { splitKeys, type WidgetKey } from "../domain/widget-key";

export type BotConfigView = {
  readonly config: EffectiveBotConfig;
  readonly currentKey: WidgetKey | null;
  readonly graceKey: WidgetKey | null;
};

type ReadDeps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly clock: Clock;
};

export async function loadOverrides(configs: BotConfigRepository, tenantId: TenantId) {
  const overrides = await configs.get(tenantId);
  if (!overrides) {
    throw new NotFoundError();
  }
  return overrides;
}

export async function viewOf(
  deps: ReadDeps,
  tenantId: TenantId,
  overrides: BotConfigOverrides,
): Promise<BotConfigView> {
  const { current, grace } = splitKeys(await deps.keys.listAccepted(tenantId, deps.clock.now()));
  return { config: effectiveConfig(overrides), currentKey: current, graceKey: grace };
}

export type GetBotConfig = (tenantId: TenantId) => Promise<BotConfigView>;

export function createGetBotConfig(deps: ReadDeps): GetBotConfig {
  return async (tenantId) => viewOf(deps, tenantId, await loadOverrides(deps.configs, tenantId));
}

export type UpdateBotConfigInput = AuditActor & {
  readonly tenantId: TenantId;
  readonly patch: BotConfigPatch;
};

export type UpdateBotConfig = (input: UpdateBotConfigInput) => Promise<BotConfigView>;

export function createUpdateBotConfig(
  deps: ReadDeps & { readonly audit: AuditLog; readonly originPolicy: OriginPolicy },
): UpdateBotConfig {
  return async (input) => {
    const current = await loadOverrides(deps.configs, input.tenantId);
    const next = applyPatch(current, input.patch, deps.originPolicy);
    await deps.configs.update(input.tenantId, next);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "bot_config.updated",
      resourceType: "bot_config",
      resourceId: input.tenantId,
      requestId: input.requestId,
      occurredAt: deps.clock.now(),
    });
    return viewOf(deps, input.tenantId, next);
  };
}
```

`backend/src/modules/bot-config/application/widget-keys.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { effectiveConfig } from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import type { WidgetKeyGenerator } from "../domain/ports/widget-key-generator";
import { planRotation } from "../domain/widget-key";
import { type BotConfigView, loadOverrides, viewOf } from "./bot-config";

export type RotateWidgetKey = (input: AuditActor & { tenantId: TenantId }) => Promise<BotConfigView>;

type RotateDeps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly generator: WidgetKeyGenerator;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/**
 * La vigente pasa a gracia (`widget_key_grace_hours`) y la que ya estaba en gracia muere.
 * Si otra rotacion gano la carrera, el indice unico parcial hace fallar el insert → 409.
 */
export function createRotateWidgetKey(deps: RotateDeps): RotateWidgetKey {
  return async (input) => {
    const overrides = await loadOverrides(deps.configs, input.tenantId);
    const now = deps.clock.now();
    const graceHours = effectiveConfig(overrides).params.widget_key_grace_hours;
    const accepted = await deps.keys.listAccepted(input.tenantId, now);
    for (const retirement of planRotation(accepted, now, graceHours)) {
      await deps.keys.retire(input.tenantId, retirement);
    }
    const id = deps.ids.next();
    const key = deps.generator.next();
    await deps.keys.insert({
      id,
      tenantId: input.tenantId,
      key,
      createdAt: now,
      retiredAt: null,
      graceUntil: null,
    });
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "widget_key.rotated",
      resourceType: "widget_key",
      resourceId: id,
      requestId: input.requestId,
      occurredAt: now,
    });
    return viewOf(deps, input.tenantId, overrides);
  };
}
```

- [ ] **Step 5: Extract `openapi-shared.ts` without changing the output**

Crea `backend/src/http/openapi-shared.ts` **moviendo** (cortar y pegar, sin cambiar valores) de `openapi.ts` estas constantes y funciones, ahora con `export`: `REQUEST_ID_PARAMETER`, `REQUEST_ID_RESPONSE_HEADER`, `IDEMPOTENCY_PARAMETER`, `errorResponses`, `pageParams`, `okJson`, `authErrors`, `writeErrors`, junto con los imports de `ERROR_CODES`, `STATUS_BY_CODE` y `REQUEST_ID_HEADER` que necesitan. Mueve también los objetos de esquema `Error` y `Page` de `components.schemas` como `export const ERROR_SCHEMA = {...}` y `export const PAGE_SCHEMA = {...}`, y añade:

```ts
export function createdJson(schema: Record<string, unknown>) {
  return {
    "201": {
      description: "Creado",
      headers: REQUEST_ID_RESPONSE_HEADER,
      content: { "application/json": { schema } },
    },
  };
}
```

En `openapi.ts` importa lo movido de `./openapi-shared` y usa `Error: ERROR_SCHEMA` y `Page: PAGE_SCHEMA` en `components.schemas`. `rangeParams` se queda en `openapi.ts`.

Verifica que el refactor no cambió el contrato:
Run: `npm --prefix backend run openapi:generate` y luego `git diff --stat backend/openapi.json`
Expected: sin diferencias.

- [ ] **Step 6: Declare the new paths**

`backend/src/http/openapi-paths-chatbot.ts`:

```ts
import {
  authErrors,
  IDEMPOTENCY_PARAMETER,
  okJson,
  REQUEST_ID_PARAMETER,
  writeErrors,
} from "./openapi-shared";

/** Rutas de /api/v1 de la Fase 3 (config del bot, KB y sesiones del widget). */
const bearer = [{ bearerAuth: [] }];
const nullableKey = { oneOf: [{ $ref: "#/components/schemas/WidgetKey" }, { type: "null" }] };

export const CHATBOT_SCHEMAS = {
  WidgetKey: {
    type: "object",
    required: ["key", "created_at", "grace_until"],
    properties: {
      key: { type: "string" },
      created_at: { type: "string", format: "date-time" },
      grace_until: { type: ["string", "null"], format: "date-time" },
    },
  },
  BotConfig: {
    type: "object",
    required: ["texts", "params", "allowed_origins", "widget_keys"],
    properties: {
      texts: {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["value", "overridden"],
          properties: { value: { type: "string" }, overridden: { type: "boolean" } },
        },
      },
      params: { type: "object", additionalProperties: { type: "integer" } },
      allowed_origins: { type: "array", items: { type: "string" } },
      widget_keys: {
        type: "object",
        required: ["current", "grace"],
        properties: { current: nullableKey, grace: nullableKey },
      },
    },
  },
  BotConfigPatch: {
    type: "object",
    additionalProperties: false,
    properties: {
      texts: { type: "object", additionalProperties: { type: ["string", "null"] } },
      params: { type: "object", additionalProperties: { type: ["integer", "null"] } },
      allowed_origins: { type: "array", maxItems: 20, items: { type: "string" } },
    },
  },
} as const;

const botConfigOk = okJson({ $ref: "#/components/schemas/BotConfig" });

export const CHATBOT_PATHS = {
  "/bot-config": {
    get: {
      operationId: "getBotConfig",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER],
      responses: { ...botConfigOk, ...authErrors },
    },
    patch: {
      operationId: "updateBotConfig",
      description: "Parche parcial. Un texto o param en null vuelve al predeterminado.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/BotConfigPatch" } } },
      },
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
  "/bot-config/widget-keys/rotate": {
    post: {
      operationId: "rotateWidgetKey",
      description:
        "Crea una clave vigente; la anterior queda en gracia widget_key_grace_hours y la que ya " +
        "estaba en gracia deja de valer.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
};
```

En `openapi.ts`: importa `CHATBOT_PATHS` y `CHATBOT_SCHEMAS`; en `components.schemas` añade `...CHATBOT_SCHEMAS` al final; en `paths` añade `...CHATBOT_PATHS` al final; sube `info.version` a `"0.3.0"`.

Run: `npm --prefix backend run openapi:generate`

- [ ] **Step 7: Serializer and routes**

`backend/src/http/serializers-chatbot.ts`:

```ts
import type { BotConfigView } from "@/modules/bot-config/application/bot-config";
import type { WidgetKey } from "@/modules/bot-config/domain/widget-key";

function widgetKeyJson(key: WidgetKey | null) {
  if (!key) {
    return null;
  }
  return {
    key: key.key,
    created_at: key.createdAt.toISOString(),
    grace_until: key.graceUntil?.toISOString() ?? null,
  };
}

export function botConfigJson(view: BotConfigView) {
  return {
    texts: view.config.texts,
    params: view.config.params,
    allowed_origins: view.config.allowedOrigins,
    widget_keys: { current: widgetKeyJson(view.currentKey), grace: widgetKeyJson(view.graceKey) },
  };
}
```

`backend/src/app/api/v1/bot-config/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { botConfigJson } from "@/http/serializers-chatbot";
import { parseBotConfigPatch } from "@/modules/bot-config/domain/bot-config";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor }) =>
  botConfigJson(await getContainer().getBotConfig(actor.tenantId)),
);

export const PATCH = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  const view = await ports.updateBotConfig({
    tenantId: actor.tenantId,
    patch: parseBotConfigPatch(body),
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: botConfigJson(view) };
});
```

`backend/src/app/api/v1/bot-config/widget-keys/rotate/route.ts`:

```ts
import { idempotentRoute } from "@/http/idempotent-route";
import { botConfigJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
  const view = await ports.rotateWidgetKey({
    tenantId: actor.tenantId,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: botConfigJson(view) };
});
```

- [ ] **Step 8: Wire the composition root**

En `backend/src/composition-root.ts`:

1. Renombra el tipo `WritePorts` actual a `BaseWritePorts` y declara
   `export type WritePorts = BaseWritePorts & BotConfigWritePorts;`
   con `type BotConfigWritePorts = ReturnType<typeof botConfigWritePorts>;`.
2. Cambia la firma a `buildWritePorts(db: PrismaExecutor, config: AppConfig): WritePorts`, usa `config.appTimezone` donde antes iba `appTimezone`, y añade al final del objeto devuelto `...botConfigWritePorts(db, config, auditLog)`. Actualiza la llamada en `withWriteTransaction` a `buildWritePorts(tx, config)`.
3. Añade estas funciones (e importa lo que usan):

```ts
function originPolicyOf(config: AppConfig): OriginPolicy {
  return { allowLocalhost: config.nodeEnv !== "production" };
}

function botConfigWritePorts(db: PrismaExecutor, config: AppConfig, auditLog: AuditLog) {
  const botConfigs = createPrismaBotConfigRepository(db);
  const widgetKeys = createPrismaWidgetKeyRepository(db);
  const deps = { configs: botConfigs, keys: widgetKeys, clock: systemClock };
  return {
    botConfigs,
    widgetKeys,
    updateBotConfig: createUpdateBotConfig({
      ...deps,
      audit: auditLog,
      originPolicy: originPolicyOf(config),
    }),
    rotateWidgetKey: createRotateWidgetKey({
      ...deps,
      generator: cryptoWidgetKeyGenerator,
      ids: uuidV7Generator,
      audit: auditLog,
    }),
  };
}

function botConfigReads(prisma: PrismaClient) {
  return {
    getBotConfig: createGetBotConfig({
      configs: createPrismaBotConfigRepository(prisma),
      keys: createPrismaWidgetKeyRepository(prisma),
      clock: systemClock,
    }),
  };
}
```

4. En `Container` añade `readonly getBotConfig: GetBotConfig;` y en `getContainer`, dentro del objeto `container = { ... }`, añade `...botConfigReads(prisma),`.

(`PrismaExecutor` se importa de `./modules/shared/infrastructure/prisma-client`.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix backend exec vitest run --project db tests/db/conocimiento-config-http.test.ts tests/db/aislamiento-tenant.test.ts tests/db/idempotencia-http.test.ts`
Expected: PASS.
Run: `npm --prefix backend exec vitest run --project unit tests/contrato-api.test.ts` y `npm --prefix backend run typecheck`
Expected: PASS y sin errores.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/shared/domain/audit-event.ts backend/src/modules/bot-config/application backend/src/http/openapi-shared.ts backend/src/http/openapi-paths-chatbot.ts backend/src/http/openapi.ts backend/src/http/serializers-chatbot.ts backend/src/composition-root.ts backend/src/app/api/v1/bot-config backend/openapi.json backend/tests/db/conocimiento-config-http.test.ts backend/tests/db/aislamiento-tenant.test.ts
git commit -m "feat(api): GET/PATCH /bot-config y rotacion de la clave del widget"
```

---

### Task 9: `/knowledge-entries`

**Files:**
- Create: `backend/src/modules/knowledge/application/knowledge-entries.ts`
- Create: `backend/src/app/api/v1/knowledge-entries/route.ts`
- Create: `backend/src/app/api/v1/knowledge-entries/[id]/route.ts`
- Modify: `backend/src/http/openapi-paths-chatbot.ts`, `backend/src/http/serializers-chatbot.ts`, `backend/src/composition-root.ts`
- Regenerate: `backend/openapi.json`
- Test: `backend/tests/db/conocimiento-config-http.test.ts`, `backend/tests/db/aislamiento-tenant.test.ts`

**Interfaces:**
- Consumes: `KnowledgeRepository` (Task 7), `parseEntryDraft`, `mergeEntryPatch`, `KNOWLEDGE_LIMITS`, `DEFAULT_KNOWLEDGE_ENTRIES` (Task 5), `AuditActor` (Task 8).
- Produces:
  - `createListKnowledgeEntries(repo)`: `(input: { tenantId; category?: string; active?: boolean; cursor?: string | null; limitRaw?: string | null }) => Promise<Page<KnowledgeEntry>>`
  - `createGetKnowledgeEntry(repo)`: `(tenantId, id) => Promise<KnowledgeEntry>` (lanza `NotFoundError`)
  - `createCreateKnowledgeEntry(deps: { repo; ids; audit; clock })`: `(input: AuditActor & { tenantId; raw: unknown }) => Promise<KnowledgeEntry>`
  - `createUpdateKnowledgeEntry(deps: { repo; audit; clock })`: `(input: AuditActor & { tenantId; id; raw: unknown }) => Promise<KnowledgeEntry>`
  - `createDeleteKnowledgeEntry(deps: { repo; audit; clock })`: `(input: AuditActor & { tenantId; id }) => Promise<void>`
  - `createSeedDefaultKnowledge(deps: { repo; ids })`: `(tenantId: TenantId) => Promise<void>` (lo usa el alta, Task 12)
  - `knowledgeEntryJson(entry: KnowledgeEntry)` en `serializers-chatbot.ts`
  - `WritePorts` gana `createKnowledgeEntry`, `updateKnowledgeEntry`, `deleteKnowledgeEntry`, `knowledge`; `Container` gana `listKnowledgeEntries`, `getKnowledgeEntry`.

- [ ] **Step 1: Write the failing test**

Añade a `backend/tests/db/conocimiento-config-http.test.ts` (imports `GET as listEntries, POST as createEntry` de `@/app/api/v1/knowledge-entries/route` y `GET as getEntry, PATCH as patchEntry, DELETE as deleteEntry` de `@/app/api/v1/knowledge-entries/[id]/route`):

```ts
const KB_URL = "http://localhost/api/v1/knowledge-entries";
const ENTRY = {
  category: "Citas",
  question: "¿Cómo agendo?",
  answer: "Desde este chat.",
  keywords: ["Agendar", "cita médica"],
};

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("conocimiento-config: /knowledge-entries", () => {
  let seed: ChatbotTenantSeed;
  let admin: string;
  let operator: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a");
    admin = await signToken({ role: "admin", tenantId: seed.tenantId });
    operator = await signToken({ role: "operator", tenantId: seed.tenantId });
  });

  async function create(payload: unknown = ENTRY, key = `kb-${++keySeq}`) {
    const response = await createEntry(write(KB_URL, admin, payload, key, "POST"));
    return { response, body: await response.json() };
  }

  it("POST crea con keywords normalizadas, responde 201 y audita", async () => {
    const { response, body } = await create();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ category: "Citas", keywords: ["agendar", "cita", "medica"], active: true });
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual([
      "knowledge_entry.created",
    ]);
  });

  it("idempotencia: POST repetido con la misma clave crea una sola entrada", async () => {
    const first = await create(ENTRY, "kb-same");
    const again = await create(ENTRY, "kb-same");
    expect(again.body).toEqual(first.body);
    expect(await prisma.knowledgeEntry.count()).toBe(1);
  });

  it("GET lista ordenado, filtra y pagina", async () => {
    await create({ ...ENTRY, category: "Ubicacion" });
    await create({ ...ENTRY, position: 2 });
    await create({ ...ENTRY, position: 1, active: false });

    const page1 = await (await listEntries(authedRequest(`${KB_URL}?limit=2`, operator))).json();
    expect(page1.data.map((e: { category: string; position: number }) => [e.category, e.position])).toEqual([
      ["Citas", 1],
      ["Citas", 2],
    ]);
    const page2 = await (
      await listEntries(authedRequest(`${KB_URL}?limit=2&cursor=${page1.next_cursor}`, operator))
    ).json();
    expect(page2.data.map((e: { category: string }) => e.category)).toEqual(["Ubicacion"]);

    const activas = await (await listEntries(authedRequest(`${KB_URL}?active=true&category=Citas`, operator))).json();
    expect(activas.data).toHaveLength(1);
  });

  it("GET con cursor invalido responde 422", async () => {
    const response = await listEntries(authedRequest(`${KB_URL}?cursor=@@`, operator));
    expect(response.status).toBe(422);
  });

  it("PATCH cambia solo lo que trae; invalido responde 422", async () => {
    const { body: created } = await create();
    const patched = await patchEntry(
      write(`${KB_URL}/${created.id}`, admin, { active: false, detail: "Más info" }),
      withId(created.id),
    );
    expect(await patched.json()).toMatchObject({ active: false, detail: "Más info", answer: ENTRY.answer });

    const invalid = await patchEntry(write(`${KB_URL}/${created.id}`, admin, { question: "" }), withId(created.id));
    expect(invalid.status).toBe(422);
  });

  it("DELETE borra; un segundo DELETE con otra clave responde 404", async () => {
    const { body: created } = await create();
    const first = await deleteEntry(write(`${KB_URL}/${created.id}`, admin, undefined, "del-1", "DELETE"), withId(created.id));
    expect(first.status).toBe(200);
    const second = await deleteEntry(write(`${KB_URL}/${created.id}`, admin, undefined, "del-2", "DELETE"), withId(created.id));
    expect(second.status).toBe(404);
    expect((await getEntry(authedRequest(`${KB_URL}/${created.id}`, operator), withId(created.id))).status).toBe(404);
  });

  it("con 500 entradas el alta responde 422", async () => {
    await prisma.knowledgeEntry.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        id: `bulk-${i}`,
        tenantId: seed.tenantId,
        category: "Masivo",
        question: `P${i}`,
        answer: "R",
      })),
    });
    const { response, body } = await create();
    expect(response.status).toBe(422);
    expect(body.error.details).toMatchObject({ max: 500 });
  });

  it("operator lee pero no crea; widget no alcanza la KB", async () => {
    expect((await createEntry(write(KB_URL, operator, ENTRY, "op-1", "POST"))).status).toBe(403);
    expect((await listEntries(authedRequest(KB_URL, operator))).status).toBe(200);
    const widget = await signToken({ role: "widget", tenantId: seed.tenantId, sessionId: "s-1" });
    expect((await listEntries(authedRequest(KB_URL, widget))).status).toBe(403);
  });
});
```

Añade a `backend/tests/db/aislamiento-tenant.test.ts` (imports de las dos rutas de la KB):

```ts
describe("aislamiento-tenant: base de conocimiento", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("una entrada ajena responde 404 al leer, cambiar y borrar, y no aparece en la lista", async () => {
    const a = await insertChatbotTenant(prisma, "a");
    const b = await insertChatbotTenant(prisma, "b");
    await prisma.knowledgeEntry.create({
      data: { id: "entry-b", tenantId: b.tenantId, category: "C", question: "Q", answer: "A" },
    });
    const adminA = await signToken({ role: "admin", tenantId: a.tenantId });
    const url = "http://localhost/api/v1/knowledge-entries/entry-b";
    const ctx = { params: Promise.resolve({ id: "entry-b" }) };
    const writeInit = (method: string, key: string, body?: unknown) => ({
      method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    expect((await getKnowledgeEntry(authedRequest(url, adminA), ctx)).status).toBe(404);
    expect(
      (await patchKnowledgeEntry(authedRequest(url, adminA, writeInit("PATCH", "iso-p", { answer: "x" })), ctx)).status,
    ).toBe(404);
    expect((await deleteKnowledgeEntry(authedRequest(url, adminA, writeInit("DELETE", "iso-d")), ctx)).status).toBe(404);

    const { body } = await jsonGet(listKnowledgeEntries, "http://localhost/api/v1/knowledge-entries", adminA);
    expect(idsOf(body)).toEqual([]);
    expect(await prisma.knowledgeEntry.count({ where: { id: "entry-b", answer: "A" } })).toBe(1);
  });
});
```

(Importa `GET as listKnowledgeEntries` de `@/app/api/v1/knowledge-entries/route` y `GET as getKnowledgeEntry, PATCH as patchKnowledgeEntry, DELETE as deleteKnowledgeEntry` de `@/app/api/v1/knowledge-entries/[id]/route`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/conocimiento-config-http.test.ts`
Expected: FAIL: no se resuelve `@/app/api/v1/knowledge-entries/route`.

- [ ] **Step 3: Write the use cases**

`backend/src/modules/knowledge/application/knowledge-entries.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { DEFAULT_KNOWLEDGE_ENTRIES } from "../domain/default-entries";
import {
  KNOWLEDGE_LIMITS,
  type KnowledgeEntry,
  mergeEntryPatch,
  parseEntryDraft,
} from "../domain/knowledge-entry";
import type { KnowledgeRepository } from "../domain/ports/knowledge-repository";

type WriteDeps = { readonly repo: KnowledgeRepository; readonly audit: AuditLog; readonly clock: Clock };

async function audit(deps: WriteDeps, input: AuditActor & { tenantId: TenantId }, action: string, id: string) {
  await deps.audit.record({
    tenantId: input.tenantId,
    actorSubject: input.actorSubject,
    actorRole: input.actorRole,
    action: `knowledge_entry.${action}`,
    resourceType: "knowledge_entry",
    resourceId: id,
    requestId: input.requestId,
    occurredAt: deps.clock.now(),
  });
}

export type ListKnowledgeInput = {
  readonly tenantId: TenantId;
  readonly category?: string;
  readonly active?: boolean;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

export function createListKnowledgeEntries(repo: KnowledgeRepository) {
  return async (input: ListKnowledgeInput): Promise<Page<KnowledgeEntry>> => {
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return repo.list({ ...input, limit });
  };
}

export function createGetKnowledgeEntry(repo: KnowledgeRepository) {
  return async (tenantId: TenantId, id: string): Promise<KnowledgeEntry> => {
    const entry = await repo.get(tenantId, id);
    if (!entry) {
      throw new NotFoundError();
    }
    return entry;
  };
}

export function createCreateKnowledgeEntry(deps: WriteDeps & { readonly ids: IdGenerator }) {
  return async (input: AuditActor & { tenantId: TenantId; raw: unknown }): Promise<KnowledgeEntry> => {
    const draft = parseEntryDraft(input.raw);
    if ((await deps.repo.count(input.tenantId)) >= KNOWLEDGE_LIMITS.entriesPerTenant) {
      throw new ValidationError(
        `La base de conocimiento admite como maximo ${KNOWLEDGE_LIMITS.entriesPerTenant} entradas`,
        { field: "knowledge_entries", max: KNOWLEDGE_LIMITS.entriesPerTenant },
      );
    }
    const created = await deps.repo.create({ ...draft, id: deps.ids.next(), tenantId: input.tenantId });
    await audit(deps, input, "created", created.id);
    return created;
  };
}

export function createUpdateKnowledgeEntry(deps: WriteDeps) {
  const getEntry = createGetKnowledgeEntry(deps.repo);
  return async (input: AuditActor & { tenantId: TenantId; id: string; raw: unknown }) => {
    const existing = await getEntry(input.tenantId, input.id);
    const updated = await deps.repo.update({ ...existing, ...mergeEntryPatch(existing, input.raw) });
    if (!updated) {
      throw new NotFoundError();
    }
    await audit(deps, input, "updated", input.id);
    return updated;
  };
}

export function createDeleteKnowledgeEntry(deps: WriteDeps) {
  return async (input: AuditActor & { tenantId: TenantId; id: string }): Promise<void> => {
    if (!(await deps.repo.delete(input.tenantId, input.id))) {
      throw new NotFoundError();
    }
    await audit(deps, input, "deleted", input.id);
  };
}

/** Siembra las entradas de ejemplo de un tenant recien dado de alta. */
export function createSeedDefaultKnowledge(deps: { repo: KnowledgeRepository; ids: IdGenerator }) {
  return async (tenantId: TenantId): Promise<void> => {
    for (const draft of DEFAULT_KNOWLEDGE_ENTRIES) {
      await deps.repo.create({ ...draft, id: deps.ids.next(), tenantId });
    }
  };
}
```

- [ ] **Step 4: Serializer, OpenAPI and routes**

En `serializers-chatbot.ts` añade (import `KnowledgeEntry` de `@/modules/knowledge/domain/knowledge-entry`):

```ts
export function knowledgeEntryJson(entry: KnowledgeEntry) {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    detail: entry.detail,
    keywords: [...entry.keywords],
    position: entry.position,
    active: entry.active,
  };
}
```

En `openapi-paths-chatbot.ts` importa también `createdJson` y `pageParams`, y añade a `CHATBOT_SCHEMAS`:

```ts
  KnowledgeEntry: {
    type: "object",
    required: ["id", "category", "question", "answer", "detail", "keywords", "position", "active"],
    properties: {
      id: { type: "string" },
      category: { type: "string", maxLength: 60 },
      question: { type: "string", maxLength: 200 },
      answer: { type: "string", maxLength: 1000 },
      detail: { type: ["string", "null"], maxLength: 4000 },
      keywords: { type: "array", maxItems: 20, items: { type: "string" } },
      position: { type: "integer", minimum: 0 },
      active: { type: "boolean" },
    },
  },
  KnowledgeEntryInput: {
    type: "object",
    properties: {
      category: { type: "string", minLength: 1, maxLength: 60 },
      question: { type: "string", minLength: 1, maxLength: 200 },
      answer: { type: "string", minLength: 1, maxLength: 1000 },
      detail: { type: ["string", "null"], maxLength: 4000 },
      keywords: { type: "array", items: { type: "string" } },
      position: { type: "integer", minimum: 0 },
      active: { type: "boolean" },
    },
  },
```

y a `CHATBOT_PATHS`:

```ts
  "/knowledge-entries": {
    get: {
      operationId: "listKnowledgeEntries",
      security: bearer,
      parameters: [
        REQUEST_ID_PARAMETER,
        ...pageParams,
        { name: "category", in: "query", schema: { type: "string" } },
        { name: "active", in: "query", schema: { type: "boolean" } },
      ],
      responses: { ...okJson({ $ref: "#/components/schemas/Page" }), ...authErrors },
    },
    post: {
      operationId: "createKnowledgeEntry",
      description: "category, question y answer son obligatorios. Maximo 500 entradas por tenant.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/KnowledgeEntryInput" } } },
      },
      responses: { ...createdJson({ $ref: "#/components/schemas/KnowledgeEntry" }), ...writeErrors },
    },
  },
  "/knowledge-entries/{id}": {
    get: {
      operationId: "getKnowledgeEntry",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, ID_PARAMETER],
      responses: { ...okJson({ $ref: "#/components/schemas/KnowledgeEntry" }), ...authErrors },
    },
    patch: {
      operationId: "updateKnowledgeEntry",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER, ID_PARAMETER],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/KnowledgeEntryInput" } } },
      },
      responses: { ...okJson({ $ref: "#/components/schemas/KnowledgeEntry" }), ...writeErrors },
    },
    delete: {
      operationId: "deleteKnowledgeEntry",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER, ID_PARAMETER],
      responses: {
        ...okJson({ type: "object", properties: { deleted: { type: "boolean" } } }),
        ...writeErrors,
      },
    },
  },
```

con `const ID_PARAMETER = { name: "id", in: "path", required: true, schema: { type: "string" } } as const;` al inicio del archivo.

`backend/src/app/api/v1/knowledge-entries/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { pageJson } from "@/http/serializers";
import { knowledgeEntryJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor, request }) => {
  const url = new URL(request.url);
  const activeRaw = url.searchParams.get("active");
  const category = url.searchParams.get("category");
  const page = await getContainer().listKnowledgeEntries({
    tenantId: actor.tenantId,
    ...(category === null ? {} : { category }),
    ...(activeRaw === null ? {} : { active: activeRaw === "true" }),
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, knowledgeEntryJson);
});

export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  const created = await ports.createKnowledgeEntry({
    tenantId: actor.tenantId,
    raw: body,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 201, body: knowledgeEntryJson(created) };
});
```

`backend/src/app/api/v1/knowledge-entries/[id]/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { knowledgeEntryJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  privateRoute(["operator", "admin"], async ({ actor }) => {
    const { id } = await context.params;
    return knowledgeEntryJson(await getContainer().getKnowledgeEntry(actor.tenantId, id));
  })(request);

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    const { id } = await context.params;
    const updated = await ports.updateKnowledgeEntry({
      tenantId: actor.tenantId,
      id,
      raw: body,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: knowledgeEntryJson(updated) };
  })(request);

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    const { id } = await context.params;
    await ports.deleteKnowledgeEntry({
      tenantId: actor.tenantId,
      id,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: { deleted: true } };
  })(request);
```

- [ ] **Step 5: Wire the composition root**

Añade `type KnowledgeWritePorts = ReturnType<typeof knowledgeWritePorts>;` y amplía `WritePorts = BaseWritePorts & BotConfigWritePorts & KnowledgeWritePorts`. En `buildWritePorts` añade `...knowledgeWritePorts(db, auditLog)`. Añade:

```ts
function knowledgeWritePorts(db: PrismaExecutor, auditLog: AuditLog) {
  const knowledge = createPrismaKnowledgeRepository(db);
  const deps = { repo: knowledge, audit: auditLog, clock: systemClock };
  return {
    knowledge,
    createKnowledgeEntry: createCreateKnowledgeEntry({ ...deps, ids: uuidV7Generator }),
    updateKnowledgeEntry: createUpdateKnowledgeEntry(deps),
    deleteKnowledgeEntry: createDeleteKnowledgeEntry(deps),
  };
}

function knowledgeReads(prisma: PrismaClient) {
  const knowledge = createPrismaKnowledgeRepository(prisma);
  return {
    listKnowledgeEntries: createListKnowledgeEntries(knowledge),
    getKnowledgeEntry: createGetKnowledgeEntry(knowledge),
  };
}
```

En `Container` añade `readonly listKnowledgeEntries: ReturnType<typeof createListKnowledgeEntries>;` y `readonly getKnowledgeEntry: ReturnType<typeof createGetKnowledgeEntry>;`, y en `getContainer` `...knowledgeReads(prisma),`.

Run: `npm --prefix backend run openapi:generate`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix backend exec vitest run --project db tests/db/conocimiento-config-http.test.ts tests/db/aislamiento-tenant.test.ts`
Expected: PASS.
Run: `npm --prefix backend exec vitest run --project unit tests/contrato-api.test.ts` y `npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/knowledge/application backend/src/app/api/v1/knowledge-entries backend/src/http/openapi-paths-chatbot.ts backend/src/http/serializers-chatbot.ts backend/src/composition-root.ts backend/openapi.json backend/tests/db/conocimiento-config-http.test.ts backend/tests/db/aislamiento-tenant.test.ts
git commit -m "feat(api): CRUD de la base de conocimiento"
```

---

### Task 10: Núcleo de idempotencia compartido y almacén de plataforma

**Files:**
- Create: `backend/src/http/idempotency-core.ts`
- Modify: `backend/src/http/idempotent-route.ts` (usa el núcleo; opción `rebuild`)
- Modify: `backend/src/modules/shared/domain/idempotency.ts` (añade `PlatformIdempotencyRecord`)
- Modify: `backend/src/modules/shared/domain/ports/idempotency-store.ts` (añade `PlatformIdempotencyStore`)
- Create: `backend/src/modules/shared/infrastructure/prisma-platform-idempotency-store.ts`
- Modify: `backend/src/composition-root.ts`
- Test: `backend/tests/db/idempotencia-store.test.ts`; regresión: `backend/tests/db/idempotencia-http.test.ts`

**Interfaces:**
- Produces (`idempotency-core.ts`):
  - `IDEMPOTENCY_HEADER`, `type IdempotentResult = { status: number; body: unknown }`, `type IdempotentOutcome = IdempotentResult & { stored?: unknown }`
  - `type ScopedIdempotencyStore`, `tenantScope(store: IdempotencyStore, tenantId: TenantId)`, `platformScope(store: PlatformIdempotencyStore)`
  - `type IdempotentRequest = { key; hash; method; path; actorSubject; body: unknown }`
  - `readIdempotentRequest(request: Request, actorSubject: string, minKeyLength?: number): Promise<IdempotentRequest>`
  - `parseJsonBody(bodyText: string): unknown`
  - `runIdempotent(plan: IdempotencyPlan): Promise<IdempotentResult>` con `plan = { request; outside; inside(ports); execute(ports): Promise<IdempotentOutcome>; rebuild?(stored): Promise<IdempotentResult> }`
  - `idempotentJson(result: IdempotentResult, requestId: string): NextResponse`
- Produces (`idempotent-route.ts`): `idempotentRoute(roles, handler, options?: { rebuild?: (stored: IdempotentResult, actor: Actor) => Promise<IdempotentResult> })`. El handler puede devolver `stored`.
- Produces: `type PlatformIdempotencyRecord = Omit<IdempotencyRecord, "tenantId" | "actorSubject">`, `type PlatformIdempotencyStore = { find(key): Promise<PlatformIdempotencyRecord | null>; save(record): Promise<void>; complete(key, status, body): Promise<void> }`, `createPrismaPlatformIdempotencyStore(db)`. `BaseWritePorts` y `Container` ganan `platformIdempotencyStore`.

- [ ] **Step 1: Write the failing test**

Añade a `backend/tests/db/idempotencia-store.test.ts` (import `createPrismaPlatformIdempotencyStore` de `@/modules/shared/infrastructure/prisma-platform-idempotency-store`):

```ts
describe("idempotencia: almacen de claves de plataforma", () => {
  const platformStore = createPrismaPlatformIdempotencyStore(prisma);
  const record = {
    key: "p-1",
    method: "POST",
    path: "/api/platform/v1/tenants",
    requestHash: "hash-p",
    responseStatus: 0,
    responseBody: {},
    createdAt: new Date("2026-09-22T12:00:00.000Z"),
  };

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it("guarda, completa y recupera sin tenant", async () => {
    await platformStore.save(record);
    await platformStore.complete("p-1", 201, { tenant: { id: "t-1" } });
    expect(await platformStore.find("p-1")).toEqual({
      ...record,
      responseStatus: 201,
      responseBody: { tenant: { id: "t-1" } },
    });
    expect(await platformStore.find("p-x")).toBeNull();
  });

  it("repetir la clave lanza IdempotencyKeyTakenError", async () => {
    await platformStore.save(record);
    await expect(platformStore.save(record)).rejects.toBeInstanceOf(IdempotencyKeyTakenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/idempotencia-store.test.ts`
Expected: FAIL: no se resuelve el módulo.

- [ ] **Step 3: Port, record and adapter**

En `backend/src/modules/shared/domain/idempotency.ts` añade:

```ts
/** Clave de la superficie de plataforma: sin tenant (el alta lo crea) y con actor fijo. */
export type PlatformIdempotencyRecord = Omit<IdempotencyRecord, "tenantId" | "actorSubject">;
```

En `backend/src/modules/shared/domain/ports/idempotency-store.ts` añade (importa `PlatformIdempotencyRecord`):

```ts
export type PlatformIdempotencyStore = {
  find(key: string): Promise<PlatformIdempotencyRecord | null>;
  /** Lanza `IdempotencyKeyTakenError` si la clave ya existe. */
  save(record: PlatformIdempotencyRecord): Promise<void>;
  complete(key: string, status: number, body: unknown): Promise<void>;
};
```

`backend/src/modules/shared/infrastructure/prisma-platform-idempotency-store.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { IdempotencyKeyTakenError } from "../domain/idempotency";
import type { PlatformIdempotencyStore } from "../domain/ports/idempotency-store";
import type { PrismaExecutor } from "./prisma-client";
import { isUniqueViolation } from "./prisma-errors";

export function createPrismaPlatformIdempotencyStore(db: PrismaExecutor): PlatformIdempotencyStore {
  return {
    async find(key) {
      const row = await db.platformIdempotencyKey.findUnique({ where: { key } });
      return row
        ? {
            key: row.key,
            method: row.method,
            path: row.path,
            requestHash: row.requestHash,
            responseStatus: row.responseStatus,
            responseBody: row.responseBody,
            createdAt: row.createdAt,
          }
        : null;
    },
    async save(record) {
      try {
        await db.platformIdempotencyKey.create({
          data: { ...record, responseBody: record.responseBody as Prisma.InputJsonValue },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new IdempotencyKeyTakenError();
        }
        throw error;
      }
    },
    async complete(key, status, body) {
      await db.platformIdempotencyKey.update({
        where: { key },
        data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue },
      });
    },
  };
}
```

- [ ] **Step 4: Write `idempotency-core.ts`**

```ts
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { IdempotencyKeyTakenError } from "@/modules/shared/domain/idempotency";
import type {
  IdempotencyStore,
  PlatformIdempotencyStore,
} from "@/modules/shared/domain/ports/idempotency-store";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { REQUEST_ID_HEADER } from "./request-id";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Estado provisional de una clave reservada; nunca sale de la transaccion. */
const PENDING_STATUS = 0;

export type IdempotentResult = { readonly status: number; readonly body: unknown };

/** `stored` se persiste en lugar de `body` cuando la respuesta lleva credenciales. */
export type IdempotentOutcome = IdempotentResult & { readonly stored?: unknown };

type StoredResponse = {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
};

type Reservation = {
  readonly key: string;
  readonly actorSubject: string;
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  readonly createdAt: Date;
};

/** Almacen de claves ya atado a su ambito: un tenant o la plataforma. */
export type ScopedIdempotencyStore = {
  find(key: string): Promise<StoredResponse | null>;
  reserve(reservation: Reservation): Promise<void>;
  complete(key: string, status: number, body: unknown): Promise<void>;
};

export type IdempotentRequest = {
  readonly key: string;
  readonly hash: string;
  readonly method: string;
  readonly path: string;
  readonly actorSubject: string;
  readonly body: unknown;
};

export type IdempotencyPlan = {
  readonly request: IdempotentRequest;
  readonly outside: ScopedIdempotencyStore;
  readonly inside: (ports: WritePorts) => ScopedIdempotencyStore;
  readonly execute: (ports: WritePorts) => Promise<IdempotentOutcome>;
  /** Reconstruye la respuesta desde lo persistido; por defecto se repite tal cual. */
  readonly rebuild?: (stored: IdempotentResult) => Promise<IdempotentResult>;
};

export function tenantScope(store: IdempotencyStore, tenantId: TenantId): ScopedIdempotencyStore {
  return {
    find: (key) => store.find(tenantId, key),
    reserve: (reservation) =>
      store.save({ tenantId, ...reservation, responseStatus: PENDING_STATUS, responseBody: {} }),
    complete: (key, status, body) => store.complete(tenantId, key, status, body),
  };
}

export function platformScope(store: PlatformIdempotencyStore): ScopedIdempotencyStore {
  return {
    find: (key) => store.find(key),
    reserve: (reservation) =>
      store.save({
        key: reservation.key,
        method: reservation.method,
        path: reservation.path,
        requestHash: reservation.requestHash,
        createdAt: reservation.createdAt,
        responseStatus: PENDING_STATUS,
        responseBody: {},
      }),
    complete: (key, status, body) => store.complete(key, status, body),
  };
}

export function parseJsonBody(bodyText: string): unknown {
  if (bodyText === "") {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new ValidationError("Cuerpo JSON invalido");
  }
}

function requestHash(method: string, path: string, bodyText: string): string {
  return createHash("sha256").update(`${method}\n${path}\n${bodyText}`).digest("hex");
}

export async function readIdempotentRequest(
  request: Request,
  actorSubject: string,
  minKeyLength = 1,
): Promise<IdempotentRequest> {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (key === "") {
    throw new ValidationError("Idempotency-Key es obligatoria", { field: IDEMPOTENCY_HEADER });
  }
  if (key.length < minKeyLength) {
    throw new ValidationError(`Idempotency-Key debe tener al menos ${minKeyLength} caracteres`, {
      field: IDEMPOTENCY_HEADER,
      min_length: minKeyLength,
    });
  }
  const bodyText = await request.text();
  const path = new URL(request.url).pathname;
  return {
    key,
    hash: requestHash(request.method, path, bodyText),
    method: request.method,
    path,
    actorSubject,
    body: parseJsonBody(bodyText),
  };
}

/** Respuesta ya servida para la clave, o `null` si nadie la ha usado. */
async function previousResult(
  store: ScopedIdempotencyStore,
  request: IdempotentRequest,
): Promise<IdempotentResult | null> {
  const existing = await store.find(request.key);
  if (!existing) {
    return null;
  }
  if (existing.requestHash !== request.hash) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion", {
      field: IDEMPOTENCY_HEADER,
    });
  }
  return { status: existing.responseStatus, body: existing.responseBody };
}

/**
 * Ejecuta la escritura una sola vez por clave. La clave se reserva al abrir la transaccion,
 * antes de la escritura de negocio: un envio concurrente con la misma clave queda bloqueado
 * en esa insercion hasta que el primero confirma; entonces falla, su transaccion se revierte
 * entera y la respuesta guardada se repite fuera de ella.
 */
export async function runIdempotent(plan: IdempotencyPlan): Promise<IdempotentResult> {
  const rebuild = plan.rebuild ?? (async (stored: IdempotentResult) => stored);
  const replay = await previousResult(plan.outside, plan.request);
  if (replay) {
    return rebuild(replay);
  }
  try {
    return await getContainer().withWriteTransaction(async (ports) => {
      const store = plan.inside(ports);
      const { key, actorSubject, method, path, hash } = plan.request;
      await store.reserve({ key, actorSubject, method, path, requestHash: hash, createdAt: ports.clock.now() });
      const outcome = await plan.execute(ports);
      await store.complete(key, outcome.status, outcome.stored ?? outcome.body);
      return { status: outcome.status, body: outcome.body };
    });
  } catch (error) {
    if (!(error instanceof IdempotencyKeyTakenError)) {
      throw error;
    }
    const raced = await previousResult(plan.outside, plan.request);
    if (!raced) {
      throw error;
    }
    return rebuild(raced);
  }
}

export function idempotentJson(result: IdempotentResult, requestId: string): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}
```

- [ ] **Step 5: Rewrite `idempotent-route.ts` on top of the core**

Sustituye el contenido completo de `backend/src/http/idempotent-route.ts` por:

```ts
import type { NextResponse } from "next/server";
import { getContainer, type WritePorts } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import type { Role } from "@/modules/auth/domain/role";
import { errorResponse, toApiError } from "./errors";
import {
  type IdempotentOutcome,
  type IdempotentResult,
  idempotentJson,
  readIdempotentRequest,
  runIdempotent,
  tenantScope,
} from "./idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

export type { IdempotentResult } from "./idempotency-core";

type IdempotentHandler = (context: {
  actor: Actor;
  requestId: string;
  body: unknown;
  ports: WritePorts;
}) => Promise<IdempotentOutcome>;

type IdempotentRouteOptions = {
  /** Reconstruye la repeticion cuando lo persistido no es la respuesta (credenciales). */
  readonly rebuild?: (stored: IdempotentResult, actor: Actor) => Promise<IdempotentResult>;
};

/** Escritura autenticada con `Idempotency-Key` obligatoria, en el ambito del tenant del token. */
export function idempotentRoute(
  allowedRoles: readonly Role[],
  handler: IdempotentHandler,
  options: IdempotentRouteOptions = {},
) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      const actor = await container.authenticate(request.headers.get("Authorization"));
      requireRole(actor, allowedRoles);
      const idempotent = await readIdempotentRequest(request, actor.subject);
      const { rebuild } = options;
      const result = await runIdempotent({
        request: idempotent,
        outside: tenantScope(container.idempotencyStore, actor.tenantId),
        inside: (ports) => tenantScope(ports.idempotencyStore, actor.tenantId),
        execute: (ports) => handler({ actor, requestId, body: idempotent.body, ports }),
        ...(rebuild ? { rebuild: (stored: IdempotentResult) => rebuild(stored, actor) } : {}),
      });
      return idempotentJson(result, requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
```

- [ ] **Step 6: Wire the platform store**

En `composition-root.ts`: añade `readonly platformIdempotencyStore: PlatformIdempotencyStore;` a `BaseWritePorts` y a `Container`; en `buildWritePorts` `platformIdempotencyStore: createPrismaPlatformIdempotencyStore(db),`; en `getContainer` `platformIdempotencyStore: createPrismaPlatformIdempotencyStore(prisma),`.

- [ ] **Step 7: Run tests to verify they pass (and nothing regressed)**

Run: `npm --prefix backend exec vitest run --project db tests/db/idempotencia-store.test.ts tests/db/idempotencia-http.test.ts tests/db/conocimiento-config-http.test.ts`
Expected: PASS: incluye el caso concurrente de la Fase 2 y los de rotación.
Run: `npm --prefix backend run typecheck`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/http/idempotency-core.ts backend/src/http/idempotent-route.ts backend/src/modules/shared/domain/idempotency.ts backend/src/modules/shared/domain/ports/idempotency-store.ts backend/src/modules/shared/infrastructure/prisma-platform-idempotency-store.ts backend/src/composition-root.ts backend/tests/db/idempotencia-store.test.ts
git commit -m "refactor(http): nucleo de idempotencia compartido y almacen de plataforma"
```

---

### Task 11: Superficie de plataforma: auth, tokens y lista de tenants

**Files:**
- Modify: `backend/src/config/env.ts` (`platformSecret`)
- Modify: `backend/tests/setup-env.ts` (`PLATFORM_SECRET`)
- Create: `backend/src/http/platform-route.ts`
- Create: `backend/src/modules/platform/domain/platform-actor.ts`
- Create: `backend/src/modules/platform/domain/token-request.ts`
- Create: `backend/src/modules/platform/domain/tenant-registration.ts`
- Create: `backend/src/modules/platform/domain/ports/tenant-registry.ts`
- Create: `backend/src/modules/platform/application/issue-token.ts`
- Create: `backend/src/modules/platform/application/list-tenants.ts`
- Create: `backend/src/modules/platform/infrastructure/prisma-tenant-registry.ts`
- Create: `backend/src/app/api/platform/v1/tokens/route.ts`
- Create: `backend/src/app/api/platform/v1/tenants/route.ts` (solo `GET` en esta tarea)
- Create: `backend/src/http/openapi-platform.ts`
- Modify: `backend/scripts/generate-openapi.ts`, `backend/src/http/serializers-chatbot.ts`, `backend/src/composition-root.ts`
- Generate: `backend/openapi-platform.json`
- Test: `backend/tests/dominio/plataforma.test.ts`, `backend/tests/roles.test.ts`, `backend/tests/contrato-api.test.ts`, `backend/tests/db/alta-chatbot.test.ts`

**Interfaces:**
- Consumes: `TokenIssuer` + `createJoseTokenIssuer` (Task 6), `isUniqueViolation` (Task 7), `parseJsonBody` (Task 10), `requiredText`, `asRecord` (Task 3), `ERROR_SCHEMA`, `PAGE_SCHEMA`, etc. (Task 8).
- Produces:
  - `AppConfig.platformSecret: string | null` (`PLATFORM_SECRET` vacío → `null`; menos de 32 caracteres → error al arrancar)
  - `requirePlatform(authorization: string | null, secret: string | null): void`, `platformRoute(handler: (ctx: { requestId: string; request: Request }) => Promise<unknown>)`, `readJsonBody(request: Request): Promise<unknown>`
  - `PLATFORM_AUDIT_ACTOR = { actorSubject: "platform", actorRole: "platform" }`
  - `ISSUABLE_ROLES`, `TOKEN_TTL_MINUTES`, `type TokenRequest = { tenantId: string; role: IssuableRole; subject: string; ttlMinutes: number }`, `parseTokenRequest(raw: unknown): TokenRequest`
  - `type TenantSummary = { id: string; slug: string; name: string; createdAt: Date }`, `type TenantDraft = { slug: string; name: string; allowedOrigins: unknown }`, `parseTenantDraft(raw: unknown): TenantDraft`
  - `type TenantRegistry = { create(t: { id; slug; name }): Promise<TenantSummary>; exists(id: string): Promise<boolean>; list(f: { cursor?: string | null; limit: number }): Promise<Page<TenantSummary>> }` (`create` lanza `ConflictError` con `{ field: "slug" }`)
  - `createIssueToken(deps: { registry; issuer; audit; clock }): (input: { raw: unknown; requestId: string }) => Promise<{ token: string; expiresAt: Date }>`
  - `createListTenants(registry): (input: { cursor?: string | null; limitRaw?: string | null }) => Promise<Page<TenantSummary>>`
  - `tenantJson(tenant: TenantSummary)` en `serializers-chatbot.ts`
  - `buildPlatformOpenApiDocument(): Record<string, unknown>`
  - `Container` gana `issueToken`, `listTenants`.

- [ ] **Step 1: Write the failing domain test**

`backend/tests/dominio/plataforma.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTenantDraft } from "@/modules/platform/domain/tenant-registration";
import { parseTokenRequest } from "@/modules/platform/domain/token-request";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("alta-chatbot: peticion de token de plataforma", () => {
  it("aplica el TTL por defecto de cada rol", () => {
    expect(parseTokenRequest({ tenant_id: "t", role: "admin", subject: "ana" })).toEqual({
      tenantId: "t",
      role: "admin",
      subject: "ana",
      ttlMinutes: 480,
    });
    expect(parseTokenRequest({ tenant_id: "t", role: "service", subject: "hermes" }).ttlMinutes).toBe(60);
  });

  it("acepta un TTL dentro del tope", () => {
    expect(
      parseTokenRequest({ tenant_id: "t", role: "service", subject: "h", ttl_minutes: 1440 }).ttlMinutes,
    ).toBe(1440);
  });

  it.each([
    [{ tenant_id: "t", role: "widget", subject: "x" }, "role"],
    [{ tenant_id: "t", role: "root", subject: "x" }, "role"],
    [{ tenant_id: "", role: "admin", subject: "x" }, "tenant_id"],
    [{ tenant_id: "t", role: "admin", subject: "" }, "subject"],
    [{ tenant_id: "t", role: "admin", subject: "widget:abc" }, "subject"],
    [{ tenant_id: "t", role: "admin", subject: "x".repeat(121) }, "subject"],
    [{ tenant_id: "t", role: "operator", subject: "x", ttl_minutes: 721 }, "ttl_minutes"],
    [{ tenant_id: "t", role: "operator", subject: "x", ttl_minutes: 0 }, "ttl_minutes"],
    [{ tenant_id: "t", role: "operator", subject: "x", ttl_minutes: 1.5 }, "ttl_minutes"],
  ])("rechaza %j", (raw, field) => {
    try {
      parseTokenRequest(raw);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });
});

describe("alta-chatbot: borrador de tenant", () => {
  it("acepta slug y nombre; los origenes se validan al aprovisionar", () => {
    expect(parseTenantDraft({ slug: "clinica-norte", name: "Clínica Norte" })).toEqual({
      slug: "clinica-norte",
      name: "Clínica Norte",
      allowedOrigins: [],
    });
  });

  it.each(["", "Clinica", "-norte", "norte-", "norte_1", "x".repeat(51)])("rechaza el slug %j", (slug) => {
    expect(() => parseTenantDraft({ slug, name: "N" })).toThrow(ValidationError);
  });

  it("exige nombre", () => {
    expect(() => parseTenantDraft({ slug: "norte" })).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/plataforma.test.ts`
Expected: FAIL: no se resuelve el módulo.

- [ ] **Step 3: Write the platform domain**

`backend/src/modules/platform/domain/platform-actor.ts`:

```ts
/** La plataforma audita con identidad fija: no es un usuario ni pertenece a un tenant. */
export const PLATFORM_AUDIT_ACTOR = { actorSubject: "platform", actorRole: "platform" } as const;
```

`backend/src/modules/platform/domain/token-request.ts`:

```ts
import { asRecord, requiredText } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";

/** La plataforma emite tokens de panel y de servicio; los de widget salen de una sesion. */
export const ISSUABLE_ROLES = ["operator", "admin", "service"] as const;
export type IssuableRole = (typeof ISSUABLE_ROLES)[number];

export const TOKEN_TTL_MINUTES: Readonly<Record<IssuableRole, { default: number; max: number }>> = {
  operator: { default: 480, max: 720 },
  admin: { default: 480, max: 720 },
  service: { default: 60, max: 1440 },
};

const SUBJECT_MAX_LENGTH = 120;
const TENANT_ID_MAX_LENGTH = 200;
/** Reservado para los tokens de sesion del widget. */
const RESERVED_SUBJECT_PREFIX = "widget:";

export type TokenRequest = {
  readonly tenantId: string;
  readonly role: IssuableRole;
  readonly subject: string;
  readonly ttlMinutes: number;
};

export function parseTokenRequest(raw: unknown): TokenRequest {
  const data = asRecord(raw, "body");
  const role = roleOf(data.role);
  return {
    tenantId: requiredText(data.tenant_id, "tenant_id", TENANT_ID_MAX_LENGTH),
    role,
    subject: subjectOf(data.subject),
    ttlMinutes: ttlOf(data.ttl_minutes, role),
  };
}

function roleOf(value: unknown): IssuableRole {
  if (typeof value === "string" && (ISSUABLE_ROLES as readonly string[]).includes(value)) {
    return value as IssuableRole;
  }
  throw new ValidationError(`role debe ser uno de: ${ISSUABLE_ROLES.join(", ")}`, {
    field: "role",
    allowed: [...ISSUABLE_ROLES],
  });
}

function subjectOf(value: unknown): string {
  const subject = requiredText(value, "subject", SUBJECT_MAX_LENGTH);
  if (subject.startsWith(RESERVED_SUBJECT_PREFIX)) {
    throw new ValidationError(`subject no puede empezar por ${RESERVED_SUBJECT_PREFIX}`, {
      field: "subject",
    });
  }
  return subject;
}

function ttlOf(value: unknown, role: IssuableRole): number {
  const spec = TOKEN_TTL_MINUTES[role];
  if (value === undefined || value === null) {
    return spec.default;
  }
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > spec.max) {
    throw new ValidationError(`ttl_minutes debe ser un entero entre 1 y ${spec.max}`, {
      field: "ttl_minutes",
      max: spec.max,
    });
  }
  return value as number;
}
```

`backend/src/modules/platform/domain/tenant-registration.ts`:

```ts
import { asRecord, requiredText } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export type TenantSummary = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: Date;
};

/** `allowedOrigins` se valida al aprovisionar el bot-config (su dueño). */
export type TenantDraft = {
  readonly slug: string;
  readonly name: string;
  readonly allowedOrigins: unknown;
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const NAME_MAX_LENGTH = 120;

export function parseTenantDraft(raw: unknown): TenantDraft {
  const data = asRecord(raw, "body");
  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  if (!SLUG.test(slug)) {
    throw new ValidationError("slug: minusculas, digitos y guiones internos, de 1 a 50 caracteres", {
      field: "slug",
    });
  }
  return {
    slug,
    name: requiredText(data.name, "name", NAME_MAX_LENGTH),
    allowedOrigins: data.allowed_origins ?? [],
  };
}
```

`backend/src/modules/platform/domain/ports/tenant-registry.ts`:

```ts
import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantSummary } from "../tenant-registration";

export type TenantRegistry = {
  /** Lanza `ConflictError` (`field: slug`) si el slug ya existe. */
  create(tenant: { id: string; slug: string; name: string }): Promise<TenantSummary>;
  exists(id: string): Promise<boolean>;
  list(filter: { cursor?: string | null; limit: number }): Promise<Page<TenantSummary>>;
};
```

- [ ] **Step 4: Run the domain test**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/plataforma.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing HTTP tests**

Añade a `backend/tests/setup-env.ts`, dentro del `Object.assign`:

```ts
  PLATFORM_SECRET: "secreto-de-plataforma-de-pruebas-con-32-o-mas",
```

Añade a `backend/tests/roles.test.ts` (imports `POST as issuePlatformToken` de `@/app/api/platform/v1/tokens/route` y `resetContainer` de `@/composition-root`):

```ts
const PLATFORM_SECRET = "secreto-de-plataforma-de-pruebas-con-32-o-mas";

function platformRequest(authorization: string | null, body: unknown): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  return new Request("http://localhost/api/platform/v1/tokens", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("roles: superficie de plataforma", () => {
  const body = { tenant_id: "tenant-a", role: "widget", subject: "x" };

  it("sin secreto responde 401", async () => {
    expect((await issuePlatformToken(platformRequest(null, body))).status).toBe(401);
  });

  it("con secreto incorrecto responde 401", async () => {
    const response = await issuePlatformToken(platformRequest("Bearer otro-secreto", body));
    expect(response.status).toBe(401);
  });

  it("un JWT valido de admin no abre la plataforma", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a" });
    expect((await issuePlatformToken(platformRequest(`Bearer ${token}`, body))).status).toBe(401);
  });

  it("no emite tokens de widget", async () => {
    const response = await issuePlatformToken(platformRequest(`Bearer ${PLATFORM_SECRET}`, body));
    expect(response.status).toBe(422);
    expect((await response.json()).error.details.field).toBe("role");
  });

  it("sin PLATFORM_SECRET configurado toda la superficie responde 404", async () => {
    const saved = process.env.PLATFORM_SECRET;
    delete process.env.PLATFORM_SECRET;
    resetContainer();
    try {
      const response = await issuePlatformToken(platformRequest(`Bearer ${PLATFORM_SECRET}`, body));
      expect(response.status).toBe(404);
    } finally {
      process.env.PLATFORM_SECRET = saved;
      resetContainer();
    }
  });
});
```

Añade a `backend/tests/contrato-api.test.ts` (import `buildPlatformOpenApiDocument` de `@/http/openapi-platform`):

```ts
const PLATFORM_DIR = join(process.cwd(), "src", "app", "api", "platform", "v1");

describe("contrato-api: OpenAPI de plataforma", () => {
  it("openapi-platform.json esta al dia con el generador", () => {
    const onDisk = readFileSync(join(process.cwd(), "openapi-platform.json"), "utf8");
    expect(JSON.parse(onDisk)).toEqual(buildPlatformOpenApiDocument());
  });

  it("toda ruta de /api/platform/v1 esta declarada en el contrato de plataforma", () => {
    const document = buildPlatformOpenApiDocument() as { paths: Record<string, unknown> };
    const declared = Object.keys(document.paths).map(normalizePath).sort();
    const onDisk = declaredRoutes(PLATFORM_DIR).map(normalizePath).sort();
    expect(onDisk).toEqual(declared);
  });
});
```

`backend/tests/db/alta-chatbot.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listTenants } from "@/app/api/platform/v1/tenants/route";
import { POST as issueToken } from "@/app/api/platform/v1/tokens/route";
import { GET as getBotConfig } from "@/app/api/v1/bot-config/route";
import { resetContainer } from "@/composition-root";
import { authedRequest } from "../helpers/token";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const PLATFORM_SECRET = "secreto-de-plataforma-de-pruebas-con-32-o-mas";
const HOUR = 3_600_000;

function platformPost(url: string, body: unknown, key?: string): Request {
  const headers = new Headers({
    Authorization: `Bearer ${PLATFORM_SECRET}`,
    "Content-Type": "application/json",
  });
  if (key) {
    headers.set("Idempotency-Key", key);
  }
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

const TOKENS_URL = "http://localhost/api/platform/v1/tokens";

describe("alta-chatbot: tokens de plataforma", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("un token admin emitido abre /bot-config de su tenant", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    const before = Date.now();
    const response = await issueToken(
      platformPost(TOKENS_URL, { tenant_id: tenantId, role: "admin", subject: "ana@clinica" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const expiresAt = new Date(body.expires_at).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 8 * HOUR - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 8 * HOUR);

    const config = await getBotConfig(authedRequest("http://localhost/api/v1/bot-config", body.token));
    expect(config.status).toBe(200);
  });

  it("audita el hecho sin guardar el token", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    const body = await (
      await issueToken(platformPost(TOKENS_URL, { tenant_id: tenantId, role: "service", subject: "hermes" }))
    ).json();

    const events = await prisma.auditEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId,
      actorSubject: "platform",
      actorRole: "platform",
      action: "token.issued",
      resourceType: "token.service",
      resourceId: "hermes",
    });
    expect(JSON.stringify(events)).not.toContain(body.token);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    expect(await prisma.platformIdempotencyKey.count()).toBe(0);
  });

  it("tenant inexistente responde 404", async () => {
    const response = await issueToken(
      platformPost(TOKENS_URL, { tenant_id: "tenant-x", role: "admin", subject: "ana" }),
    );
    expect(response.status).toBe(404);
  });

  it("GET /tenants lista paginado", async () => {
    await insertChatbotTenant(prisma, "a");
    await insertChatbotTenant(prisma, "b");
    const response = await listTenants(
      new Request("http://localhost/api/platform/v1/tenants?limit=1", {
        headers: { Authorization: `Bearer ${PLATFORM_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { id: "tenant-a", slug: "a", name: "Tenant a", created_at: expect.any(String) },
    ]);
    expect(body.next_cursor).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm --prefix backend exec vitest run --project unit tests/roles.test.ts tests/contrato-api.test.ts`
Expected: FAIL: no se resuelven las rutas de plataforma.

- [ ] **Step 7: Config and platform route**

En `backend/src/config/env.ts`: añade `readonly platformSecret: string | null;` a `AppConfig`, `platformSecret: platformSecret(),` en `loadConfig`, y:

```ts
const MIN_PLATFORM_SECRET_LENGTH = 32;

/** Sin secreto, la superficie de plataforma queda apagada (404). */
function platformSecret(): string | null {
  const value = process.env.PLATFORM_SECRET;
  if (!value) {
    return null;
  }
  if (value.length < MIN_PLATFORM_SECRET_LENGTH) {
    throw new Error(`PLATFORM_SECRET debe tener al menos ${MIN_PLATFORM_SECRET_LENGTH} caracteres`);
  }
  return value;
}
```

`backend/src/http/platform-route.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { unauthorized } from "@/modules/auth/domain/auth-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { errorResponse, toApiError } from "./errors";
import { parseJsonBody } from "./idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const BEARER = /^Bearer (.+)$/;

/** Compara en tiempo constante: los digests tienen siempre la misma longitud. */
function sameSecret(presented: string, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}

/**
 * La plataforma es un actor fuera de todo tenant (GOBERNANZA §1.3). Sin PLATFORM_SECRET la
 * superficie no existe (404), igual que el simulador apagado.
 */
export function requirePlatform(authorization: string | null, secret: string | null): void {
  if (secret === null) {
    throw new NotFoundError();
  }
  const presented = BEARER.exec(authorization ?? "")?.[1];
  if (!presented || !sameSecret(presented, secret)) {
    throw unauthorized();
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(await request.text());
}

type PlatformHandler = (context: { requestId: string; request: Request }) => Promise<unknown>;

/** Ruta de plataforma sin escritura de dominio (lecturas y emision de tokens). */
export function platformRoute(handler: PlatformHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      requirePlatform(request.headers.get("Authorization"), getContainer().config.platformSecret);
      return NextResponse.json(await handler({ requestId, request }), {
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
```

- [ ] **Step 8: Use cases and adapter**

`backend/src/modules/platform/application/issue-token.ts`:

```ts
import type { TokenIssuer } from "@/modules/auth/domain/ports/token-issuer";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { PLATFORM_AUDIT_ACTOR } from "../domain/platform-actor";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import { parseTokenRequest } from "../domain/token-request";

export type IssuedToken = { readonly token: string; readonly expiresAt: Date };
export type IssueToken = (input: { raw: unknown; requestId: string }) => Promise<IssuedToken>;

type Deps = {
  readonly registry: TenantRegistry;
  readonly issuer: TokenIssuer;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/** Firmar un JWT no escribe dominio: sin Idempotency-Key. Se audita el hecho, nunca el token. */
export function createIssueToken(deps: Deps): IssueToken {
  return async ({ raw, requestId }) => {
    const request = parseTokenRequest(raw);
    if (!(await deps.registry.exists(request.tenantId))) {
      throw new NotFoundError("Tenant inexistente");
    }
    const issuedAt = deps.clock.now();
    const expiresAt = new Date(issuedAt.getTime() + request.ttlMinutes * 60_000);
    const token = await deps.issuer.issue({
      subject: request.subject,
      tenantId: request.tenantId,
      role: request.role,
      issuedAt,
      expiresAt,
    });
    await deps.audit.record({
      tenantId: toTenantId(request.tenantId),
      ...PLATFORM_AUDIT_ACTOR,
      action: "token.issued",
      resourceType: `token.${request.role}`,
      resourceId: request.subject,
      requestId,
      occurredAt: issuedAt,
    });
    return { token, expiresAt };
  };
}
```

`backend/src/modules/platform/application/list-tenants.ts`:

```ts
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import type { TenantSummary } from "../domain/tenant-registration";

export type ListTenants = (input: {
  cursor?: string | null;
  limitRaw?: string | null;
}) => Promise<Page<TenantSummary>>;

export function createListTenants(registry: TenantRegistry): ListTenants {
  return async (input) => {
    const limit = parseLimit(input.limitRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return registry.list({ cursor: input.cursor, limit });
  };
}
```

`backend/src/modules/platform/infrastructure/prisma-tenant-registry.ts`:

```ts
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { afterIdCursor, pageByIdAsc } from "@/modules/shared/infrastructure/prisma-cursor";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import type { TenantSummary } from "../domain/tenant-registration";

function mapTenant(row: { id: string; slug: string; name: string; createdAt: Date }): TenantSummary {
  return { id: row.id, slug: row.slug, name: row.name, createdAt: row.createdAt };
}

export function createPrismaTenantRegistry(db: PrismaExecutor): TenantRegistry {
  return {
    async create(tenant) {
      try {
        return mapTenant(await db.tenant.create({ data: tenant }));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("El slug ya existe", { field: "slug" });
        }
        throw error;
      }
    },
    async exists(id) {
      return (await db.tenant.count({ where: { id } })) > 0;
    },
    async list(filter) {
      const rows = await db.tenant.findMany({
        where: afterIdCursor(filter.cursor),
        orderBy: { id: "asc" },
        take: filter.limit + 1,
      });
      return pageByIdAsc(rows.map(mapTenant), filter.limit);
    },
  };
}
```

En `serializers-chatbot.ts` añade (import `TenantSummary` de `@/modules/platform/domain/tenant-registration`):

```ts
export function tenantJson(tenant: TenantSummary) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    created_at: tenant.createdAt.toISOString(),
  };
}
```

- [ ] **Step 9: Routes, composition and OpenAPI**

`backend/src/app/api/platform/v1/tokens/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { platformRoute, readJsonBody } from "@/http/platform-route";

export const dynamic = "force-dynamic";

export const POST = platformRoute(async ({ requestId, request }) => {
  const issued = await getContainer().issueToken({ raw: await readJsonBody(request), requestId });
  return { token: issued.token, expires_at: issued.expiresAt.toISOString() };
});
```

`backend/src/app/api/platform/v1/tenants/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { platformRoute } from "@/http/platform-route";
import { pageJson } from "@/http/serializers";
import { tenantJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

export const GET = platformRoute(async ({ request }) => {
  const url = new URL(request.url);
  const page = await getContainer().listTenants({
    cursor: url.searchParams.get("cursor"),
    limitRaw: url.searchParams.get("limit"),
  });
  return pageJson(page, tenantJson);
});
```

En `composition-root.ts` añade a `Container` `readonly issueToken: IssueToken;` y `readonly listTenants: ListTenants;`, en `getContainer` `...platformReads(prisma, config),`, y:

```ts
function platformReads(prisma: PrismaClient, config: AppConfig) {
  const registry = createPrismaTenantRegistry(prisma);
  return {
    issueToken: createIssueToken({
      registry,
      issuer: createJoseTokenIssuer(config.jwt),
      audit: createPrismaAuditLog(prisma, uuidV7Generator),
      clock: systemClock,
    }),
    listTenants: createListTenants(registry),
  };
}
```

`backend/src/http/openapi-platform.ts`:

```ts
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
const readErrors = errorResponses(["unauthorized", "not_found", "validation_failed", "internal_error"]);

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
            content: { "application/json": { schema: { $ref: "#/components/schemas/TokenRequest" } } },
          },
          responses: { ...okJson({ $ref: "#/components/schemas/IssuedToken" }), ...readErrors },
        },
      },
    },
  };
}
```

En `backend/scripts/generate-openapi.ts` añade el import de `buildPlatformOpenApiDocument` y:

```ts
const platform = join(root, "openapi-platform.json");
writeFileSync(platform, `${JSON.stringify(buildPlatformOpenApiDocument(), null, 2)}\n`, "utf8");
process.stdout.write(`openapi-platform.json regenerado en ${platform}\n`);
```

Run: `npm --prefix backend run openapi:generate`

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm --prefix backend exec vitest run --project unit tests/roles.test.ts tests/contrato-api.test.ts tests/dominio/plataforma.test.ts`
Run: `npm --prefix backend exec vitest run --project db tests/db/alta-chatbot.test.ts`
Expected: PASS en ambos.
Run: `npm --prefix backend run typecheck`

- [ ] **Step 11: Commit**

```bash
git add backend/src/config/env.ts backend/tests/setup-env.ts backend/src/http/platform-route.ts backend/src/http/openapi-platform.ts backend/src/http/serializers-chatbot.ts backend/src/modules/platform backend/src/app/api/platform backend/src/composition-root.ts backend/scripts/generate-openapi.ts backend/openapi-platform.json backend/tests/dominio/plataforma.test.ts backend/tests/roles.test.ts backend/tests/contrato-api.test.ts backend/tests/db/alta-chatbot.test.ts
git commit -m "feat(platform): superficie /api/platform/v1 con emision de tokens y lista de tenants"
```

---

### Task 12: Alta de tenant (`POST /api/platform/v1/tenants`)

**Files:**
- Create: `backend/src/modules/bot-config/application/provisioning.ts`
- Create: `backend/src/modules/platform/domain/ports/provisioning.ts`
- Create: `backend/src/modules/platform/application/register-tenant.ts`
- Modify: `backend/src/http/platform-route.ts` (añade `platformIdempotentRoute`)
- Modify: `backend/src/app/api/platform/v1/tenants/route.ts` (añade `POST`)
- Modify: `backend/src/http/openapi-platform.ts`, `backend/src/composition-root.ts`
- Regenerate: `backend/openapi-platform.json`
- Test: `backend/tests/db/alta-chatbot.test.ts`

**Interfaces:**
- Consumes: `applyPatch`, `EMPTY_OVERRIDES` (Task 3), repositorios (Task 7), `createSeedDefaultKnowledge` (Task 9), `runIdempotent`, `platformScope`, `readIdempotentRequest`, `idempotentJson` (Task 10), `TenantRegistry`, `PLATFORM_AUDIT_ACTOR`, `parseTenantDraft` (Task 11).
- Produces:
  - `createProvisionBotConfig(deps: { configs; keys; generator; ids; clock; originPolicy }): (input: { tenantId: TenantId; allowedOrigins: unknown }) => Promise<{ widgetKey: string }>`
  - `type TenantProvisioning = { provisionBotConfig(input: { tenantId: TenantId; allowedOrigins: unknown }): Promise<{ widgetKey: string }>; seedKnowledge(tenantId: TenantId): Promise<void> }`
  - `createRegisterTenant(deps: { registry; provisioning; ids; audit; clock }): (input: { raw: unknown; requestId: string }) => Promise<{ tenant: TenantSummary; widgetKey: string }>`
  - `platformIdempotentRoute(handler: (ctx: { requestId: string; body: unknown; ports: WritePorts }) => Promise<IdempotentOutcome>)`
  - `WritePorts` gana `registerTenant`.

- [ ] **Step 1: Write the failing test**

Añade a `backend/tests/db/alta-chatbot.test.ts` (import `POST as createTenant` junto a `GET as listTenants`):

```ts
const TENANTS_URL = "http://localhost/api/platform/v1/tenants";
const NEW_TENANT = {
  slug: "clinica-nueva",
  name: "Clínica Nueva",
  allowed_origins: ["https://Nueva.test"],
};

async function counts() {
  return {
    tenants: await prisma.tenant.count(),
    configs: await prisma.botConfig.count(),
    keys: await prisma.widgetKey.count(),
    entries: await prisma.knowledgeEntry.count(),
  };
}

describe("alta-chatbot: POST /tenants", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("crea tenant, config, KB de ejemplo y una clave vigente", async () => {
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-1"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.tenant).toMatchObject({ slug: "clinica-nueva", name: "Clínica Nueva" });
    expect(body.widget_key).toMatch(/^wk_[A-Za-z0-9_-]{43}$/);

    const tenantId = body.tenant.id;
    expect(await prisma.botConfig.findUniqueOrThrow({ where: { tenantId } })).toMatchObject({
      allowedOrigins: ["https://nueva.test"],
    });
    expect(await prisma.knowledgeEntry.count({ where: { tenantId } })).toBe(3);
    expect(await prisma.widgetKey.findFirstOrThrow({ where: { tenantId, retiredAt: null } })).toMatchObject({
      key: body.widget_key,
    });
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual(["tenant.created"]);
  });

  it("idempotencia: repetir con la misma clave devuelve lo mismo sin duplicar", async () => {
    const first = await (await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-2"))).json();
    const again = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-2"));
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(first);
    expect(await counts()).toEqual({ tenants: 1, configs: 1, keys: 1, entries: 3 });
  });

  it("slug repetido con otra clave responde 409 sin filas nuevas", async () => {
    await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-3"));
    const before = await counts();
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-4"));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details.field).toBe("slug");
    expect(await counts()).toEqual(before);
  });

  it("origen invalido responde 422, no deja filas y no consume la clave", async () => {
    const invalid = { ...NEW_TENANT, allowed_origins: ["http://nueva.test"] };
    const response = await createTenant(platformPost(TENANTS_URL, invalid, "alta-5"));
    expect(response.status).toBe(422);
    expect(await counts()).toEqual({ tenants: 0, configs: 0, keys: 0, entries: 0 });
    expect(await prisma.platformIdempotencyKey.count()).toBe(0);

    const retried = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-5"));
    expect(retried.status).toBe(201);
  });

  it("sin Idempotency-Key responde 422", async () => {
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT));
    expect(response.status).toBe(422);
  });

  it("un token emitido para el tenant nuevo lee su configuracion", async () => {
    const { tenant } = await (await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-6"))).json();
    const { token } = await (
      await issueToken(platformPost(TOKENS_URL, { tenant_id: tenant.id, role: "operator", subject: "op" }))
    ).json();
    const config = await (await getBotConfig(authedRequest("http://localhost/api/v1/bot-config", token))).json();
    expect(config.allowed_origins).toEqual(["https://nueva.test"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/alta-chatbot.test.ts`
Expected: FAIL: la ruta de tenants no exporta `POST`.

- [ ] **Step 3: Provisioning (bot-config) and port (platform)**

`backend/src/modules/bot-config/application/provisioning.ts`:

```ts
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { OriginPolicy } from "../domain/allowed-origins";
import { applyPatch, EMPTY_OVERRIDES } from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import type { WidgetKeyGenerator } from "../domain/ports/widget-key-generator";

export type ProvisionBotConfig = (input: {
  tenantId: TenantId;
  allowedOrigins: unknown;
}) => Promise<{ widgetKey: string }>;

type Deps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly generator: WidgetKeyGenerator;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly originPolicy: OriginPolicy;
};

/** Config con predeterminados (solo los origenes del alta) y la primera clave vigente. */
export function createProvisionBotConfig(deps: Deps): ProvisionBotConfig {
  return async ({ tenantId, allowedOrigins }) => {
    const overrides = applyPatch(EMPTY_OVERRIDES, { allowedOrigins }, deps.originPolicy);
    await deps.configs.create(tenantId, overrides);
    const widgetKey = deps.generator.next();
    await deps.keys.insert({
      id: deps.ids.next(),
      tenantId,
      key: widgetKey,
      createdAt: deps.clock.now(),
      retiredAt: null,
      graceUntil: null,
    });
    return { widgetKey };
  };
}
```

`backend/src/modules/platform/domain/ports/provisioning.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Lo que el alta necesita de los modulos dueños; el composition root lo cumple. */
export type TenantProvisioning = {
  provisionBotConfig(input: {
    tenantId: TenantId;
    allowedOrigins: unknown;
  }): Promise<{ widgetKey: string }>;
  seedKnowledge(tenantId: TenantId): Promise<void>;
};
```

- [ ] **Step 4: Register-tenant use case**

`backend/src/modules/platform/application/register-tenant.ts`:

```ts
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { PLATFORM_AUDIT_ACTOR } from "../domain/platform-actor";
import type { TenantProvisioning } from "../domain/ports/provisioning";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import { parseTenantDraft, type TenantSummary } from "../domain/tenant-registration";

export type RegisterTenant = (input: {
  raw: unknown;
  requestId: string;
}) => Promise<{ tenant: TenantSummary; widgetKey: string }>;

type Deps = {
  readonly registry: TenantRegistry;
  readonly provisioning: TenantProvisioning;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/**
 * Alta en una transaccion: tenant, bot-config, clave y KB de ejemplo. Cualquier fallo
 * (slug repetido, origen invalido) revierte todo, incluida la reserva de la Idempotency-Key.
 */
export function createRegisterTenant(deps: Deps): RegisterTenant {
  return async ({ raw, requestId }) => {
    const draft = parseTenantDraft(raw);
    const tenant = await deps.registry.create({
      id: deps.ids.next(),
      slug: draft.slug,
      name: draft.name,
    });
    const tenantId = toTenantId(tenant.id);
    const { widgetKey } = await deps.provisioning.provisionBotConfig({
      tenantId,
      allowedOrigins: draft.allowedOrigins,
    });
    await deps.provisioning.seedKnowledge(tenantId);
    await deps.audit.record({
      tenantId,
      ...PLATFORM_AUDIT_ACTOR,
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: tenant.id,
      requestId,
      occurredAt: deps.clock.now(),
    });
    return { tenant, widgetKey };
  };
}
```

- [ ] **Step 5: Idempotent platform route, POST route, OpenAPI**

Añade al final de `backend/src/http/platform-route.ts` (con los imports: `type WritePorts` de `@/composition-root`, `PLATFORM_AUDIT_ACTOR` de `@/modules/platform/domain/platform-actor`, y `type IdempotentOutcome, idempotentJson, platformScope, readIdempotentRequest, runIdempotent` de `./idempotency-core`):

```ts
type PlatformWriteHandler = (context: {
  requestId: string;
  body: unknown;
  ports: WritePorts;
}) => Promise<IdempotentOutcome>;

/** Escritura de plataforma con `Idempotency-Key` en su propio ambito (sin tenant). */
export function platformIdempotentRoute(handler: PlatformWriteHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    try {
      const container = getContainer();
      requirePlatform(request.headers.get("Authorization"), container.config.platformSecret);
      const idempotent = await readIdempotentRequest(request, PLATFORM_AUDIT_ACTOR.actorSubject);
      const result = await runIdempotent({
        request: idempotent,
        outside: platformScope(container.platformIdempotencyStore),
        inside: (ports) => platformScope(ports.platformIdempotencyStore),
        execute: (ports) => handler({ requestId, body: idempotent.body, ports }),
      });
      return idempotentJson(result, requestId);
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  };
}
```

En `backend/src/app/api/platform/v1/tenants/route.ts` añade (import `platformIdempotentRoute`):

```ts
export const POST = platformIdempotentRoute(async ({ requestId, body, ports }) => {
  const { tenant, widgetKey } = await ports.registerTenant({ raw: body, requestId });
  return { status: 201, body: { tenant: tenantJson(tenant), widget_key: widgetKey } };
});
```

En `openapi-platform.ts` añade `createdJson` e `IDEMPOTENCY_PARAMETER` al import de `./openapi-shared`, declara junto a `readErrors`:

```ts
const writeErrors = errorResponses([
  "unauthorized",
  "not_found",
  "validation_failed",
  "conflict",
  "internal_error",
]);
```

y añade a `SCHEMAS`:

```ts
  TenantRequest: {
    type: "object",
    required: ["slug", "name"],
    properties: {
      slug: { type: "string", pattern: "^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$" },
      name: { type: "string", minLength: 1, maxLength: 120 },
      allowed_origins: { type: "array", maxItems: 20, items: { type: "string" } },
    },
  },
  TenantCreated: {
    type: "object",
    required: ["tenant", "widget_key"],
    properties: {
      tenant: { $ref: "#/components/schemas/Tenant" },
      widget_key: { type: "string", description: "Clave publica del widget (va en el HTML)." },
    },
  },
```

y en `paths["/tenants"]`:

```ts
        post: {
          operationId: "createTenant",
          description:
            "Alta con predeterminados: bot-config, KB de ejemplo y primera clave del widget.",
          security: platformAuth,
          parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/TenantRequest" } } },
          },
          responses: { ...createdJson({ $ref: "#/components/schemas/TenantCreated" }), ...writeErrors },
        },
```

Run: `npm --prefix backend run openapi:generate`

- [ ] **Step 6: Wire the composition root**

Añade `type PlatformWritePorts = ReturnType<typeof platformWritePorts>;`, amplía `WritePorts = BaseWritePorts & BotConfigWritePorts & KnowledgeWritePorts & PlatformWritePorts`, y en `buildWritePorts` añade `...platformWritePorts(db, config, auditLog)`:

```ts
function platformWritePorts(db: PrismaExecutor, config: AppConfig, auditLog: AuditLog) {
  const provisioning: TenantProvisioning = {
    provisionBotConfig: createProvisionBotConfig({
      configs: createPrismaBotConfigRepository(db),
      keys: createPrismaWidgetKeyRepository(db),
      generator: cryptoWidgetKeyGenerator,
      ids: uuidV7Generator,
      clock: systemClock,
      originPolicy: originPolicyOf(config),
    }),
    seedKnowledge: createSeedDefaultKnowledge({
      repo: createPrismaKnowledgeRepository(db),
      ids: uuidV7Generator,
    }),
  };
  return {
    registerTenant: createRegisterTenant({
      registry: createPrismaTenantRegistry(db),
      provisioning,
      ids: uuidV7Generator,
      audit: auditLog,
      clock: systemClock,
    }),
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix backend exec vitest run --project db tests/db/alta-chatbot.test.ts`
Run: `npm --prefix backend exec vitest run --project unit tests/contrato-api.test.ts` y `npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/bot-config/application/provisioning.ts backend/src/modules/platform backend/src/http/platform-route.ts backend/src/http/openapi-platform.ts backend/src/app/api/platform/v1/tenants/route.ts backend/src/composition-root.ts backend/openapi-platform.json backend/tests/db/alta-chatbot.test.ts
git commit -m "feat(platform): alta de tenant con bot-config, KB de ejemplo y clave del widget"
```

---

### Task 13: Sesiones del widget

**Files:**
- Modify: `backend/src/config/env.ts` (`trustProxy`)
- Create: `backend/src/modules/bot-config/application/widget-access.ts`
- Create: `backend/src/modules/widget/domain/widget-session.ts`
- Create: `backend/src/modules/widget/domain/ports/ports.ts`
- Create: `backend/src/modules/widget/application/admit-widget.ts`
- Create: `backend/src/modules/widget/application/widget-sessions.ts`
- Create: `backend/src/modules/widget/infrastructure/prisma-widget-session-repository.ts`
- Create: `backend/src/modules/widget/infrastructure/in-memory-rate-limiter.ts`
- Create: `backend/src/http/client-ip.ts`
- Create: `backend/src/http/widget-session-response.ts`
- Create: `backend/src/app/api/v1/widget/sessions/route.ts`
- Create: `backend/src/app/api/v1/widget/sessions/refresh/route.ts`
- Modify: `backend/src/http/openapi-paths-chatbot.ts`, `backend/src/composition-root.ts`
- Regenerate: `backend/openapi.json`
- Test: `backend/tests/dominio/sesion-widget.test.ts`, `backend/tests/db/sesion-widget.test.ts`, `backend/tests/db/alta-chatbot.test.ts`

**Interfaces:**
- Consumes: `TokenIssuer` (Task 6), `WIDGET_KEY_PATTERN`, `isKeyAccepted`, `effectiveConfig` (Tasks 3–4), repositorios (Task 7), `RateLimitedError` (Task 2), núcleo de idempotencia y `idempotentRoute` con `rebuild` (Task 10).
- Produces:
  - `AppConfig.trustProxy: boolean` (`TRUST_PROXY=true`)
  - `createResolveWidgetKey(deps: { configs; keys }): (key: string, now: Date) => Promise<{ tenantId: TenantId; allowedOrigins: readonly string[]; params: BotParams } | null>`, `createReadBotParams(configs): (tenantId: TenantId) => Promise<BotParams>`
  - `type WidgetSession = { id; tenantId: TenantId; origin; createdAt; expiresAt; lastSeenAt }`, `ANONYMOUS_WIDGET_SUBJECT = "widget:anonymous"`, `MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH = 32`, `isSessionActive(s, now)`, `sessionExpiry(now, ttlMinutes)`, `originAllowed(origin: string | null, allowed: readonly string[])`, `sessionSubject(id)`
  - Puertos: `WidgetAccess`, `WidgetKeyResolver`, `WidgetSettingsReader`, `WidgetSessionRepository = { create(s); get(tenantId, id); extend(s) }`, `RateDecision`, `RateLimiter = { hit(bucket: string, limit: number, now: Date): RateDecision }`
  - `createAdmitWidget(deps: { resolveKey; rateLimiter; clock }): (input: { widgetKey: unknown; origin: string | null; clientIp: string | null }) => Promise<WidgetAccess>`
  - `createStartWidgetSession`, `createGetActiveWidgetSession`, `createRefreshWidgetSession`, `createIssueSessionToken` (firmas en el código)
  - `createInMemoryRateLimiter(): RateLimiter` (ventana fija de 60 s)
  - `clientIp(request: Request, trustProxy: boolean): string | null`
  - `sessionTokenJson(session, issued)`, `rebuildSessionResponse(stored, tenantId, expectedSessionId?)`
  - `Container` gana `admitWidget`, `issueSessionToken`, `getActiveWidgetSession`; `WritePorts` gana `startWidgetSession`, `refreshWidgetSession`.

- [ ] **Step 1: Write the failing domain test**

`backend/tests/dominio/sesion-widget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clientIp } from "@/http/client-ip";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createAdmitWidget } from "@/modules/widget/application/admit-widget";
import type { WidgetAccess } from "@/modules/widget/domain/ports/ports";
import { isSessionActive, originAllowed, sessionExpiry } from "@/modules/widget/domain/widget-session";
import { createInMemoryRateLimiter } from "@/modules/widget/infrastructure/in-memory-rate-limiter";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const ACCESS: WidgetAccess = {
  tenantId: toTenantId("tenant-a"),
  allowedOrigins: ["https://clinica-a.test"],
  sessionTtlMinutes: 30,
  sessionsPerIpPerMinute: 2,
};

describe("sesion-widget: limitador de ventana fija", () => {
  it("admite hasta el limite y luego pide esperar lo que falta de la ventana", () => {
    const limiter = createInMemoryRateLimiter();
    expect(limiter.hit("b", 2, NOW)).toEqual({ allowed: true });
    expect(limiter.hit("b", 2, new Date(NOW.getTime() + 1000))).toEqual({ allowed: true });
    expect(limiter.hit("b", 2, new Date(NOW.getTime() + 20_000))).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
  });

  it("una ventana nueva reinicia la cuenta y los cubos son independientes", () => {
    const limiter = createInMemoryRateLimiter();
    limiter.hit("b", 1, NOW);
    expect(limiter.hit("otro", 1, NOW)).toEqual({ allowed: true });
    expect(limiter.hit("b", 1, new Date(NOW.getTime() + 60_000))).toEqual({ allowed: true });
  });
});

describe("sesion-widget: IP del cliente", () => {
  const request = (xff?: string) =>
    new Request("http://localhost/x", { headers: xff ? { "X-Forwarded-For": xff } : {} });

  it("sin TRUST_PROXY ignora X-Forwarded-For", () => {
    expect(clientIp(request("1.1.1.1"), false)).toBeNull();
  });

  it("con TRUST_PROXY toma la primera entrada", () => {
    expect(clientIp(request(" 1.1.1.1 , 10.0.0.1"), true)).toBe("1.1.1.1");
    expect(clientIp(request(), true)).toBeNull();
  });
});

describe("sesion-widget: reglas de sesion", () => {
  it("origen exacto sin distinguir mayusculas; nulo o lista vacia niegan", () => {
    expect(originAllowed("https://Clinica-A.test", ["https://clinica-a.test"])).toBe(true);
    expect(originAllowed("https://otra.test", ["https://clinica-a.test"])).toBe(false);
    expect(originAllowed(null, ["https://clinica-a.test"])).toBe(false);
    expect(originAllowed("https://clinica-a.test", [])).toBe(false);
  });

  it("la sesion vence en el instante de expires_at", () => {
    const session = { expiresAt: sessionExpiry(NOW, 30) };
    expect(session.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(isSessionActive(session, new Date(session.expiresAt.getTime() - 1))).toBe(true);
    expect(isSessionActive(session, session.expiresAt)).toBe(false);
  });
});

describe("sesion-widget: admision", () => {
  const admit = createAdmitWidget({
    resolveKey: async (key) => (key === "wk_ok" ? ACCESS : null),
    rateLimiter: createInMemoryRateLimiter(),
    clock: { now: () => NOW },
  });
  const input = { widgetKey: "wk_ok", origin: "https://clinica-a.test", clientIp: "1.1.1.1" };

  it("clave desconocida o ausente → unauthorized", async () => {
    await expect(admit({ ...input, widgetKey: "wk_no" })).rejects.toMatchObject({ reason: "unauthorized" });
    await expect(admit({ ...input, widgetKey: 42 })).rejects.toBeInstanceOf(AuthError);
  });

  it("origen no permitido → forbidden", async () => {
    await expect(admit({ ...input, origin: "https://otra.test" })).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("supera el limite por IP → RateLimitedError", async () => {
    const ip = { ...input, clientIp: "9.9.9.9" };
    await admit(ip);
    await admit(ip);
    await expect(admit(ip)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/sesion-widget.test.ts`
Expected: FAIL: no se resuelve el módulo.

- [ ] **Step 3: Widget domain and ports**

`backend/src/modules/widget/domain/widget-session.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Sesion del widget. No guarda la IP: esa solo vive en memoria para el rate limit. */
export type WidgetSession = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly origin: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
};

/** Actor de la apertura anonima en `idempotency_keys`. */
export const ANONYMOUS_WIDGET_SUBJECT = "widget:anonymous";

/**
 * En la apertura anonima, la Idempotency-Key hace de secreto del cliente: quien la conozca
 * junto con la clave publica obtendria un token de esa sesion al repetir la peticion.
 */
export const MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH = 32;

export function isSessionActive(session: Pick<WidgetSession, "expiresAt">, now: Date): boolean {
  return now.getTime() < session.expiresAt.getTime();
}

export function sessionExpiry(now: Date, ttlMinutes: number): Date {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

/** Comparacion exacta en minusculas; sin origen o con lista vacia no se admite nada. */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  return origin !== null && allowed.includes(origin.toLowerCase());
}

export function sessionSubject(sessionId: string): string {
  return `widget:${sessionId}`;
}
```

`backend/src/modules/widget/domain/ports/ports.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { WidgetSession } from "../widget-session";

/** Lo que el widget necesita saber de una clave aceptada; lo cumple el modulo bot-config. */
export type WidgetAccess = {
  readonly tenantId: TenantId;
  readonly allowedOrigins: readonly string[];
  readonly sessionTtlMinutes: number;
  readonly sessionsPerIpPerMinute: number;
};

export type WidgetKeyResolver = (key: string, now: Date) => Promise<WidgetAccess | null>;

export type WidgetSettingsReader = (tenantId: TenantId) => Promise<{ readonly sessionTtlMinutes: number }>;

export type WidgetSessionRepository = {
  create(session: WidgetSession): Promise<void>;
  get(tenantId: TenantId, id: string): Promise<WidgetSession | null>;
  /** Actualiza `last_seen_at` y `expires_at`. */
  extend(session: WidgetSession): Promise<void>;
};

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/** Ventana fija de 60 s por cubo. In-memory en Fase 3; store compartido en Fase 6. */
export type RateLimiter = {
  hit(bucket: string, limit: number, now: Date): RateDecision;
};
```

- [ ] **Step 4: Widget use cases and adapters**

`backend/src/modules/widget/application/admit-widget.ts`:

```ts
import { forbidden, unauthorized } from "@/modules/auth/domain/auth-error";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
import type { RateLimiter, WidgetAccess, WidgetKeyResolver } from "../domain/ports/ports";
import { originAllowed } from "../domain/widget-session";

export type AdmitWidget = (input: {
  widgetKey: unknown;
  origin: string | null;
  clientIp: string | null;
}) => Promise<WidgetAccess>;

type Deps = {
  readonly resolveKey: WidgetKeyResolver;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
};

/**
 * Decide si se abre una sesion: el tenant sale de la clave (nunca del cliente), el Origin
 * debe estar permitido y la IP no puede superar el limite por minuto del tenant.
 */
export function createAdmitWidget(deps: Deps): AdmitWidget {
  return async ({ widgetKey, origin, clientIp }) => {
    const now = deps.clock.now();
    const access = typeof widgetKey === "string" ? await deps.resolveKey(widgetKey, now) : null;
    if (!access) {
      throw unauthorized("Clave de widget invalida");
    }
    if (!originAllowed(origin, access.allowedOrigins)) {
      throw forbidden("Origen no permitido para este widget");
    }
    const bucket = `${access.tenantId}|${clientIp ?? "unknown"}`;
    const decision = deps.rateLimiter.hit(bucket, access.sessionsPerIpPerMinute, now);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterSeconds);
    }
    return access;
  };
}
```

`backend/src/modules/widget/application/widget-sessions.ts`:

```ts
import type { TokenIssuer } from "@/modules/auth/domain/ports/token-issuer";
import { unauthorized } from "@/modules/auth/domain/auth-error";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { WidgetAccess, WidgetSessionRepository, WidgetSettingsReader } from "../domain/ports/ports";
import { isSessionActive, sessionExpiry, sessionSubject, type WidgetSession } from "../domain/widget-session";

export function createStartWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  ids: IdGenerator;
  clock: Clock;
}) {
  return async (input: { access: WidgetAccess; origin: string }): Promise<WidgetSession> => {
    const now = deps.clock.now();
    const session: WidgetSession = {
      id: deps.ids.next(),
      tenantId: input.access.tenantId,
      origin: input.origin.toLowerCase(),
      createdAt: now,
      expiresAt: sessionExpiry(now, input.access.sessionTtlMinutes),
      lastSeenAt: now,
    };
    await deps.sessions.create(session);
    return session;
  };
}

/** La vigencia se evalua al leer: una sesion vencida es `unauthorized`. */
export function createGetActiveWidgetSession(deps: { sessions: WidgetSessionRepository; clock: Clock }) {
  return async (tenantId: TenantId, sessionId: string): Promise<WidgetSession> => {
    const session = await deps.sessions.get(tenantId, sessionId);
    if (!session || !isSessionActive(session, deps.clock.now())) {
      throw unauthorized("Sesion vencida o inexistente");
    }
    return session;
  };
}

export function createRefreshWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  settings: WidgetSettingsReader;
  clock: Clock;
}) {
  const getActive = createGetActiveWidgetSession(deps);
  return async (input: { tenantId: TenantId; sessionId: string }): Promise<WidgetSession> => {
    const session = await getActive(input.tenantId, input.sessionId);
    const now = deps.clock.now();
    const { sessionTtlMinutes } = await deps.settings(input.tenantId);
    const refreshed = { ...session, lastSeenAt: now, expiresAt: sessionExpiry(now, sessionTtlMinutes) };
    await deps.sessions.extend(refreshed);
    return refreshed;
  };
}

export type SessionToken = { readonly token: string; readonly expiresAt: Date };

/** El token del widget expira con la sesion y lleva su `session_id`. */
export function createIssueSessionToken(deps: { issuer: TokenIssuer; clock: Clock }) {
  return async (session: WidgetSession): Promise<SessionToken> => ({
    token: await deps.issuer.issue({
      subject: sessionSubject(session.id),
      tenantId: session.tenantId,
      role: "widget",
      sessionId: session.id,
      issuedAt: deps.clock.now(),
      expiresAt: session.expiresAt,
    }),
    expiresAt: session.expiresAt,
  });
}
```

`backend/src/modules/widget/infrastructure/in-memory-rate-limiter.ts`:

```ts
import type { RateLimiter } from "../domain/ports/ports";

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

/** Ventana fija en memoria. Valida con una sola replica; la Fase 6 la cambia por un store compartido. */
export function createInMemoryRateLimiter(): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  function prune(now: number): void {
    for (const [bucket, window] of windows) {
      if (now - window.start >= WINDOW_MS) {
        windows.delete(bucket);
      }
    }
  }

  return {
    hit(bucket, limit, now) {
      const t = now.getTime();
      const current = windows.get(bucket);
      const window = current && t - current.start < WINDOW_MS ? current : { start: t, count: 0 };
      if (window.count >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((window.start + WINDOW_MS - t) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
      window.count += 1;
      windows.set(bucket, window);
      if (windows.size > MAX_BUCKETS) {
        prune(t);
      }
      return { allowed: true };
    },
  };
}
```

`backend/src/modules/widget/infrastructure/prisma-widget-session-repository.ts`:

```ts
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { WidgetSessionRepository } from "../domain/ports/ports";

export function createPrismaWidgetSessionRepository(db: PrismaExecutor): WidgetSessionRepository {
  return {
    async create(session) {
      await db.widgetSession.create({ data: { ...session } });
    },
    async get(tenantId, id) {
      const row = await db.widgetSession.findFirst({ where: { tenantId, id } });
      return row ? { ...row, tenantId: toTenantId(row.tenantId) } : null;
    },
    async extend(session) {
      await db.widgetSession.updateMany({
        where: { tenantId: session.tenantId, id: session.id },
        data: { lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt },
      });
    },
  };
}
```

- [ ] **Step 5: Bot-config side and client IP**

`backend/src/modules/bot-config/application/widget-access.ts`:

```ts
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { type BotParams, effectiveConfig } from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import { isKeyAccepted, WIDGET_KEY_PATTERN } from "../domain/widget-key";

export type WidgetKeyAccess = {
  readonly tenantId: TenantId;
  readonly allowedOrigins: readonly string[];
  readonly params: BotParams;
};

/** Resuelve una clave publica a su tenant; `null` si no existe, esta retirada o vencio su gracia. */
export function createResolveWidgetKey(deps: {
  configs: BotConfigRepository;
  keys: WidgetKeyRepository;
}) {
  return async (key: string, now: Date): Promise<WidgetKeyAccess | null> => {
    if (!WIDGET_KEY_PATTERN.test(key)) {
      return null;
    }
    const found = await deps.keys.findByKey(key);
    if (!found || !isKeyAccepted(found, now)) {
      return null;
    }
    const overrides = await deps.configs.get(found.tenantId);
    if (!overrides) {
      return null;
    }
    const config = effectiveConfig(overrides);
    return { tenantId: found.tenantId, allowedOrigins: config.allowedOrigins, params: config.params };
  };
}

export function createReadBotParams(configs: BotConfigRepository) {
  return async (tenantId: TenantId): Promise<BotParams> => {
    const overrides = await configs.get(tenantId);
    if (!overrides) {
      throw new NotFoundError();
    }
    return effectiveConfig(overrides).params;
  };
}
```

`backend/src/http/client-ip.ts`:

```ts
/**
 * IP del cliente para el rate limit. Solo se confia en X-Forwarded-For detras de un proxy
 * propio (Traefik en Easypanel descarta el X-Forwarded-For que manda el cliente y pone el
 * suyo). Sin TRUST_PROXY todo cae en un cubo comun: restrictivo pero imposible de evadir.
 */
export function clientIp(request: Request, trustProxy: boolean): string | null {
  if (!trustProxy) {
    return null;
  }
  const first = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return first ? first : null;
}
```

En `backend/src/config/env.ts`: añade `readonly trustProxy: boolean;` a `AppConfig` y `trustProxy: optional("TRUST_PROXY", "false") === "true",` en `loadConfig`.

- [ ] **Step 6: Run the domain test**

Run: `npm --prefix backend exec vitest run --project unit tests/dominio/sesion-widget.test.ts tests/fronteras.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing HTTP test**

`backend/tests/db/sesion-widget.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getBotConfig } from "@/app/api/v1/bot-config/route";
import { GET as listEntries } from "@/app/api/v1/knowledge-entries/route";
import { POST as refreshSession } from "@/app/api/v1/widget/sessions/refresh/route";
import { POST as openSession } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import { createJoseTokenVerifier } from "@/modules/auth/infrastructure/jose-token-verifier";
import { authedRequest, signToken, TEST_JWT } from "../helpers/token";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const verifier = createJoseTokenVerifier(TEST_JWT);
const ORIGIN = "https://clinica-a.test";
const SESSIONS_URL = "http://localhost/api/v1/widget/sessions";
const REFRESH_URL = "http://localhost/api/v1/widget/sessions/refresh";

function open(widgetKey: unknown, headers: Record<string, string> = {}) {
  return openSession(
    new Request(SESSIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "Idempotency-Key": randomUUID(), ...headers },
      body: JSON.stringify({ widget_key: widgetKey }),
    }),
  );
}

function refresh(token: string, key = randomUUID()) {
  return refreshSession(authedRequest(REFRESH_URL, token, { method: "POST", headers: { "Idempotency-Key": key } }));
}

describe("sesion-widget: apertura", () => {
  let seed: ChatbotTenantSeed;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    resetContainer();
    await prisma.$disconnect();
  });

  it("clave y origen validos abren una sesion con token de widget", async () => {
    const before = Date.now();
    const response = await open(seed.widgetKey);
    const body = await response.json();

    expect(response.status).toBe(201);
    const claims = await verifier.verify(body.token);
    expect(claims).toEqual({
      subject: `widget:${body.session_id}`,
      tenantId: seed.tenantId,
      role: "widget",
      sessionId: body.session_id,
    });
    const expiresAt = new Date(body.expires_at).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(await prisma.widgetSession.findUniqueOrThrow({ where: { id: body.session_id } })).toMatchObject({
      tenantId: seed.tenantId,
      origin: ORIGIN,
    });
  });

  it("clave en gracia abre; con la gracia vencida, retirada o desconocida responde 401", async () => {
    const retired = `wk_${"g".repeat(43)}`;
    await prisma.widgetKey.create({
      data: {
        id: "k-grace",
        tenantId: seed.tenantId,
        key: retired,
        createdAt: new Date(),
        retiredAt: new Date(),
        graceUntil: new Date(Date.now() + 60_000),
      },
    });
    expect((await open(retired)).status).toBe(201);

    await prisma.widgetKey.update({ where: { id: "k-grace" }, data: { graceUntil: new Date(Date.now() - 1) } });
    expect((await open(retired)).status).toBe(401);
    expect((await open(`wk_${"u".repeat(43)}`)).status).toBe(401);
    expect((await open("no-es-una-clave")).status).toBe(401);
  });

  it("origen ausente, ajeno o con lista vacia responde 403", async () => {
    expect((await open(seed.widgetKey, { Origin: "https://otra.test" })).status).toBe(403);
    const other = await insertChatbotTenant(prisma, "b");
    expect((await open(other.widgetKey)).status).toBe(403);

    const noOrigin = await openSession(
      new Request(SESSIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ widget_key: seed.widgetKey }),
      }),
    );
    expect(noOrigin.status).toBe(403);
  });

  it("supera el limite por IP y responde 429 con Retry-After", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 2 } },
    });
    expect((await open(seed.widgetKey)).status).toBe(201);
    expect((await open(seed.widgetKey)).status).toBe(201);
    const limited = await open(seed.widgetKey);
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("sin TRUST_PROXY un X-Forwarded-For falsificado no abre cubos nuevos", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 2 } },
    });
    await open(seed.widgetKey, { "X-Forwarded-For": "1.1.1.1" });
    await open(seed.widgetKey, { "X-Forwarded-For": "2.2.2.2" });
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "3.3.3.3" })).status).toBe(429);
  });

  it("con TRUST_PROXY cada IP tiene su propio cubo", async () => {
    process.env.TRUST_PROXY = "true";
    resetContainer();
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 1 } },
    });
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "1.1.1.1" })).status).toBe(201);
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "1.1.1.1" })).status).toBe(429);
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "2.2.2.2" })).status).toBe(201);
    delete process.env.TRUST_PROXY;
    resetContainer();
  });

  it("idempotencia: repetir con la misma clave devuelve la misma sesion y no guarda el JWT", async () => {
    const key = randomUUID();
    const first = await (await open(seed.widgetKey, { "Idempotency-Key": key })).json();
    const again = await open(seed.widgetKey, { "Idempotency-Key": key });
    const againBody = await again.json();

    expect(again.status).toBe(201);
    expect(againBody.session_id).toBe(first.session_id);
    expect((await verifier.verify(againBody.token)).sessionId).toBe(first.session_id);
    expect(await prisma.widgetSession.count()).toBe(1);
    const stored = await prisma.idempotencyKey.findFirstOrThrow();
    expect(stored.responseBody).toEqual({ session_id: first.session_id });
  });

  it("una Idempotency-Key de menos de 32 caracteres responde 422", async () => {
    const response = await open(seed.widgetKey, { "Idempotency-Key": "corta" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toMatchObject({ min_length: 32 });
  });
});

describe("sesion-widget: renovacion y alcance", () => {
  let token: string;
  let sessionId: string;
  let seed: ChatbotTenantSeed;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
    const body = await (await open(seed.widgetKey)).json();
    token = body.token;
    sessionId = body.session_id;
  });

  it("renueva la propia sesion y alarga expires_at", async () => {
    const before = await prisma.widgetSession.findUniqueOrThrow({ where: { id: sessionId } });
    const response = await refresh(token);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session_id).toBe(sessionId);
    const after = await prisma.widgetSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.expiresAt.getTime()).toBeGreaterThanOrEqual(before.expiresAt.getTime());
    expect((await verifier.verify(body.token)).sessionId).toBe(sessionId);
  });

  it("una sesion vencida no se renueva", async () => {
    await prisma.widgetSession.update({
      where: { id: sessionId },
      data: { createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh(token)).status).toBe(401);
  });

  it("la Idempotency-Key de otra sesion no entrega su token", async () => {
    const key = randomUUID();
    expect((await refresh(token, key)).status).toBe(200);
    const other = await (await open(seed.widgetKey)).json();
    const response = await refresh(other.token, key);
    expect(response.status).toBe(409);
  });

  it("operator no renueva sesiones y el widget no alcanza config ni KB", async () => {
    const operator = await signToken({ role: "operator", tenantId: seed.tenantId });
    expect((await refresh(operator)).status).toBe(403);
    expect((await getBotConfig(authedRequest("http://localhost/api/v1/bot-config", token))).status).toBe(403);
    expect((await listEntries(authedRequest("http://localhost/api/v1/knowledge-entries", token))).status).toBe(403);
  });
});
```

Añade a `backend/tests/db/alta-chatbot.test.ts` (import `POST as openWidgetSession` de `@/app/api/v1/widget/sessions/route` y `randomUUID` de `node:crypto`):

```ts
describe("alta-chatbot: la primera clave abre sesion", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("la clave devuelta por el alta abre una sesion desde un origen permitido", async () => {
    const { widget_key } = await (await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-w"))).json();
    const response = await openWidgetSession(
      new Request("http://localhost/api/v1/widget/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://nueva.test",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ widget_key }),
      }),
    );
    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm --prefix backend exec vitest run --project db tests/db/sesion-widget.test.ts`
Expected: FAIL: no se resuelven las rutas del widget.

- [ ] **Step 9: Responses, routes and OpenAPI**

`backend/src/http/widget-session-response.ts`:

```ts
import { getContainer } from "@/composition-root";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { SessionToken } from "@/modules/widget/application/widget-sessions";
import type { WidgetSession } from "@/modules/widget/domain/widget-session";
import type { IdempotentResult } from "./idempotency-core";

export function sessionTokenJson(session: WidgetSession, issued: SessionToken) {
  return {
    session_id: session.id,
    token: issued.token,
    expires_at: issued.expiresAt.toISOString(),
  };
}

function storedSessionId(stored: IdempotentResult): string | null {
  const body = stored.body;
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const sessionId = (body as { session_id?: unknown }).session_id;
  return typeof sessionId === "string" ? sessionId : null;
}

/**
 * Repeticion idempotente de apertura o renovacion: lo guardado es `{ session_id }` y el
 * token se vuelve a firmar si la sesion sigue vigente. Si se espera una sesion concreta
 * (renovacion), la clave de otra sesion es un conflicto y no entrega su token.
 */
export async function rebuildSessionResponse(
  stored: IdempotentResult,
  tenantId: TenantId,
  expectedSessionId?: string,
): Promise<IdempotentResult> {
  const sessionId = storedSessionId(stored);
  if (sessionId === null) {
    return stored;
  }
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion");
  }
  const container = getContainer();
  const session = await container.getActiveWidgetSession(tenantId, sessionId);
  return { status: stored.status, body: sessionTokenJson(session, await container.issueSessionToken(session)) };
}
```

`backend/src/app/api/v1/widget/sessions/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { clientIp } from "@/http/client-ip";
import { errorResponse, toApiError } from "@/http/errors";
import { idempotentJson, readIdempotentRequest, runIdempotent, tenantScope } from "@/http/idempotency-core";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/http/request-id";
import { rebuildSessionResponse, sessionTokenJson } from "@/http/widget-session-response";
import {
  ANONYMOUS_WIDGET_SUBJECT,
  MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH,
} from "@/modules/widget/domain/widget-session";

export const dynamic = "force-dynamic";

function widgetKeyOf(body: unknown): unknown {
  return typeof body === "object" && body !== null ? (body as { widget_key?: unknown }).widget_key : undefined;
}

/** Apertura anonima: la clave publica resuelve el tenant; el cliente nunca lo elige. */
export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    const container = getContainer();
    const idempotent = await readIdempotentRequest(
      request,
      ANONYMOUS_WIDGET_SUBJECT,
      MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH,
    );
    const origin = request.headers.get("Origin") ?? "";
    const access = await container.admitWidget({
      widgetKey: widgetKeyOf(idempotent.body),
      origin: origin === "" ? null : origin,
      clientIp: clientIp(request, container.config.trustProxy),
    });
    const result = await runIdempotent({
      request: idempotent,
      outside: tenantScope(container.idempotencyStore, access.tenantId),
      inside: (ports) => tenantScope(ports.idempotencyStore, access.tenantId),
      execute: async (ports) => {
        const session = await ports.startWidgetSession({ access, origin });
        const issued = await container.issueSessionToken(session);
        return { status: 201, body: sessionTokenJson(session, issued), stored: { session_id: session.id } };
      },
      rebuild: (stored) => rebuildSessionResponse(stored, access.tenantId),
    });
    return idempotentJson(result, requestId);
  } catch (error) {
    return errorResponse(toApiError(error), requestId);
  }
}
```

`backend/src/app/api/v1/widget/sessions/refresh/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { rebuildSessionResponse, sessionTokenJson } from "@/http/widget-session-response";
import type { Actor } from "@/modules/auth/domain/actor";
import { unauthorized } from "@/modules/auth/domain/auth-error";

export const dynamic = "force-dynamic";

function sessionIdOf(actor: Actor): string {
  if (!actor.sessionId) {
    throw unauthorized();
  }
  return actor.sessionId;
}

/** El widget renueva solo la sesion de su propio token. */
export const POST = idempotentRoute(
  ["widget"],
  async ({ actor, ports }) => {
    const session = await ports.refreshWidgetSession({
      tenantId: actor.tenantId,
      sessionId: sessionIdOf(actor),
    });
    const issued = await getContainer().issueSessionToken(session);
    return { status: 200, body: sessionTokenJson(session, issued), stored: { session_id: session.id } };
  },
  { rebuild: (stored, actor) => rebuildSessionResponse(stored, actor.tenantId, sessionIdOf(actor)) },
);
```

En `openapi-paths-chatbot.ts` añade a `CHATBOT_SCHEMAS`:

```ts
  WidgetSessionRequest: {
    type: "object",
    required: ["widget_key"],
    properties: { widget_key: { type: "string" } },
  },
  WidgetSession: {
    type: "object",
    required: ["session_id", "token", "expires_at"],
    properties: {
      session_id: { type: "string" },
      token: { type: "string" },
      expires_at: { type: "string", format: "date-time" },
    },
  },
```

y a `CHATBOT_PATHS` (importa también `errorResponses`):

```ts
  "/widget/sessions": {
    post: {
      operationId: "openWidgetSession",
      description:
        "Publica: la clave del widget resuelve el tenant. Exige cabecera Origin permitida e " +
        "Idempotency-Key de al menos 32 caracteres (secreto del cliente: no se registra).",
      security: [],
      parameters: [REQUEST_ID_PARAMETER, { ...IDEMPOTENCY_PARAMETER, schema: { type: "string", minLength: 32 } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/WidgetSessionRequest" } } },
      },
      responses: {
        ...createdJson({ $ref: "#/components/schemas/WidgetSession" }),
        ...errorResponses(["unauthorized", "forbidden", "validation_failed", "conflict", "rate_limited", "internal_error"]),
      },
    },
  },
  "/widget/sessions/refresh": {
    post: {
      operationId: "refreshWidgetSession",
      description: "Solo rol widget: renueva la sesion de su propio token.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      responses: { ...okJson({ $ref: "#/components/schemas/WidgetSession" }), ...writeErrors },
    },
  },
```

Run: `npm --prefix backend run openapi:generate`

- [ ] **Step 10: Wire the composition root**

Añade `type WidgetWritePorts = ReturnType<typeof widgetWritePorts>;`, amplía `WritePorts` con `& WidgetWritePorts`, en `buildWritePorts` `...widgetWritePorts(db)`, en `Container` `readonly admitWidget: AdmitWidget; readonly issueSessionToken: (session: WidgetSession) => Promise<SessionToken>; readonly getActiveWidgetSession: (tenantId: TenantId, sessionId: string) => Promise<WidgetSession>;`, en `getContainer` `...widgetReads(prisma, config),`, y:

```ts
function widgetKeyResolver(configs: BotConfigRepository, keys: WidgetKeyRepository): WidgetKeyResolver {
  const resolve = createResolveWidgetKey({ configs, keys });
  return async (key, now) => {
    const access = await resolve(key, now);
    return (
      access && {
        tenantId: access.tenantId,
        allowedOrigins: access.allowedOrigins,
        sessionTtlMinutes: access.params.widget_session_ttl_minutes,
        sessionsPerIpPerMinute: access.params.widget_sessions_per_ip_per_minute,
      }
    );
  };
}

function widgetSettingsReader(configs: BotConfigRepository): WidgetSettingsReader {
  const readParams = createReadBotParams(configs);
  return async (tenantId) => ({
    sessionTtlMinutes: (await readParams(tenantId)).widget_session_ttl_minutes,
  });
}

function widgetWritePorts(db: PrismaExecutor) {
  const sessions = createPrismaWidgetSessionRepository(db);
  return {
    startWidgetSession: createStartWidgetSession({ sessions, ids: uuidV7Generator, clock: systemClock }),
    refreshWidgetSession: createRefreshWidgetSession({
      sessions,
      settings: widgetSettingsReader(createPrismaBotConfigRepository(db)),
      clock: systemClock,
    }),
  };
}

function widgetReads(prisma: PrismaClient, config: AppConfig) {
  return {
    admitWidget: createAdmitWidget({
      resolveKey: widgetKeyResolver(
        createPrismaBotConfigRepository(prisma),
        createPrismaWidgetKeyRepository(prisma),
      ),
      rateLimiter: createInMemoryRateLimiter(),
      clock: systemClock,
    }),
    issueSessionToken: createIssueSessionToken({
      issuer: createJoseTokenIssuer(config.jwt),
      clock: systemClock,
    }),
    getActiveWidgetSession: createGetActiveWidgetSession({
      sessions: createPrismaWidgetSessionRepository(prisma),
      clock: systemClock,
    }),
  };
}
```

(El limitador vive en el contenedor: `resetContainer()` lo reinicia, así cada suite arranca limpia.)

- [ ] **Step 11: Run tests to verify they pass**

Run: `npm --prefix backend exec vitest run --project db tests/db/sesion-widget.test.ts tests/db/alta-chatbot.test.ts`
Run: `npm --prefix backend exec vitest run --project unit tests/contrato-api.test.ts tests/dominio/sesion-widget.test.ts` y `npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add backend/src/config/env.ts backend/src/modules/bot-config/application/widget-access.ts backend/src/modules/widget backend/src/http/client-ip.ts backend/src/http/widget-session-response.ts backend/src/app/api/v1/widget backend/src/http/openapi-paths-chatbot.ts backend/src/composition-root.ts backend/openapi.json backend/tests/dominio/sesion-widget.test.ts backend/tests/db/sesion-widget.test.ts backend/tests/db/alta-chatbot.test.ts
git commit -m "feat(widget): apertura y renovacion de sesiones con limite por IP"
```

---

### Task 14: Suites `sin-ia` y `fronteras` de los módulos nuevos

**Files:**
- Create: `backend/tests/sin-ia.test.ts`
- Modify: `backend/tests/fronteras.test.ts`

**Interfaces:**
- Consumes: estructura de carpetas de las tareas anteriores.
- Produces: suites que fallan si entra una dependencia o un import de IA, o si un módulo nuevo importa otro módulo que no sea `shared` o `auth`.

- [ ] **Step 1: Write the tests**

`backend/tests/sin-ia.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** GOBERNANZA §1.1: ningun LLM, embedding, RAG, base vectorial ni n8n. */
const FORBIDDEN = [
  /^openai$/,
  /^@anthropic-ai\//,
  /^@google\/(generative-ai|genai)$/,
  /^@google-cloud\/(vertexai|aiplatform)$/,
  /^langchain$/,
  /^@langchain\//,
  /^llamaindex$/,
  /^cohere-ai$/,
  /^@mistralai\//,
  /^ollama$/,
  /^@huggingface\//,
  /^@xenova\/transformers$/,
  /^@tensorflow\//,
  /^ai$/,
  /^@ai-sdk\//,
  /^n8n/,
  /^@n8n\//,
  /^@pinecone-database\//,
  /^chromadb$/,
  /^@qdrant\//,
  /^weaviate/,
  /^pgvector$/,
];

const ROOT = join(process.cwd(), "..");
const PACKAGES = ["package.json", "backend/package.json", "frontend/package.json"];
const SOURCES = ["backend/src", "backend/scripts", "backend/prisma", "frontend/src"];
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

const isForbidden = (name: string) => FORBIDDEN.some((pattern) => pattern.test(name));

function listSources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "node_modules" ? [] : listSources(full);
    }
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [full] : [];
  });
}

function dependenciesOf(file: string): string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as Record<string, unknown>;
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (field) => Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}),
  );
}

describe("sin-ia", () => {
  it("ningun package.json declara dependencias de IA ni n8n", () => {
    const offenders = PACKAGES.flatMap((file) =>
      dependenciesOf(file).filter(isForbidden).map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("ningun archivo fuente importa paquetes de IA ni n8n", () => {
    const offenders = SOURCES.flatMap((dir) => listSources(join(ROOT, dir))).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)]
        .map((match) => match[1] as string)
        .filter(isForbidden)
        .map((specifier) => `${file} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("el despliegue no levanta n8n", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
    expect(compose).not.toMatch(/n8n/i);
  });

  it("el detector reconoce lo que debe bloquear", () => {
    expect(["openai", "@langchain/core", "n8n-core", "ai", "@ai-sdk/openai"].every(isForbidden)).toBe(true);
    expect(["jose", "next", "@prisma/client", "aigle"].some(isForbidden)).toBe(false);
  });
});
```

Añade a `backend/tests/fronteras.test.ts`, dentro del `describe("fronteras de capas", ...)`:

```ts
  it("los modulos de la Fase 3 solo importan shared y auth de otros modulos", () => {
    const phase3 = ["bot-config", "knowledge", "widget", "platform"];
    const offenders = phase3.flatMap((mod) => {
      const allowed = new Set([mod, "shared", "auth"]);
      return listFiles(join(MODULES_DIR, mod)).flatMap((file) =>
        importsOf(file)
          .map((specifier) => ({ specifier, module: /modules\/([^/]+)/.exec(specifier)?.[1] }))
          .filter(({ module }) => module !== undefined && !allowed.has(module))
          .map(({ specifier }) => `${file} -> ${specifier}`),
      );
    });

    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Run tests**

Run: `npm --prefix backend exec vitest run --project unit tests/sin-ia.test.ts tests/fronteras.test.ts`
Expected: PASS. Si `fronteras` falla, el mensaje nombra el import cruzado: muévelo detrás de un puerto del módulo que lo necesita, cumplido en el composition root (patrón de `TenantProvisioning` y `WidgetKeyResolver`). Para confirmar que `sin-ia` muerde, añade temporalmente `import OpenAI from "openai";` a un archivo de `backend/src`, comprueba que la suite falla y **revierte ese cambio** antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/sin-ia.test.ts backend/tests/fronteras.test.ts
git commit -m "test: suite sin-ia y fronteras de los modulos de la Fase 3"
```

---

### Task 15: Documentación, entorno, cliente del frontend y verificación final

**Files:**
- Modify: `GOBERNANZA.md`, `README.md`, `backend/.env.example`, `.env.example`, `docker-compose.yml`
- Modify (sin commitear, ver nota): `CLAUDE.md`
- Regenerate: `frontend/src/api/**` (orval)
- Modify: `docs/superpowers/specs/2026-09-22-fase-3-1-tenant-listo-design.md` (estado)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: gobernanza y README al día, cliente orval regenerado, todas las puertas en verde.

- [ ] **Step 1: `GOBERNANZA.md`**

En §1.3, tras el segundo párrafo, añade:

```markdown
**Superficie de plataforma.** `/api/platform/v1` es de un tercer actor, la plataforma, que
no pertenece a ningún tenant: da de alta tenants y emite tokens de panel y de servicio. Se
autentica con `PLATFORM_SECRET` (comparado en tiempo constante; sin él la superficie responde
`404`) y es la **única** superficie donde el tenant viaja en el cuerpo. La regla de esta
sección sigue intacta en `/api/v1` y `/fhir`. Se audita con `actor_subject = platform`.
```

En §1.4, al final:

```markdown
La clave del widget es **pública** (va en el HTML de la clínica): solo identifica al tenant y
abre sesiones desde los `allowed_origins` del tenant. Se guarda en claro y se rota con gracia.
El token del widget sale de una sesión (`POST /api/v1/widget/sessions`) y expira con ella.
```

En §1.6, al final:

```markdown
Excepciones y matices: emitir un token (`POST /api/platform/v1/tokens`) no escribe dominio y
no lleva `Idempotency-Key`, así ningún JWT queda persistido. Cuando la respuesta de una
escritura lleva una credencial (sesión del widget), se persiste solo la referencia
(`session_id`) y la repetición vuelve a firmar el token. En la apertura anónima de sesión la
`Idempotency-Key` actúa como secreto del cliente: mínimo 32 caracteres y nunca se registra.
```

En la tabla de §3 añade la fila:

```markdown
| Plataforma `/api/platform/v1` | Operación (alta de tenants, tokens) | Misma envoltura que REST `/api/v1` |
```

En §5.1 añade `sesion-widget` a la lista de suites (tras `alta-chatbot`).

- [ ] **Step 2: README, ejemplos de entorno y compose**

En `README.md`, sección «Autenticación», sustituye la frase «La emisión de tokens llega en la Fase 3; por ahora se firman a mano para pruebas.» por:

```markdown
Los tokens de panel (`operator`, `admin`) y de servicio los emite
`POST /api/platform/v1/tokens` con `Authorization: Bearer <PLATFORM_SECRET>`; el alta de
tenants es `POST /api/platform/v1/tenants`. El widget obtiene su token abriendo una sesión en
`POST /api/v1/widget/sessions` con la clave pública del tenant. `token:dev` sigue disponible
en desarrollo y aborta con `NODE_ENV=production`.
```

En la tabla «Variables» añade tras `JWT_ISSUER / JWT_AUDIENCE`:

```markdown
| `PLATFORM_SECRET` | backend | Secreto de la superficie de plataforma (≥ 32 caracteres). Sin él, `/api/platform/v1` responde 404 |
| `TRUST_PROXY` | backend | `true` detrás de Traefik (Easypanel): el rate limit usa `X-Forwarded-For` |
```

En «Mapa del código» añade bajo `openapi.json`: `openapi-platform.json       # contrato de /api/platform/v1; generado`. En «Suites actuales» añade las filas:

```markdown
| `conocimiento-config` | Esquema de `bot-config`, rotación de claves, KB y búsqueda por tokens |
| `alta-chatbot` | Alta de tenant con predeterminados y emisión de tokens de plataforma |
| `sesion-widget` | Clave pública, `Origin`, límite por IP, renovación e idempotencia sin JWT persistido |
| `idempotencia` | Repetición sin efectos duplicados en todas las escrituras |
| `sin-ia` | Ninguna dependencia ni import de IA o n8n |
```

En `backend/.env.example` y en `.env.example` (bloque Backend), tras `JWT_AUDIENCE`:

```bash
# Superficie de plataforma (alta de tenants y emision de tokens). >= 32 caracteres.
# Vacio: /api/platform/v1 responde 404.
PLATFORM_SECRET=
# true detras de un proxy propio (Traefik) para que el rate limit use X-Forwarded-For
TRUST_PROXY=false
```

En `docker-compose.yml`, en `backend.environment`, tras `JWT_AUDIENCE`:

```yaml
      PLATFORM_SECRET: ${PLATFORM_SECRET:-}
      TRUST_PROXY: ${TRUST_PROXY:-false}
```

- [ ] **Step 3: `CLAUDE.md` (sin commitear)**

En la lista de suites de «Comandos» añade `fronteras`, `alta-chatbot` y `sesion-widget`. En «Estado actual» añade una línea: «**Fase 3 en curso**: 3.1 (tenant listo para chatear) en la rama `fase-3-1-tenant-listo`; spec en `docs/superpowers/specs/2026-09-22-fase-3-1-tenant-listo-design.md`.» **No commitees `CLAUDE.md`**: el usuario puede tener cambios propios ahí y él hace el commit final. Déjalo modificado y avísalo en el resumen.

- [ ] **Step 4: Regenerate the frontend client**

Run: `npm --prefix backend run openapi:generate` y luego `npm --prefix frontend run api:generate`
Run: `git status --short frontend/src/api` (debe mostrar los modelos nuevos: `botConfig`, `knowledgeEntry`, `widgetSession`, `errorErrorCode` con `rate_limited`, etc.)
Run: `npm --prefix frontend run typecheck` y `npm --prefix frontend test` y `npm run doctor`
Expected: todo en verde (el frontend no usa aún las operaciones nuevas).

- [ ] **Step 5: Full verification**

Run, desde la raíz: `npm run ci`, `npm run typecheck`, `npm test`, `npm --prefix backend run test:db`
Expected: todo en verde. Si `biome ci` falla por formato, corre `npx biome check --write` sobre los archivos de esta fase, revisa el diff y repite.

Revisa también a mano los umbrales de Clean Code en los archivos tocados: ninguna función de más de 40 líneas (en especial `getContainer`, `buildWritePorts` y las rutas de sesión) y ningún archivo de lógica de más de 400. Si `getContainer` pasa de 40 líneas, extrae los grupos de Fase 2 a una función `schedulingReads(prisma)` con el mismo patrón que `botConfigReads`.

- [ ] **Step 6: Mark the spec as implemented**

En `docs/superpowers/specs/2026-09-22-fase-3-1-tenant-listo-design.md`, cambia la línea de estado a:
`> Estado: **implementada** en la rama \`fase-3-1-tenant-listo\` (pendiente de merge por el usuario).`

- [ ] **Step 7: Commit (sin `CLAUDE.md` ni `ROADMAP.md`)**

```bash
git add GOBERNANZA.md README.md backend/.env.example .env.example docker-compose.yml frontend/src/api docs/superpowers/specs/2026-09-22-fase-3-1-tenant-listo-design.md
git commit -m "docs: gobernanza, README y entorno de la Fase 3.1; cliente orval regenerado"
```

Antes de dar la sub-fase por cerrada, deja en el resumen al usuario:
- Que `CLAUDE.md` queda modificado sin commitear.
- Qué variables hay que definir en Easypanel: `PLATFORM_SECRET` (secreto largo aleatorio) y `TRUST_PROXY=true` en el servicio backend.
