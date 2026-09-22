# Fase 2 · Sub-proyecto 1 — Persistencia base: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar en pie el esquema Postgres (chatbot + `hermes_sim`) con migraciones, el núcleo compartido (reloj, IDs, tenant, paginación), los repositorios de ajustes del tenant, auditoría e idempotencia, el seed determinista simétrico y la infraestructura de pruebas contra Postgres, con despliegue que migra al arrancar.

**Architecture:** Prisma 7 con `@prisma/adapter-pg` y multi-schema (`public`, `hermes_sim`). El aislamiento por tenant se refuerza en la base con claves foráneas compuestas `(tenant_id, id)`. Los puertos viven en `domain/` de `shared` y `tenancy`; los adaptadores Prisma en `infrastructure/`. El seed es un script de herramienta (`prisma/seed/`) con un único módulo de datos y dos escritores.

**Tech Stack:** Node 26, TypeScript 7, Next 16 (sin rutas nuevas en este sub-proyecto), Prisma 7.10 + `@prisma/adapter-pg` + `pg`, `uuid` (v5 para el seed, v7 para IDs), Vitest 5 con proyectos `unit` y `db`, Biome 2.5.

**Spec:** `docs/superpowers/specs/2026-09-22-fase-2-dominio-persistido-design.md` (secciones 3, 4.1, 4.2, 5.3, 6, 8 y 9).

## Global Constraints

- Código, campos, rutas y ramas en inglés; comentarios, textos y docs en español.
- `domain/` y `application/` no importan `next`, `@prisma/client`, `react` ni `node:*` (Biome + suite `fronteras`).
- `process.env` solo en `backend/src/config/env.ts` y configs de herramientas (`prisma.config.ts`, `vitest.config.mts`, setup de tests).
- Todo puerto y todo método de repositorio recibe `tenantId` explícito; nunca contexto implícito.
- No se persiste contenido en `audit_events`: se registra el hecho (§1.5 de GOBERNANZA).
- Umbrales: complejidad cognitiva ≤ 15, ≤ 60 líneas por función, ≤ 400 líneas por archivo de lógica, 0 ciclos.
- `limit` por defecto 50, máximo 200. `max_query_range_days` entre 1 y 366, defecto 31.
- Ningún módulo del chatbot importa `modules/hermes-simulator`; `hermes-simulator` solo importa `shared` y `auth`.
- Sin dependencias de LLM, embeddings, RAG ni n8n.
- Commits en la rama `fase-2-dominio`, terminando con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Todos los comandos se ejecutan desde `backend/` salvo que se indique otra cosa.

## Mapa de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/modules/shared/domain/ports/clock.ts` | Puerto de reloj (movido desde `health`) |
| `src/modules/shared/domain/ports/id-generator.ts` | Puerto de IDs |
| `src/modules/shared/domain/tenant-id.ts` | Tipo `TenantId` |
| `src/modules/shared/domain/validation-error.ts` | Error de validación del núcleo |
| `src/modules/shared/domain/pagination.ts` | Límites, cursor opaco, `Page<T>` |
| `src/modules/shared/domain/audit-event.ts` + `ports/audit-log.ts` | Evento de auditoría sin contenido y su puerto |
| `src/modules/shared/domain/idempotency.ts` + `ports/idempotency-store.ts` | Registro de idempotencia y su puerto |
| `src/modules/shared/infrastructure/system-clock.ts` | Reloj del proceso (movido) |
| `src/modules/shared/infrastructure/uuid-v7-generator.ts` | IDs UUIDv7 |
| `src/modules/shared/infrastructure/prisma-client.ts` | Fábrica del cliente Prisma y tipo `PrismaExecutor` |
| `src/modules/shared/infrastructure/prisma-audit-log.ts` | Adaptador de auditoría |
| `src/modules/shared/infrastructure/prisma-idempotency-store.ts` | Adaptador de idempotencia |
| `src/modules/tenancy/domain/tenant-settings.ts` + `ports/tenant-settings-repository.ts` | Ajustes del tenant y su puerto |
| `src/modules/tenancy/infrastructure/prisma-tenant-settings-repository.ts` | Adaptador de ajustes |
| `prisma/schema.prisma` | Modelo de datos de ambos schemas |
| `prisma/migrations/*` | Migraciones generadas + CHECKs a mano |
| `prisma/seed/{time,data,write-chatbot,write-simulator,index}.ts` | Seed determinista |
| `tests/db/{global-setup,support}.ts` | Base de pruebas: migrar y limpiar |
| `tests/dominio/*.test.ts` | Suite `dominio` (unitaria) |
| `tests/db/*.test.ts` | Suites contra Postgres |
| `docker/entrypoint.sh`, `Dockerfile` | Migrar al arrancar |

---

### Task 0: Bases de datos locales y dependencias

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/prisma.config.ts`
- Modify: `backend/.env.example`, `backend/.env` (local, no versionado)

**Interfaces:**
- Produces: bases `chatbot_dev` y `chatbot_test` en el Postgres local; paquetes `@prisma/adapter-pg`, `pg`, `uuid`, `@types/pg`.

- [ ] **Step 1: Crear las bases locales**

El Postgres de Laragon acepta `postgres` sin contraseña en `localhost`.

```bash
PSQL=/c/laragon/bin/postgresql/postgresql/bin/psql.exe
"$PSQL" -U postgres -h localhost -c "CREATE DATABASE chatbot_dev"
"$PSQL" -U postgres -h localhost -c "CREATE DATABASE chatbot_test"
```

Expected: `CREATE DATABASE` dos veces (si ya existen, el error `ya existe` es aceptable).

- [ ] **Step 2: Apuntar el `.env` local a `chatbot_dev`**

En `backend/.env` cambiar solo la línea `DATABASE_URL` por:

```
DATABASE_URL=postgresql://postgres@localhost:5432/chatbot_dev?schema=public
```

- [ ] **Step 3: Instalar dependencias y mover herramientas a `dependencies`**

`prisma` y `tsx` pasan a `dependencies` porque la imagen de producción los necesita para migrar y sembrar (Task 9).

```bash
npm install @prisma/adapter-pg@7.10.0 pg@^8 uuid@^14 prisma@7.10.0 tsx@^4.23.15 --save
npm install @types/pg --save-dev
```

Luego, en `package.json`, verificar que `prisma` y `tsx` ya no estén en `devDependencies` (npm los mueve) y que `allowScripts` siga aprobando `prisma@7.10.0` y `@prisma/engines@7.10.0`.

- [ ] **Step 4: Que `prisma.config.ts` no pise un `DATABASE_URL` ya definido**

Las pruebas migran la base de test pasando `DATABASE_URL` por entorno; el `.env` local no debe sobrescribirla.

```ts
import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Config de herramienta: la gobernanza permite leer el entorno aqui.
// El .env local solo se carga si nadie definio DATABASE_URL (p. ej. las pruebas).
if (!process.env.DATABASE_URL && existsSync(".env")) {
  process.loadEnvFile();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

- [ ] **Step 5: Documentar variables en `backend/.env.example`**

Añadir al final:

```
# Base de pruebas para las suites contra Postgres (npm run test:db)
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/chatbot_test
```

- [ ] **Step 6: Verificar y commitear**

Run: `npx prisma --version && npm run typecheck`
Expected: versión 7.10.0 y typecheck sin errores.

```bash
git add package.json package-lock.json prisma.config.ts .env.example
git commit -m "chore(backend): dependencias de persistencia y config de prisma para pruebas"
```

---

### Task 1: Núcleo compartido y fronteras del simulador

**Files:**
- Create: `src/modules/shared/domain/ports/clock.ts`, `src/modules/shared/domain/ports/id-generator.ts`, `src/modules/shared/domain/tenant-id.ts`, `src/modules/shared/domain/validation-error.ts`, `src/modules/shared/domain/pagination.ts`
- Create: `src/modules/shared/infrastructure/system-clock.ts`, `src/modules/shared/infrastructure/uuid-v7-generator.ts`
- Delete: `src/modules/health/domain/ports/clock.ts`, `src/modules/health/infrastructure/system-clock.ts`
- Modify: `src/modules/health/application/check-health.ts`, `src/composition-root.ts`, `src/http/errors.ts`
- Modify: `tests/fronteras.test.ts`
- Test: `tests/dominio/paginacion.test.ts`, `tests/dominio/tenant-id.test.ts`, `tests/dominio/errores-validacion.test.ts`

**Interfaces:**
- Produces:
  - `type Clock = { now(): Date }` en `@/modules/shared/domain/ports/clock`
  - `type IdGenerator = { next(): string }` en `@/modules/shared/domain/ports/id-generator`
  - `type TenantId = string & { readonly __brand: "TenantId" }`, `toTenantId(value: string): TenantId`
  - `class ValidationError extends Error { readonly details?: unknown }`
  - `DEFAULT_PAGE_LIMIT = 50`, `MAX_PAGE_LIMIT = 200`, `parseLimit(raw: string | null | undefined): number`, `type CursorPosition = { key: string; id: string }`, `encodeCursor(p): string`, `decodeCursor(raw: string): CursorPosition`, `type Page<T> = { data: readonly T[]; nextCursor: string | null }`, `toPage<T>(rows, limit, positionOf): Page<T>`
  - `systemClock: Clock`, `uuidV7Generator: IdGenerator`

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/dominio/paginacion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
  parseLimit,
  toPage,
} from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("dominio: paginacion", () => {
  it("usa 50 por defecto", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("")).toBe(50);
  });

  it("acepta limites entre 1 y 200", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("200")).toBe(MAX_PAGE_LIMIT);
  });

  it.each(["0", "201", "-3", "abc", "1.5"])("rechaza limit=%s", (raw) => {
    expect(() => parseLimit(raw)).toThrow(ValidationError);
  });

  it("el cursor ida y vuelta conserva la posicion", () => {
    const position = { key: "2026-03-02T13:00:00.000Z", id: "0192a3f0-aaaa-7bbb-8ccc-000000000001" };
    const raw = encodeCursor(position);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(raw)).toEqual(position);
  });

  it.each(["", "%%%", "bm90LWpzb24", btoa(JSON.stringify({ a: 1 }))])(
    "rechaza cursor malformado %s",
    (raw) => {
      expect(() => decodeCursor(raw)).toThrow(ValidationError);
    },
  );

  it("toPage corta en limit y emite cursor solo si hay mas", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id-${n}`, at: `k-${n}` }));
    const position = (row: { id: string; at: string }) => ({ key: row.at, id: row.id });

    const full = toPage(rows, 2, position);
    expect(full.data).toHaveLength(2);
    expect(full.nextCursor).not.toBeNull();
    expect(decodeCursor(full.nextCursor as string)).toEqual({ key: "k-2", id: "id-2" });

    const last = toPage(rows.slice(0, 2), 2, position);
    expect(last.data).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
  });
});
```

`tests/dominio/tenant-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("dominio: tenant id", () => {
  it("acepta un identificador no vacio", () => {
    expect(toTenantId("clinica-norte")).toBe("clinica-norte");
  });

  it.each(["", "   "])("rechaza %j", (raw) => {
    expect(() => toTenantId(raw)).toThrow(ValidationError);
  });
});
```

`tests/dominio/errores-validacion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { toApiError } from "@/http/errors";

describe("dominio: errores de validacion en el contrato REST", () => {
  it("un ValidationError se traduce a validation_failed con sus detalles", () => {
    const error = toApiError(new ValidationError("limit fuera de rango", { field: "limit" }));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toBe("limit fuera de rango");
    expect(error.details).toEqual({ field: "limit" });
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/dominio`
Expected: FAIL — `Cannot find module '@/modules/shared/domain/pagination'` (y similares).

- [ ] **Step 3: Implementar el núcleo compartido**

`src/modules/shared/domain/validation-error.ts`:

```ts
/** Entrada invalida detectada por el nucleo. El adaptador HTTP la traduce a `validation_failed`. */
export class ValidationError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    if (details !== undefined) {
      this.details = details;
    }
  }
}
```

`src/modules/shared/domain/tenant-id.ts`:

```ts
import { ValidationError } from "./validation-error";

/**
 * Tenant de una operacion. Solo se construye a partir del claim del token; el tipo
 * marcado impide pasar por error un string cualquiera donde se espera un tenant.
 */
export type TenantId = string & { readonly __brand: "TenantId" };

export function toTenantId(value: string): TenantId {
  if (value.trim() === "") {
    throw new ValidationError("tenant_id vacio");
  }
  return value as TenantId;
}
```

`src/modules/shared/domain/ports/clock.ts`:

```ts
/** Puerto de reloj: el nucleo nunca lee la hora del sistema por su cuenta. */
export type Clock = {
  now(): Date;
};
```

`src/modules/shared/domain/ports/id-generator.ts`:

```ts
/** Puerto de identificadores: el nucleo no decide como se generan los IDs. */
export type IdGenerator = {
  next(): string;
};
```

`src/modules/shared/domain/pagination.ts`:

```ts
import { ValidationError } from "./validation-error";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** Posicion del ultimo elemento servido: clave de orden + id como desempate. */
export type CursorPosition = { readonly key: string; readonly id: string };

export type Page<T> = { readonly data: readonly T[]; readonly nextCursor: string | null };

export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") {
    return DEFAULT_PAGE_LIMIT;
  }
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new ValidationError(`limit debe ser un entero entre 1 y ${MAX_PAGE_LIMIT}`, {
      field: "limit",
      max: MAX_PAGE_LIMIT,
    });
  }
  return value;
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodeCursor(position: CursorPosition): string {
  return toBase64Url(JSON.stringify([position.key, position.id]));
}

export function decodeCursor(raw: string): CursorPosition {
  const invalid = new ValidationError("cursor invalido", { field: "cursor" });
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw invalid;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(raw));
  } catch {
    throw invalid;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw invalid;
  }
  return { key: parsed[0], id: parsed[1] };
}

/**
 * Arma una pagina a partir de `limit + 1` filas: si sobra una, hay pagina siguiente
 * y el cursor apunta al ultimo elemento servido.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  positionOf: (row: T) => CursorPosition,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last !== undefined ? encodeCursor(positionOf(last)) : null,
  };
}
```

`src/modules/shared/infrastructure/system-clock.ts`:

```ts
import type { Clock } from "../domain/ports/clock";

/** Adaptador: implementa el puerto de reloj con la hora del proceso. */
export const systemClock: Clock = {
  now: () => new Date(),
};
```

`src/modules/shared/infrastructure/uuid-v7-generator.ts`:

```ts
import { v7 } from "uuid";
import type { IdGenerator } from "../domain/ports/id-generator";

/** Adaptador: UUIDv7, ordenables en el tiempo (sirven de desempate en el cursor). */
export const uuidV7Generator: IdGenerator = {
  next: () => v7(),
};
```

- [ ] **Step 4: Mover el reloj fuera de `health`**

```bash
git rm src/modules/health/domain/ports/clock.ts src/modules/health/infrastructure/system-clock.ts
```

En `src/modules/health/application/check-health.ts` reemplazar la primera línea por:

```ts
import type { Clock } from "@/modules/shared/domain/ports/clock";
```

En `src/composition-root.ts` reemplazar la línea
`import { systemClock } from "./modules/health/infrastructure/system-clock";` por:

```ts
import { systemClock } from "./modules/shared/infrastructure/system-clock";
```

Run: `grep -rn "health/domain/ports/clock\|health/infrastructure/system-clock" src tests`
Expected: sin resultados.

- [ ] **Step 5: Traducir `ValidationError` en `src/http/errors.ts`**

Añadir el import y la rama en `toApiError`, antes de la rama de `AuthError`:

```ts
import { ValidationError } from "@/modules/shared/domain/validation-error";
```

```ts
  if (error instanceof ValidationError) {
    return new ApiError("validation_failed", error.message, error.details);
  }
```

- [ ] **Step 6: Ampliar `tests/fronteras.test.ts`**

Añadir dentro del `describe` existente:

```ts
  it("ningun modulo del chatbot importa hermes-simulator", () => {
    const chatbotModules = readdirSync(MODULES_DIR).filter(
      (entry) =>
        entry !== "hermes-simulator" && statSync(join(MODULES_DIR, entry)).isDirectory(),
    );
    const offenders = chatbotModules
      .flatMap((mod) => listFiles(join(MODULES_DIR, mod)))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => /(^|\/)hermes-simulator(\/|$)/.test(specifier))
          .map((specifier) => `${file} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  it("hermes-simulator solo importa shared y auth de otros modulos", () => {
    const allowed = new Set(["hermes-simulator", "shared", "auth"]);
    const offenders = listFiles(join(MODULES_DIR, "hermes-simulator")).flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({ specifier, module: /modules\/([^/]+)/.exec(specifier)?.[1] }))
        .filter(({ module }) => module !== undefined && !allowed.has(module))
        .map(({ specifier }) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 7: Correr pruebas y puertas**

Run: `npx vitest run tests/dominio tests/fronteras.test.ts && npm run typecheck && npx biome ci .`
Expected: todo PASS, typecheck y Biome sin errores.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat(shared): nucleo compartido (reloj, ids, tenant, paginacion) y frontera del simulador"
```

---

### Task 2: Infraestructura de pruebas contra Postgres y esquema del chatbot

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_fase2_chatbot/migration.sql` (generada + CHECKs)
- Create: `src/modules/shared/infrastructure/prisma-client.ts`
- Modify: `vitest.config.mts`, `package.json` (scripts)
- Create: `tests/db/global-setup.ts`, `tests/db/support.ts`
- Test: `tests/db/aislamiento-tenant.test.ts`

**Interfaces:**
- Consumes: `IdGenerator`, `uuidV7Generator` (Task 1).
- Produces:
  - `createPrismaClient(connectionString: string): PrismaClient`
  - `type PrismaExecutor = PrismaClient | Prisma.TransactionClient`
  - Modelos Prisma: `Tenant`, `Practitioner`, `HealthcareService`, `Schedule`, `Slot`, `MedicalRecord`, `Appointment`, `AuditEvent`, `IdempotencyKey`; enums `SlotStatus`, `MedicalRecordStatus`, `AppointmentStatus`, `DocumentType`.
  - `tests/db/support.ts`: `TEST_DATABASE_URL: string`, `testPrisma(): PrismaClient`, `truncateAll(prisma: PrismaClient): Promise<void>`, `insertTenant(prisma, slug): Promise<string>` (devuelve el id).

- [ ] **Step 1: Escribir el esquema del chatbot**

Reemplazar `prisma/schema.prisma` completo:

```prisma
// Adaptador de persistencia del dia 1. El dominio no conoce este archivo:
// habla con puertos y la implementacion Prisma vive en infrastructure/.
// La URL de conexion vive en prisma.config.ts (Prisma 7 la saco del schema).
// Aislamiento por tenant reforzado en la base: toda referencia entre tablas de
// dominio es una FK compuesta (tenant_id, id), asi que no puede cruzar tenants.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  schemas  = ["public"]
}

enum SlotStatus {
  free
  busy
  busy_tentative
  busy_unavailable

  @@map("slot_status")
  @@schema("public")
}

enum MedicalRecordStatus {
  active
  pre_registered

  @@map("medical_record_status")
  @@schema("public")
}

enum AppointmentStatus {
  booked
  cancelled
  fulfilled
  noshow

  @@map("appointment_status")
  @@schema("public")
}

enum DocumentType {
  CC
  TI
  CE
  PA
  RC

  @@map("document_type")
  @@schema("public")
}

model Tenant {
  id                String   @id
  slug              String   @unique
  name              String
  maxQueryRangeDays Int      @default(31) @map("max_query_range_days")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  practitioners      Practitioner[]
  healthcareServices HealthcareService[]
  schedules          Schedule[]
  slots              Slot[]
  medicalRecords     MedicalRecord[]
  appointments       Appointment[]
  auditEvents        AuditEvent[]
  idempotencyKeys    IdempotencyKey[]

  @@map("tenants")
  @@schema("public")
}

model Practitioner {
  id               String   @id
  tenantId         String   @map("tenant_id")
  identifierSystem String   @map("identifier_system")
  identifierValue  String   @map("identifier_value")
  name             String
  active           Boolean  @default(true)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant    Tenant     @relation(fields: [tenantId], references: [id])
  schedules Schedule[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@map("practitioners")
  @@schema("public")
}

model HealthcareService {
  id               String   @id
  tenantId         String   @map("tenant_id")
  identifierSystem String   @map("identifier_system")
  identifierValue  String   @map("identifier_value")
  name             String
  active           Boolean  @default(true)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant    Tenant     @relation(fields: [tenantId], references: [id])
  schedules Schedule[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@map("healthcare_services")
  @@schema("public")
}

model Schedule {
  id                  String   @id
  tenantId            String   @map("tenant_id")
  identifierSystem    String   @map("identifier_system")
  identifierValue     String   @map("identifier_value")
  practitionerId      String   @map("practitioner_id")
  healthcareServiceId String   @map("healthcare_service_id")
  active              Boolean  @default(true)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant            Tenant            @relation(fields: [tenantId], references: [id])
  practitioner      Practitioner      @relation(fields: [tenantId, practitionerId], references: [tenantId, id])
  healthcareService HealthcareService @relation(fields: [tenantId, healthcareServiceId], references: [tenantId, id])
  slots             Slot[]
  appointments      Appointment[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@map("schedules")
  @@schema("public")
}

model Slot {
  id               String     @id
  tenantId         String     @map("tenant_id")
  identifierSystem String     @map("identifier_system")
  identifierValue  String     @map("identifier_value")
  scheduleId       String     @map("schedule_id")
  startAt          DateTime   @map("start_at") @db.Timestamptz(3)
  endAt            DateTime   @map("end_at") @db.Timestamptz(3)
  status           SlotStatus @default(free)
  createdAt        DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime   @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  schedule     Schedule      @relation(fields: [tenantId, scheduleId], references: [tenantId, id])
  appointments Appointment[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@index([tenantId, scheduleId, startAt])
  @@index([tenantId, status, startAt])
  @@map("slots")
  @@schema("public")
}

model MedicalRecord {
  id               String              @id
  tenantId         String              @map("tenant_id")
  identifierSystem String              @map("identifier_system")
  identifierValue  String              @map("identifier_value")
  documentType     DocumentType        @map("document_type")
  documentNumber   String              @map("document_number")
  givenNames       String              @map("given_names")
  familyNames      String              @map("family_names")
  birthDate        DateTime            @map("birth_date") @db.Date
  phone            String?
  email            String?
  status           MedicalRecordStatus @default(active)
  createdAt        DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  appointments Appointment[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@unique([tenantId, documentType, documentNumber])
  @@map("medical_records")
  @@schema("public")
}

model Appointment {
  id               String            @id
  tenantId         String            @map("tenant_id")
  identifierSystem String            @map("identifier_system")
  identifierValue  String            @map("identifier_value")
  medicalRecordId  String            @map("medical_record_id")
  scheduleId       String            @map("schedule_id")
  slotId           String            @map("slot_id")
  startAt          DateTime          @map("start_at") @db.Timestamptz(3)
  endAt            DateTime          @map("end_at") @db.Timestamptz(3)
  status           AppointmentStatus
  createdAt        DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime          @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant        Tenant        @relation(fields: [tenantId], references: [id])
  medicalRecord MedicalRecord @relation(fields: [tenantId, medicalRecordId], references: [tenantId, id])
  schedule      Schedule      @relation(fields: [tenantId, scheduleId], references: [tenantId, id])
  slot          Slot          @relation(fields: [tenantId, slotId], references: [tenantId, id])

  @@unique([tenantId, identifierSystem, identifierValue])
  @@index([tenantId, medicalRecordId, startAt])
  @@index([tenantId, scheduleId, startAt])
  @@map("appointments")
  @@schema("public")
}

// Registra el hecho, nunca el contenido: sin columnas de datos de la peticion.
model AuditEvent {
  id           String   @id
  tenantId     String   @map("tenant_id")
  actorSubject String   @map("actor_subject")
  actorRole    String   @map("actor_role")
  action       String
  resourceType String   @map("resource_type")
  resourceId   String   @map("resource_id")
  requestId    String   @map("request_id")
  occurredAt   DateTime @map("occurred_at") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId, occurredAt])
  @@map("audit_events")
  @@schema("public")
}

model IdempotencyKey {
  tenantId       String   @map("tenant_id")
  key            String
  actorSubject   String   @map("actor_subject")
  method         String
  path           String
  requestHash    String   @map("request_hash")
  responseStatus Int      @map("response_status")
  responseBody   Json     @map("response_body")
  createdAt      DateTime @map("created_at") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@id([tenantId, key])
  @@map("idempotency_keys")
  @@schema("public")
}
```

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`. Si Prisma responde que `schemas`/`@@schema` requiere un preview feature, añadir `previewFeatures = ["multiSchema"]` al bloque `generator client` y volver a validar.

- [ ] **Step 2: Generar la migración y añadir los CHECKs**

```bash
npx prisma migrate dev --create-only --name fase2_chatbot
```

Al final del `migration.sql` generado en `prisma/migrations/<timestamp>_fase2_chatbot/`, añadir:

```sql
-- Restricciones que Prisma no expresa en el schema.
ALTER TABLE "public"."tenants"
  ADD CONSTRAINT "tenants_max_query_range_days_check"
  CHECK ("max_query_range_days" BETWEEN 1 AND 366);

ALTER TABLE "public"."slots"
  ADD CONSTRAINT "slots_time_range_check" CHECK ("end_at" > "start_at");

ALTER TABLE "public"."appointments"
  ADD CONSTRAINT "appointments_time_range_check" CHECK ("end_at" > "start_at");
```

Aplicar y generar el cliente:

```bash
npx prisma migrate dev && npm run db:generate
```

Expected: migración aplicada en `chatbot_dev` y `Generated Prisma Client`.

- [ ] **Step 3: Fábrica del cliente Prisma**

`src/modules/shared/infrastructure/prisma-client.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "@prisma/client";

/** Cliente o transaccion: los adaptadores aceptan ambos para componer transacciones. */
export type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

/** Unico lugar que construye clientes Prisma (Prisma 7 exige adaptador de driver). */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
```

- [ ] **Step 4: Proyectos de Vitest y soporte de base de pruebas**

Reemplazar `vitest.config.mts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/db/**"],
          setupFiles: ["tests/setup-env.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          setupFiles: ["tests/setup-env.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // Una sola base compartida: los archivos corren en serie.
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
```

En `package.json`, dentro de `scripts`, añadir:

```json
"test:unit": "vitest run --project unit",
"test:db": "vitest run --project db",
"db:seed": "tsx prisma/seed/index.ts"
```

`tests/db/support.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@/modules/shared/infrastructure/prisma-client";

// Base dedicada a las suites. Por defecto, el Postgres local de desarrollo.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

export function testPrisma(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

/** Vacia todas las tablas de ambos schemas, sin tocar el historial de migraciones. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_tables
    WHERE schemaname IN ('public', 'hermes_sim') AND tablename <> '_prisma_migrations'`;
  if (rows.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((row) => row.name).join(", ")} CASCADE`);
  }
}

export async function insertTenant(prisma: PrismaClient, slug: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { id: `tenant-${slug}`, slug, name: `Tenant ${slug}` },
  });
  return tenant.id;
}
```

`tests/db/global-setup.ts`:

```ts
import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

/** Deja la base de pruebas vacia y con todas las migraciones aplicadas. */
export default async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    "DROP SCHEMA IF EXISTS hermes_sim CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  await client.end();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
```

- [ ] **Step 5: Escribir la prueba de aislamiento que debe pasar con el esquema**

`tests/db/aislamiento-tenant.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const SYSTEM = "urn:test";

async function practitioner(tenantId: string, value: string): Promise<string> {
  const row = await prisma.practitioner.create({
    data: { id: `${tenantId}-${value}`, tenantId, identifierSystem: SYSTEM, identifierValue: value, name: value },
  });
  return row.id;
}

async function service(tenantId: string, value: string): Promise<string> {
  const row = await prisma.healthcareService.create({
    data: { id: `${tenantId}-${value}`, tenantId, identifierSystem: SYSTEM, identifierValue: value, name: value },
  });
  return row.id;
}

describe("aislamiento-tenant: la base impide referencias entre tenants", () => {
  let tenantA: string;
  let tenantB: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantA = await insertTenant(prisma, "a");
    tenantB = await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una agenda no puede apuntar al profesional de otro tenant", async () => {
    const foreignPractitioner = await practitioner(tenantB, "P-1");
    const ownService = await service(tenantA, "S-1");

    await expect(
      prisma.schedule.create({
        data: {
          id: "sched-cross",
          tenantId: tenantA,
          identifierSystem: SYSTEM,
          identifierValue: "SCH-1",
          practitionerId: foreignPractitioner,
          healthcareServiceId: ownService,
        },
      }),
    ).rejects.toThrow();
  });

  it("el mismo identificador Hermes puede existir en dos tenants", async () => {
    await practitioner(tenantA, "P-1");
    await practitioner(tenantB, "P-1");

    expect(await prisma.practitioner.count()).toBe(2);
  });

  it("el tope de rango del tenant queda entre 1 y 366", async () => {
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { maxQueryRangeDays: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { maxQueryRangeDays: 367 } }),
    ).rejects.toThrow();
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantA } })).maxQueryRangeDays).toBe(31);
  });

  it("un cupo no puede terminar antes de empezar", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        id: "sched-a",
        tenantId: tenantA,
        identifierSystem: SYSTEM,
        identifierValue: "SCH-A",
        practitionerId: await practitioner(tenantA, "P-2"),
        healthcareServiceId: await service(tenantA, "S-2"),
      },
    });

    await expect(
      prisma.slot.create({
        data: {
          id: "slot-bad",
          tenantId: tenantA,
          identifierSystem: SYSTEM,
          identifierValue: "SL-1",
          scheduleId: schedule.id,
          startAt: new Date("2026-03-02T14:00:00Z"),
          endAt: new Date("2026-03-02T13:30:00Z"),
        },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Correr la suite contra Postgres**

Run: `npm run test:db`
Expected: `aislamiento-tenant` 4 PASS. Si falla con error de conexión, revisar que `chatbot_test` exista (Task 0, Step 1).

- [ ] **Step 7: Puertas y commit**

Run: `npm test && npm run typecheck && npx biome ci .`
Expected: proyectos `unit` y `db` en verde.

```bash
git add prisma src/modules/shared/infrastructure/prisma-client.ts vitest.config.mts package.json tests/db
git commit -m "feat(db): esquema del chatbot con FKs compuestas por tenant y base de pruebas"
```

---

### Task 3: Schema `hermes_sim` del simulador

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_fase2_hermes_sim/migration.sql` (generada + CHECKs)
- Test: `tests/db/esquema-simulador.test.ts`

**Interfaces:**
- Produces: modelos `SimPractitioner`, `SimHealthcareService`, `SimSchedule`, `SimSlot`, `SimPatient`, `SimAppointment`; enums `SimSlotStatus`, `SimPatientStatus`, `SimAppointmentStatus`, `SimDocumentType` (mismos valores que sus pares del chatbot).

- [ ] **Step 1: Escribir la prueba que falla**

`tests/db/esquema-simulador.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

describe("esquema del simulador", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("vive en hermes_sim con las seis tablas", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'hermes_sim' ORDER BY tablename`;
    expect(rows.map((row) => row.tablename)).toEqual([
      "appointments",
      "healthcare_services",
      "patients",
      "practitioners",
      "schedules",
      "slots",
    ]);
  });

  it("ninguna FK cruza entre public y hermes_sim", async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT con.conname AS name
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_namespace srcns ON srcns.oid = src.relnamespace
      JOIN pg_class dst ON dst.oid = con.confrelid
      JOIN pg_namespace dstns ON dstns.oid = dst.relnamespace
      WHERE con.contype = 'f' AND srcns.nspname <> dstns.nspname`;
    expect(rows).toEqual([]);
  });

  it("acepta un tenant que no existe en public (sin FK al chatbot)", async () => {
    await prisma.simPractitioner.create({
      data: {
        id: "sim-p1",
        tenantId: "tenant-solo-en-hermes",
        identifierSystem: "urn:test",
        identifierValue: "P-1",
        name: "Ana",
      },
    });
    expect(await prisma.simPractitioner.count()).toBe(1);
  });
});
```

Run: `npm run test:db`
Expected: FAIL — `prisma.simPractitioner` no existe / no hay tablas en `hermes_sim`.

- [ ] **Step 2: Añadir el schema al datasource y los modelos**

En `prisma/schema.prisma` cambiar `schemas  = ["public"]` por:

```prisma
  schemas  = ["public", "hermes_sim"]
```

Añadir al final del archivo:

```prisma
// ---------------------------------------------------------------------------
// Simulador de Hermes. Schema propio, sin FKs hacia public: en produccion se
// elimina completo. tenant_id es texto: el simulador conoce el tenant como
// lo haria Hermes, sin depender de las tablas del chatbot.
// ---------------------------------------------------------------------------

enum SimSlotStatus {
  free
  busy
  busy_tentative
  busy_unavailable

  @@map("slot_status")
  @@schema("hermes_sim")
}

enum SimPatientStatus {
  active
  pre_registered

  @@map("patient_status")
  @@schema("hermes_sim")
}

enum SimAppointmentStatus {
  booked
  cancelled
  fulfilled
  noshow

  @@map("appointment_status")
  @@schema("hermes_sim")
}

enum SimDocumentType {
  CC
  TI
  CE
  PA
  RC

  @@map("document_type")
  @@schema("hermes_sim")
}

model SimPractitioner {
  id               String   @id
  tenantId         String   @map("tenant_id")
  identifierSystem String   @map("identifier_system")
  identifierValue  String   @map("identifier_value")
  name             String
  active           Boolean  @default(true)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  schedules SimSchedule[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@map("practitioners")
  @@schema("hermes_sim")
}

model SimHealthcareService {
  id               String   @id
  tenantId         String   @map("tenant_id")
  identifierSystem String   @map("identifier_system")
  identifierValue  String   @map("identifier_value")
  name             String
  active           Boolean  @default(true)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  schedules SimSchedule[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@map("healthcare_services")
  @@schema("hermes_sim")
}

model SimSchedule {
  id                  String   @id
  tenantId            String   @map("tenant_id")
  identifierSystem    String   @map("identifier_system")
  identifierValue     String   @map("identifier_value")
  practitionerId      String   @map("practitioner_id")
  healthcareServiceId String   @map("healthcare_service_id")
  active              Boolean  @default(true)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  practitioner      SimPractitioner      @relation(fields: [tenantId, practitionerId], references: [tenantId, id])
  healthcareService SimHealthcareService @relation(fields: [tenantId, healthcareServiceId], references: [tenantId, id])
  slots             SimSlot[]
  appointments      SimAppointment[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@map("schedules")
  @@schema("hermes_sim")
}

model SimSlot {
  id               String        @id
  tenantId         String        @map("tenant_id")
  identifierSystem String        @map("identifier_system")
  identifierValue  String        @map("identifier_value")
  scheduleId       String        @map("schedule_id")
  startAt          DateTime      @map("start_at") @db.Timestamptz(3)
  endAt            DateTime      @map("end_at") @db.Timestamptz(3)
  status           SimSlotStatus @default(free)
  createdAt        DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  schedule     SimSchedule      @relation(fields: [tenantId, scheduleId], references: [tenantId, id])
  appointments SimAppointment[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@index([tenantId, scheduleId, startAt])
  @@map("slots")
  @@schema("hermes_sim")
}

model SimPatient {
  id               String           @id
  tenantId         String           @map("tenant_id")
  identifierSystem String           @map("identifier_system")
  identifierValue  String           @map("identifier_value")
  documentType     SimDocumentType  @map("document_type")
  documentNumber   String           @map("document_number")
  givenNames       String           @map("given_names")
  familyNames      String           @map("family_names")
  birthDate        DateTime         @map("birth_date") @db.Date
  phone            String?
  email            String?
  status           SimPatientStatus @default(active)
  createdAt        DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime         @updatedAt @map("updated_at") @db.Timestamptz(3)

  appointments SimAppointment[]

  @@unique([tenantId, id])
  @@unique([tenantId, identifierSystem, identifierValue])
  @@unique([tenantId, documentType, documentNumber])
  @@map("patients")
  @@schema("hermes_sim")
}

model SimAppointment {
  id               String               @id
  tenantId         String               @map("tenant_id")
  identifierSystem String               @map("identifier_system")
  identifierValue  String               @map("identifier_value")
  patientId        String               @map("patient_id")
  scheduleId       String               @map("schedule_id")
  slotId           String               @map("slot_id")
  startAt          DateTime             @map("start_at") @db.Timestamptz(3)
  endAt            DateTime             @map("end_at") @db.Timestamptz(3)
  status           SimAppointmentStatus
  createdAt        DateTime             @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime             @updatedAt @map("updated_at") @db.Timestamptz(3)

  patient  SimPatient  @relation(fields: [tenantId, patientId], references: [tenantId, id])
  schedule SimSchedule @relation(fields: [tenantId, scheduleId], references: [tenantId, id])
  slot     SimSlot     @relation(fields: [tenantId, slotId], references: [tenantId, id])

  @@unique([tenantId, identifierSystem, identifierValue])
  @@index([tenantId, patientId, startAt])
  @@map("appointments")
  @@schema("hermes_sim")
}
```

- [ ] **Step 3: Migración con CHECKs**

```bash
npx prisma migrate dev --create-only --name fase2_hermes_sim
```

Al final del `migration.sql` generado, añadir:

```sql
-- Restricciones que Prisma no expresa en el schema.
ALTER TABLE "hermes_sim"."slots"
  ADD CONSTRAINT "slots_time_range_check" CHECK ("end_at" > "start_at");

ALTER TABLE "hermes_sim"."appointments"
  ADD CONSTRAINT "appointments_time_range_check" CHECK ("end_at" > "start_at");
```

Verificar que el SQL generado empiece con `CREATE SCHEMA IF NOT EXISTS "hermes_sim";`; si no, añadir esa línea al principio.

```bash
npx prisma migrate dev && npm run db:generate
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm run test:db`
Expected: `esquema del simulador` 3 PASS y `aislamiento-tenant` sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add prisma tests/db/esquema-simulador.test.ts
git commit -m "feat(db): schema hermes_sim del simulador, sin FKs hacia el chatbot"
```

---

### Task 4: Ajustes del tenant (módulo `tenancy`)

**Files:**
- Create: `src/modules/tenancy/domain/tenant-settings.ts`
- Create: `src/modules/tenancy/domain/ports/tenant-settings-repository.ts`
- Create: `src/modules/tenancy/infrastructure/prisma-tenant-settings-repository.ts`
- Test: `tests/dominio/ajustes-tenant.test.ts`, `tests/db/ajustes-tenant.test.ts`

**Interfaces:**
- Consumes: `TenantId`, `toTenantId`, `ValidationError` (Task 1); `PrismaExecutor` (Task 2).
- Produces:
  - `type TenantSettings = { readonly maxQueryRangeDays: number }`
  - `MIN_QUERY_RANGE_DAYS = 1`, `MAX_QUERY_RANGE_DAYS = 366`, `DEFAULT_QUERY_RANGE_DAYS = 31`
  - `validateTenantSettings(input: TenantSettings): TenantSettings`
  - `type TenantSettingsRepository = { get(tenantId: TenantId): Promise<TenantSettings | null>; update(tenantId: TenantId, settings: TenantSettings): Promise<TenantSettings | null> }` (`null` = tenant inexistente)
  - `createPrismaTenantSettingsRepository(db: PrismaExecutor): TenantSettingsRepository`

- [ ] **Step 1: Pruebas que fallan**

`tests/dominio/ajustes-tenant.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import {
  DEFAULT_QUERY_RANGE_DAYS,
  validateTenantSettings,
} from "@/modules/tenancy/domain/tenant-settings";

describe("dominio: ajustes del tenant", () => {
  it("el tope por defecto es 31 dias", () => {
    expect(DEFAULT_QUERY_RANGE_DAYS).toBe(31);
  });

  it.each([1, 31, 366])("acepta %i dias", (days) => {
    expect(validateTenantSettings({ maxQueryRangeDays: days })).toEqual({ maxQueryRangeDays: days });
  });

  it.each([0, 367, 1.5, Number.NaN])("rechaza %s dias", (days) => {
    expect(() => validateTenantSettings({ maxQueryRangeDays: days })).toThrow(ValidationError);
  });
});
```

`tests/db/ajustes-tenant.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaTenantSettingsRepository } from "@/modules/tenancy/infrastructure/prisma-tenant-settings-repository";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const repository = createPrismaTenantSettingsRepository(prisma);

describe("aislamiento-tenant: ajustes del tenant", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await insertTenant(prisma, "a");
    await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lee el tope por defecto", async () => {
    expect(await repository.get(toTenantId("tenant-a"))).toEqual({ maxQueryRangeDays: 31 });
  });

  it("actualizar un tenant no toca al otro", async () => {
    const updated = await repository.update(toTenantId("tenant-a"), { maxQueryRangeDays: 90 });

    expect(updated).toEqual({ maxQueryRangeDays: 90 });
    expect(await repository.get(toTenantId("tenant-b"))).toEqual({ maxQueryRangeDays: 31 });
  });

  it("un tenant inexistente devuelve null al leer y al actualizar", async () => {
    expect(await repository.get(toTenantId("tenant-x"))).toBeNull();
    expect(await repository.update(toTenantId("tenant-x"), { maxQueryRangeDays: 10 })).toBeNull();
  });
});
```

Run: `npx vitest run tests/dominio/ajustes-tenant.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 2: Implementar dominio, puerto y adaptador**

`src/modules/tenancy/domain/tenant-settings.ts`:

```ts
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const MIN_QUERY_RANGE_DAYS = 1;
export const MAX_QUERY_RANGE_DAYS = 366;
export const DEFAULT_QUERY_RANGE_DAYS = 31;

/** Ajustes que cada tenant administra. Hoy: tope de dias por consulta de agenda. */
export type TenantSettings = {
  readonly maxQueryRangeDays: number;
};

export function validateTenantSettings(input: TenantSettings): TenantSettings {
  const days = input.maxQueryRangeDays;
  if (!Number.isInteger(days) || days < MIN_QUERY_RANGE_DAYS || days > MAX_QUERY_RANGE_DAYS) {
    throw new ValidationError(
      `max_query_range_days debe ser un entero entre ${MIN_QUERY_RANGE_DAYS} y ${MAX_QUERY_RANGE_DAYS}`,
      { field: "max_query_range_days", min: MIN_QUERY_RANGE_DAYS, max: MAX_QUERY_RANGE_DAYS },
    );
  }
  return { maxQueryRangeDays: days };
}
```

`src/modules/tenancy/domain/ports/tenant-settings-repository.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantSettings } from "../tenant-settings";

/** `null` significa que el tenant no existe; el caso de uso lo traduce a `not_found`. */
export type TenantSettingsRepository = {
  get(tenantId: TenantId): Promise<TenantSettings | null>;
  update(tenantId: TenantId, settings: TenantSettings): Promise<TenantSettings | null>;
};
```

`src/modules/tenancy/infrastructure/prisma-tenant-settings-repository.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { TenantSettingsRepository } from "../domain/ports/tenant-settings-repository";

export function createPrismaTenantSettingsRepository(db: PrismaExecutor): TenantSettingsRepository {
  async function get(tenantId: TenantId) {
    const row = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { maxQueryRangeDays: true },
    });
    return row ? { maxQueryRangeDays: row.maxQueryRangeDays } : null;
  }

  return {
    get,
    async update(tenantId, settings) {
      const result = await db.tenant.updateMany({
        where: { id: tenantId },
        data: { maxQueryRangeDays: settings.maxQueryRangeDays },
      });
      return result.count === 0 ? null : get(tenantId);
    },
  };
}
```

- [ ] **Step 3: Correr y ver que pasa**

Run: `npx vitest run tests/dominio/ajustes-tenant.test.ts && npm run test:db`
Expected: PASS en ambos.

- [ ] **Step 4: Commit**

```bash
git add src/modules/tenancy tests/dominio/ajustes-tenant.test.ts tests/db/ajustes-tenant.test.ts
git commit -m "feat(tenancy): ajustes del tenant con tope de rango y repositorio Prisma"
```

---

### Task 5: Auditoría sin contenido

**Files:**
- Create: `src/modules/shared/domain/audit-event.ts`, `src/modules/shared/domain/ports/audit-log.ts`
- Create: `src/modules/shared/infrastructure/prisma-audit-log.ts`
- Test: `tests/db/auditoria.test.ts`

**Interfaces:**
- Consumes: `TenantId`, `IdGenerator` (Task 1); `PrismaExecutor` (Task 2).
- Produces:
  - `type AuditEvent = { readonly tenantId: TenantId; readonly actorSubject: string; readonly actorRole: string; readonly action: string; readonly resourceType: string; readonly resourceId: string; readonly requestId: string; readonly occurredAt: Date }`
  - `type AuditLog = { record(event: AuditEvent): Promise<void> }`
  - `createPrismaAuditLog(db: PrismaExecutor, ids: IdGenerator): AuditLog`

- [ ] **Step 1: Prueba que falla**

`tests/db/auditoria.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
let sequence = 0;
const auditLog = createPrismaAuditLog(prisma, { next: () => `audit-${++sequence}` });

describe("auditoria: se registra el hecho, no el contenido", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await insertTenant(prisma, "a");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("guarda el evento con sus campos de hecho", async () => {
    const occurredAt = new Date("2026-03-02T15:00:00.000Z");
    await auditLog.record({
      tenantId: toTenantId("tenant-a"),
      actorSubject: "admin-1",
      actorRole: "admin",
      action: "tenant_settings.updated",
      resourceType: "tenant",
      resourceId: "tenant-a",
      requestId: "req-1",
      occurredAt,
    });

    const rows = await prisma.auditEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "tenant-a",
      action: "tenant_settings.updated",
      resourceType: "tenant",
      occurredAt,
    });
  });

  it("la tabla no tiene columnas donde quepa contenido", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_events' ORDER BY column_name`;
    expect(rows.map((row) => row.column_name)).toEqual([
      "action",
      "actor_role",
      "actor_subject",
      "id",
      "occurred_at",
      "request_id",
      "resource_id",
      "resource_type",
      "tenant_id",
    ]);
  });
});
```

Run: `npm run test:db`
Expected: FAIL — `prisma-audit-log` inexistente.

- [ ] **Step 2: Implementar**

`src/modules/shared/domain/audit-event.ts`:

```ts
import type { TenantId } from "./tenant-id";

/**
 * Un hecho auditable. Por diseño no tiene campo de contenido: se registra quien hizo
 * que sobre que recurso y cuando, nunca los datos (no divulgacion, GOBERNANZA §1.5).
 */
export type AuditEvent = {
  readonly tenantId: TenantId;
  readonly actorSubject: string;
  readonly actorRole: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly occurredAt: Date;
};
```

`src/modules/shared/domain/ports/audit-log.ts`:

```ts
import type { AuditEvent } from "../audit-event";

export type AuditLog = {
  record(event: AuditEvent): Promise<void>;
};
```

`src/modules/shared/infrastructure/prisma-audit-log.ts`:

```ts
import type { AuditLog } from "../domain/ports/audit-log";
import type { IdGenerator } from "../domain/ports/id-generator";
import type { PrismaExecutor } from "./prisma-client";

export function createPrismaAuditLog(db: PrismaExecutor, ids: IdGenerator): AuditLog {
  return {
    async record(event) {
      await db.auditEvent.create({
        data: {
          id: ids.next(),
          tenantId: event.tenantId,
          actorSubject: event.actorSubject,
          actorRole: event.actorRole,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          requestId: event.requestId,
          occurredAt: event.occurredAt,
        },
      });
    },
  };
}
```

- [ ] **Step 3: Correr y ver que pasa**

Run: `npm run test:db`
Expected: `auditoria` 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shared tests/db/auditoria.test.ts
git commit -m "feat(shared): auditoria de hechos sin contenido con adaptador Prisma"
```

---

### Task 6: Almacén de idempotencia

**Files:**
- Create: `src/modules/shared/domain/idempotency.ts`, `src/modules/shared/domain/ports/idempotency-store.ts`
- Create: `src/modules/shared/infrastructure/prisma-idempotency-store.ts`
- Test: `tests/db/idempotencia-store.test.ts`

**Interfaces:**
- Consumes: `TenantId` (Task 1); `PrismaExecutor` (Task 2).
- Produces:
  - `type IdempotencyRecord = { readonly tenantId: TenantId; readonly key: string; readonly actorSubject: string; readonly method: string; readonly path: string; readonly requestHash: string; readonly responseStatus: number; readonly responseBody: unknown; readonly createdAt: Date }`
  - `class IdempotencyKeyTakenError extends Error`
  - `type IdempotencyStore = { find(tenantId: TenantId, key: string): Promise<IdempotencyRecord | null>; save(record: IdempotencyRecord): Promise<void> }` — `save` lanza `IdempotencyKeyTakenError` si la clave ya existe.
  - `createPrismaIdempotencyStore(db: PrismaExecutor): IdempotencyStore`

- [ ] **Step 1: Prueba que falla**

`tests/db/idempotencia-store.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyKeyTakenError, type IdempotencyRecord } from "@/modules/shared/domain/idempotency";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaIdempotencyStore } from "@/modules/shared/infrastructure/prisma-idempotency-store";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const store = createPrismaIdempotencyStore(prisma);

function record(tenant: string, key: string): IdempotencyRecord {
  return {
    tenantId: toTenantId(tenant),
    key,
    actorSubject: "admin-1",
    method: "PATCH",
    path: "/api/v1/tenant-settings",
    requestHash: "hash-1",
    responseStatus: 200,
    responseBody: { max_query_range_days: 60 },
    createdAt: new Date("2026-03-02T15:00:00.000Z"),
  };
}

describe("idempotencia: almacen de claves", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await insertTenant(prisma, "a");
    await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("guarda y recupera la respuesta", async () => {
    await store.save(record("tenant-a", "k-1"));
    expect(await store.find(toTenantId("tenant-a"), "k-1")).toEqual(record("tenant-a", "k-1"));
  });

  it("una clave desconocida devuelve null", async () => {
    expect(await store.find(toTenantId("tenant-a"), "k-x")).toBeNull();
  });

  it("la misma clave en otro tenant es independiente", async () => {
    await store.save(record("tenant-a", "k-1"));
    await store.save(record("tenant-b", "k-1"));
    expect(await store.find(toTenantId("tenant-b"), "k-1")).not.toBeNull();
  });

  it("repetir la clave en el mismo tenant lanza IdempotencyKeyTakenError", async () => {
    await store.save(record("tenant-a", "k-1"));
    await expect(store.save(record("tenant-a", "k-1"))).rejects.toBeInstanceOf(
      IdempotencyKeyTakenError,
    );
  });
});
```

Run: `npm run test:db`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 2: Implementar**

`src/modules/shared/domain/idempotency.ts`:

```ts
import type { TenantId } from "./tenant-id";

/** Respuesta ya servida para una `Idempotency-Key`, por tenant. */
export type IdempotencyRecord = {
  readonly tenantId: TenantId;
  readonly key: string;
  readonly actorSubject: string;
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly createdAt: Date;
};

/** Otra peticion ya reservo la clave (p. ej. dos envios concurrentes). */
export class IdempotencyKeyTakenError extends Error {
  constructor() {
    super("La Idempotency-Key ya fue usada");
    this.name = "IdempotencyKeyTakenError";
  }
}
```

`src/modules/shared/domain/ports/idempotency-store.ts`:

```ts
import type { IdempotencyRecord } from "../idempotency";
import type { TenantId } from "../tenant-id";

export type IdempotencyStore = {
  find(tenantId: TenantId, key: string): Promise<IdempotencyRecord | null>;
  /** Lanza `IdempotencyKeyTakenError` si la clave ya existe para el tenant. */
  save(record: IdempotencyRecord): Promise<void>;
};
```

`src/modules/shared/infrastructure/prisma-idempotency-store.ts`:

```ts
import { Prisma } from "@prisma/client";
import { IdempotencyKeyTakenError } from "../domain/idempotency";
import type { IdempotencyStore } from "../domain/ports/idempotency-store";
import { toTenantId } from "../domain/tenant-id";
import type { PrismaExecutor } from "./prisma-client";

const UNIQUE_VIOLATION = "P2002";

export function createPrismaIdempotencyStore(db: PrismaExecutor): IdempotencyStore {
  return {
    async find(tenantId, key) {
      const row = await db.idempotencyKey.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
      if (!row) {
        return null;
      }
      return {
        tenantId: toTenantId(row.tenantId),
        key: row.key,
        actorSubject: row.actorSubject,
        method: row.method,
        path: row.path,
        requestHash: row.requestHash,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
        createdAt: row.createdAt,
      };
    },

    async save(record) {
      try {
        await db.idempotencyKey.create({
          data: {
            tenantId: record.tenantId,
            key: record.key,
            actorSubject: record.actorSubject,
            method: record.method,
            path: record.path,
            requestHash: record.requestHash,
            responseStatus: record.responseStatus,
            responseBody: record.responseBody as Prisma.InputJsonValue,
            createdAt: record.createdAt,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_VIOLATION
        ) {
          throw new IdempotencyKeyTakenError();
        }
        throw error;
      }
    },
  };
}
```

- [ ] **Step 3: Correr y ver que pasa**

Run: `npm run test:db`
Expected: `idempotencia: almacen de claves` 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shared tests/db/idempotencia-store.test.ts
git commit -m "feat(shared): almacen de idempotencia persistido por tenant"
```

---

### Task 7: Datos del seed (módulo puro y determinista)

**Files:**
- Create: `prisma/seed/time.ts`, `prisma/seed/data.ts`
- Test: `tests/dominio/seed-datos.test.ts`

**Interfaces:**
- Produces:
  - `zonedInstant(date: string, time: string, timeZone: string): Date`, `addDays(date: string, days: number): string`, `isWeekend(date: string): boolean`, `todayIn(timeZone: string, now: Date): string`
  - `IDENTIFIER_SYSTEMS` (objeto con `practitioner`, `healthcareService`, `schedule`, `slot`, `patient`, `appointment`)
  - Tipos `SeedTenant`, `SeedPractitioner`, `SeedService`, `SeedSchedule`, `SeedSlot`, `SeedPatient`, `SeedAppointment` (ver código)
  - `buildSeed(anchor: string, timeZone: string): SeedTenant[]`

- [ ] **Step 1: Prueba que falla**

`tests/dominio/seed-datos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSeed } from "../../prisma/seed/data";
import { todayIn, zonedInstant } from "../../prisma/seed/time";

const ANCHOR = "2026-03-02"; // lunes
const ZONE = "America/Bogota";

describe("dominio: datos del seed", () => {
  it("una hora local de Bogota se guarda en UTC-5", () => {
    expect(zonedInstant("2026-03-02", "08:00", ZONE).toISOString()).toBe("2026-03-02T13:00:00.000Z");
  });

  it("todayIn devuelve la fecha local", () => {
    expect(todayIn(ZONE, new Date("2026-03-03T03:00:00Z"))).toBe("2026-03-02");
  });

  it("mismo ancla produce exactamente los mismos datos", () => {
    expect(buildSeed(ANCHOR, ZONE)).toEqual(buildSeed(ANCHOR, ZONE));
  });

  it("deja dos tenants con la forma pedida por la spec", () => {
    const tenants = buildSeed(ANCHOR, ZONE);
    expect(tenants.map((tenant) => tenant.slug)).toEqual(["clinica-norte", "clinica-sur"]);
    for (const tenant of tenants) {
      expect(tenant.practitioners).toHaveLength(3);
      expect(tenant.services).toHaveLength(2);
      expect(tenant.schedules).toHaveLength(3);
      expect(tenant.patients).toHaveLength(5);
      expect(tenant.patients.filter((p) => p.status === "pre_registered")).toHaveLength(1);
      expect(tenant.appointments.filter((a) => a.status === "fulfilled")).toHaveLength(4);
      expect(tenant.appointments.filter((a) => a.status === "booked")).toHaveLength(4);
    }
  });

  it("los cupos caen en dias habiles y solo los de una cita estan ocupados", () => {
    for (const tenant of buildSeed(ANCHOR, ZONE)) {
      const busy = new Set(tenant.appointments.map((a) => a.slotId));
      for (const slot of tenant.slots) {
        const localDay = new Date(slot.startAt.getTime() - 5 * 3600_000).getUTCDay();
        expect([0, 6]).not.toContain(localDay);
        expect(slot.status).toBe(busy.has(slot.id) ? "busy" : "free");
      }
    }
  });

  it("las citas pasadas estan antes del ancla y las futuras despues", () => {
    const anchorInstant = zonedInstant(ANCHOR, "00:00", ZONE).getTime();
    for (const tenant of buildSeed(ANCHOR, ZONE)) {
      for (const appointment of tenant.appointments) {
        const before = appointment.startAt.getTime() < anchorInstant;
        expect(before).toBe(appointment.status === "fulfilled");
      }
    }
  });

  it("los ids son distintos entre tenants", () => {
    const [norte, sur] = buildSeed(ANCHOR, ZONE);
    const idsNorte = new Set(norte?.practitioners.map((p) => p.id));
    expect(sur?.practitioners.some((p) => idsNorte.has(p.id))).toBe(false);
  });
});
```

Run: `npx vitest run tests/dominio/seed-datos.test.ts`
Expected: FAIL — `prisma/seed/data` inexistente.

- [ ] **Step 2: Implementar `prisma/seed/time.ts`**

```ts
/** Utilidades de fecha del seed. Fechas locales como `YYYY-MM-DD`, horas como `HH:mm`. */

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/** Instante UTC correspondiente a una hora local en la zona dada. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00.000Z`);
  return new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
```

- [ ] **Step 3: Implementar `prisma/seed/data.ts`**

```ts
import { v5 as uuidv5 } from "uuid";
import { addDays, isWeekend, zonedInstant } from "./time";

/**
 * Unica fuente de datos del seed. La consumen dos escritores (chatbot y simulador),
 * asi que la simetria entre ambos lados sale de la construccion. Mismo ancla, mismo
 * resultado: IDs derivados por UUIDv5 y fechas relativas al ancla.
 */

export const IDENTIFIER_SYSTEMS = {
  practitioner: "urn:hermes:practitioner",
  healthcareService: "urn:hermes:healthcare-service",
  schedule: "urn:hermes:schedule",
  slot: "urn:hermes:slot",
  patient: "urn:hermes:patient",
  appointment: "urn:hermes:appointment",
} as const;

const SEED_NAMESPACE = "6f1c2a4e-0b7d-4c55-9a53-3f2e8d1b7c90";
const SLOT_TIMES = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
const SLOT_MINUTES = 30;
const PAST_DAYS = 7;
const FUTURE_DAYS = 14;

export type SeedPractitioner = { id: string; identifierValue: string; name: string };
export type SeedService = { id: string; identifierValue: string; name: string };
export type SeedSchedule = {
  id: string;
  identifierValue: string;
  practitionerId: string;
  healthcareServiceId: string;
};
export type SeedSlot = {
  id: string;
  identifierValue: string;
  scheduleId: string;
  startAt: Date;
  endAt: Date;
  status: "free" | "busy";
};
export type SeedPatient = {
  id: string;
  identifierValue: string;
  documentType: "CC";
  documentNumber: string;
  givenNames: string;
  familyNames: string;
  birthDate: string;
  phone: string;
  email: string;
  status: "active" | "pre_registered";
};
export type SeedAppointment = {
  id: string;
  identifierValue: string;
  patientId: string;
  scheduleId: string;
  slotId: string;
  startAt: Date;
  endAt: Date;
  status: "fulfilled" | "booked";
};
export type SeedTenant = {
  id: string;
  slug: string;
  name: string;
  practitioners: SeedPractitioner[];
  services: SeedService[];
  schedules: SeedSchedule[];
  slots: SeedSlot[];
  patients: SeedPatient[];
  appointments: SeedAppointment[];
};

type TenantTemplate = {
  slug: string;
  name: string;
  practitioners: string[];
  patients: [string, string][];
};

const TEMPLATES: TenantTemplate[] = [
  {
    slug: "clinica-norte",
    name: "Clínica Norte",
    practitioners: ["Ana Gómez", "Luis Pérez", "Marta Ruiz"],
    patients: [
      ["Carlos", "Mejía Soto"],
      ["Diana", "López Rey"],
      ["Jorge", "Castro Gil"],
      ["Laura", "Vargas Paz"],
      ["Pedro", "Rojas Luna"],
    ],
  },
  {
    slug: "clinica-sur",
    name: "Clínica Sur",
    practitioners: ["Sofía Díaz", "Andrés Mora", "Elena Ríos"],
    patients: [
      ["Camila", "Ortiz Vega"],
      ["Mateo", "Suárez Pino"],
      ["Valentina", "Cruz Mar"],
      ["Santiago", "Reyes Sol"],
      ["Isabel", "Navas Río"],
    ],
  },
];

const SERVICES = ["Medicina general", "Odontología"];

const seedId = (name: string): string => uuidv5(name, SEED_NAMESPACE);
const pad = (value: number): string => String(value).padStart(3, "0");

function weekdaysBetween(anchor: string, from: number, to: number): string[] {
  const days: string[] = [];
  for (let offset = from; offset <= to; offset++) {
    const date = addDays(anchor, offset);
    if (!isWeekend(date)) {
      days.push(date);
    }
  }
  return days;
}

function buildSlots(
  slug: string,
  schedules: SeedSchedule[],
  anchor: string,
  timeZone: string,
): SeedSlot[] {
  const days = weekdaysBetween(anchor, -PAST_DAYS, FUTURE_DAYS - 1);
  return schedules.flatMap((schedule) =>
    days.flatMap((date) =>
      SLOT_TIMES.map((time) => {
        const identifierValue = `${schedule.identifierValue}-${date}-${time.replace(":", "")}`;
        const startAt = zonedInstant(date, time, timeZone);
        return {
          id: seedId(`${slug}:slot:${identifierValue}`),
          identifierValue,
          scheduleId: schedule.id,
          startAt,
          endAt: new Date(startAt.getTime() + SLOT_MINUTES * 60_000),
          status: "free" as const,
        };
      }),
    ),
  );
}

type AppointmentPlan = { patient: SeedPatient; schedule: SeedSchedule; date: string; time: string; status: "fulfilled" | "booked" };

function planAppointments(
  patients: SeedPatient[],
  schedules: SeedSchedule[],
  anchor: string,
): AppointmentPlan[] {
  const past = weekdaysBetween(anchor, -PAST_DAYS, -1);
  const future = weekdaysBetween(anchor, 1, FUTURE_DAYS - 1);
  const active = patients.filter((patient) => patient.status === "active");
  return active.flatMap((patient, index) => {
    const schedule = schedules[index % schedules.length] as SeedSchedule;
    return [
      { patient, schedule, date: past[index % past.length] as string, time: "08:00", status: "fulfilled" as const },
      { patient, schedule, date: future[index % future.length] as string, time: "08:30", status: "booked" as const },
    ];
  });
}

function buildAppointments(slug: string, plans: AppointmentPlan[], slots: SeedSlot[]): SeedAppointment[] {
  const slotsByValue = new Map(slots.map((slot) => [slot.identifierValue, slot]));
  return plans.map((plan, index) => {
    const slotValue = `${plan.schedule.identifierValue}-${plan.date}-${plan.time.replace(":", "")}`;
    const slot = slotsByValue.get(slotValue);
    if (!slot) {
      throw new Error(`Seed inconsistente: no existe el cupo ${slotValue}`);
    }
    slot.status = "busy";
    const identifierValue = `A-${pad(index + 1)}`;
    return {
      id: seedId(`${slug}:appointment:${identifierValue}`),
      identifierValue,
      patientId: plan.patient.id,
      scheduleId: plan.schedule.id,
      slotId: slot.id,
      startAt: slot.startAt,
      endAt: slot.endAt,
      status: plan.status,
    };
  });
}

function buildTenant(template: TenantTemplate, tenantIndex: number, anchor: string, timeZone: string): SeedTenant {
  const { slug } = template;
  const practitioners = template.practitioners.map((name, i) => ({
    id: seedId(`${slug}:practitioner:P-${pad(i + 1)}`),
    identifierValue: `P-${pad(i + 1)}`,
    name,
  }));
  const services = SERVICES.map((name, i) => ({
    id: seedId(`${slug}:service:S-${pad(i + 1)}`),
    identifierValue: `S-${pad(i + 1)}`,
    name,
  }));
  const schedules = practitioners.map((practitioner, i) => ({
    id: seedId(`${slug}:schedule:SCH-${pad(i + 1)}`),
    identifierValue: `SCH-${pad(i + 1)}`,
    practitionerId: practitioner.id,
    healthcareServiceId: (services[i % services.length] as SeedService).id,
  }));
  const patients = template.patients.map(([givenNames, familyNames], i) => ({
    id: seedId(`${slug}:patient:PAT-${pad(i + 1)}`),
    identifierValue: `PAT-${pad(i + 1)}`,
    documentType: "CC" as const,
    documentNumber: `${tenantIndex + 1}0000000${i + 1}`,
    givenNames,
    familyNames,
    birthDate: `19${80 + i}-0${i + 1}-15`,
    phone: `30000000${tenantIndex + 1}${i + 1}`,
    email: `paciente${i + 1}@${slug}.test`,
    status: i === template.patients.length - 1 ? ("pre_registered" as const) : ("active" as const),
  }));
  const slots = buildSlots(slug, schedules, anchor, timeZone);
  const appointments = buildAppointments(slug, planAppointments(patients, schedules, anchor), slots);
  return { id: seedId(`tenant:${slug}`), slug, name: template.name, practitioners, services, schedules, slots, patients, appointments };
}

export function buildSeed(anchor: string, timeZone: string): SeedTenant[] {
  return TEMPLATES.map((template, index) => buildTenant(template, index, anchor, timeZone));
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/dominio/seed-datos.test.ts && npx biome ci . && npm run typecheck`
Expected: PASS. Si Biome reformatea, aplicar `npx biome check --write prisma/seed` y volver a correr.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed tests/dominio/seed-datos.test.ts
git commit -m "feat(seed): datos deterministas de dos tenants relativos a una fecha ancla"
```

---

### Task 8: Escritores del seed, CLI y suite `simetria-seed`

**Files:**
- Create: `prisma/seed/write-chatbot.ts`, `prisma/seed/write-simulator.ts`, `prisma/seed/index.ts`
- Test: `tests/db/simetria-seed.test.ts`

**Interfaces:**
- Consumes: `buildSeed`, `SeedTenant`, `IDENTIFIER_SYSTEMS` (Task 7); `createPrismaClient` (Task 2); `loadConfig` (`src/config/env.ts`).
- Produces: `writeChatbot(prisma: PrismaClient, tenants: readonly SeedTenant[]): Promise<void>`, `writeSimulator(prisma: PrismaClient, tenants: readonly SeedTenant[]): Promise<void>`, script `npm run db:seed -- --anchor YYYY-MM-DD`.

- [ ] **Step 1: Prueba que falla**

`tests/db/simetria-seed.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeed } from "../../prisma/seed/data";
import { writeChatbot } from "../../prisma/seed/write-chatbot";
import { writeSimulator } from "../../prisma/seed/write-simulator";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const seed = buildSeed("2026-03-02", "America/Bogota");

const byIdentifier = <T extends { tenantId: string; identifierSystem: string; identifierValue: string }>(
  rows: T[],
) =>
  rows
    .map((row) => ({ ...row, createdAt: undefined, updatedAt: undefined }))
    .sort((a, b) =>
      `${a.tenantId}|${a.identifierSystem}|${a.identifierValue}`.localeCompare(
        `${b.tenantId}|${b.identifierSystem}|${b.identifierValue}`,
      ),
    );

describe("simetria-seed: el simulador y el chatbot parten de los mismos datos", () => {
  beforeAll(async () => {
    await truncateAll(prisma);
    await writeChatbot(prisma, seed);
    await writeSimulator(prisma, seed);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("siembra dos tenants", async () => {
    expect(await prisma.tenant.count()).toBe(2);
  });

  it("profesionales, servicios y agendas son gemelos", async () => {
    expect(byIdentifier(await prisma.simPractitioner.findMany())).toEqual(
      byIdentifier(await prisma.practitioner.findMany()),
    );
    expect(byIdentifier(await prisma.simHealthcareService.findMany())).toEqual(
      byIdentifier(await prisma.healthcareService.findMany()),
    );
    expect(byIdentifier(await prisma.simSchedule.findMany())).toEqual(
      byIdentifier(await prisma.schedule.findMany()),
    );
  });

  it("cupos, pacientes y citas son gemelos", async () => {
    expect(byIdentifier(await prisma.simSlot.findMany())).toEqual(
      byIdentifier(await prisma.slot.findMany()),
    );
    expect(byIdentifier(await prisma.simPatient.findMany())).toEqual(
      byIdentifier(await prisma.medicalRecord.findMany()),
    );
    const simAppointments = (await prisma.simAppointment.findMany()).map(({ patientId, ...row }) => ({
      ...row,
      medicalRecordId: patientId,
    }));
    expect(byIdentifier(simAppointments)).toEqual(byIdentifier(await prisma.appointment.findMany()));
  });

  it("volver a sembrar con el mismo ancla no duplica nada", async () => {
    const before = await prisma.slot.count();
    await writeChatbot(prisma, seed);
    await writeSimulator(prisma, seed);
    expect(await prisma.slot.count()).toBe(before);
    expect(await prisma.simSlot.count()).toBe(before);
  });
});
```

Run: `npm run test:db`
Expected: FAIL — escritores inexistentes.

- [ ] **Step 2: Implementar `prisma/seed/write-chatbot.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { IDENTIFIER_SYSTEMS as SYS, type SeedTenant } from "./data";

type Tx = Prisma.TransactionClient;

async function writeMasters(tx: Tx, t: SeedTenant): Promise<void> {
  for (const p of t.practitioners) {
    const data = { id: p.id, tenantId: t.id, identifierSystem: SYS.practitioner, identifierValue: p.identifierValue, name: p.name };
    await tx.practitioner.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const s of t.services) {
    const data = { id: s.id, tenantId: t.id, identifierSystem: SYS.healthcareService, identifierValue: s.identifierValue, name: s.name };
    await tx.healthcareService.upsert({ where: { id: s.id }, create: data, update: data });
  }
  for (const s of t.schedules) {
    const data = { id: s.id, tenantId: t.id, identifierSystem: SYS.schedule, identifierValue: s.identifierValue, practitionerId: s.practitionerId, healthcareServiceId: s.healthcareServiceId };
    await tx.schedule.upsert({ where: { id: s.id }, create: data, update: data });
  }
}

async function writeAgenda(tx: Tx, t: SeedTenant): Promise<void> {
  for (const s of t.slots) {
    const data = { id: s.id, tenantId: t.id, identifierSystem: SYS.slot, identifierValue: s.identifierValue, scheduleId: s.scheduleId, startAt: s.startAt, endAt: s.endAt, status: s.status };
    await tx.slot.upsert({ where: { id: s.id }, create: data, update: data });
  }
  for (const p of t.patients) {
    const data = {
      id: p.id, tenantId: t.id, identifierSystem: SYS.patient, identifierValue: p.identifierValue,
      documentType: p.documentType, documentNumber: p.documentNumber, givenNames: p.givenNames,
      familyNames: p.familyNames, birthDate: new Date(`${p.birthDate}T00:00:00.000Z`),
      phone: p.phone, email: p.email, status: p.status,
    };
    await tx.medicalRecord.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const a of t.appointments) {
    const data = { id: a.id, tenantId: t.id, identifierSystem: SYS.appointment, identifierValue: a.identifierValue, medicalRecordId: a.patientId, scheduleId: a.scheduleId, slotId: a.slotId, startAt: a.startAt, endAt: a.endAt, status: a.status };
    await tx.appointment.upsert({ where: { id: a.id }, create: data, update: data });
  }
}

/** Siembra las tablas del chatbot (schema public). Idempotente por id. */
export async function writeChatbot(prisma: PrismaClient, tenants: readonly SeedTenant[]): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const t of tenants) {
        const data = { id: t.id, slug: t.slug, name: t.name };
        await tx.tenant.upsert({ where: { id: t.id }, create: data, update: data });
        await writeMasters(tx, t);
        await writeAgenda(tx, t);
      }
    },
    { timeout: 120_000 },
  );
}
```

- [ ] **Step 3: Implementar `prisma/seed/write-simulator.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { IDENTIFIER_SYSTEMS as SYS, type SeedTenant } from "./data";

type Tx = Prisma.TransactionClient;

async function writeMasters(tx: Tx, t: SeedTenant): Promise<void> {
  for (const p of t.practitioners) {
    const data = { id: p.id, tenantId: t.id, identifierSystem: SYS.practitioner, identifierValue: p.identifierValue, name: p.name };
    await tx.simPractitioner.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const s of t.services) {
    const data = { id: s.id, tenantId: t.id, identifierSystem: SYS.healthcareService, identifierValue: s.identifierValue, name: s.name };
    await tx.simHealthcareService.upsert({ where: { id: s.id }, create: data, update: data });
  }
  for (const s of t.schedules) {
    const data = { id: s.id, tenantId: t.id, identifierSystem: SYS.schedule, identifierValue: s.identifierValue, practitionerId: s.practitionerId, healthcareServiceId: s.healthcareServiceId };
    await tx.simSchedule.upsert({ where: { id: s.id }, create: data, update: data });
  }
}

async function writeAgenda(tx: Tx, t: SeedTenant): Promise<void> {
  for (const s of t.slots) {
    const data = { id: s.id, tenantId: t.id, identifierSystem: SYS.slot, identifierValue: s.identifierValue, scheduleId: s.scheduleId, startAt: s.startAt, endAt: s.endAt, status: s.status };
    await tx.simSlot.upsert({ where: { id: s.id }, create: data, update: data });
  }
  for (const p of t.patients) {
    const data = {
      id: p.id, tenantId: t.id, identifierSystem: SYS.patient, identifierValue: p.identifierValue,
      documentType: p.documentType, documentNumber: p.documentNumber, givenNames: p.givenNames,
      familyNames: p.familyNames, birthDate: new Date(`${p.birthDate}T00:00:00.000Z`),
      phone: p.phone, email: p.email, status: p.status,
    };
    await tx.simPatient.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const a of t.appointments) {
    const data = { id: a.id, tenantId: t.id, identifierSystem: SYS.appointment, identifierValue: a.identifierValue, patientId: a.patientId, scheduleId: a.scheduleId, slotId: a.slotId, startAt: a.startAt, endAt: a.endAt, status: a.status };
    await tx.simAppointment.upsert({ where: { id: a.id }, create: data, update: data });
  }
}

/** Siembra el schema hermes_sim: los maestros "de Hermes" antes de cualquier sincronizacion. */
export async function writeSimulator(prisma: PrismaClient, tenants: readonly SeedTenant[]): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const t of tenants) {
        await writeMasters(tx, t);
        await writeAgenda(tx, t);
      }
    },
    { timeout: 120_000 },
  );
}
```

Nota: los dos escritores se parecen, pero escriben modelos distintos de componentes distintos que evolucionarán por separado (el simulador se elimina en producción). Es el segundo uso, no el tercero: no se unifican (GOBERNANZA §4).

- [ ] **Step 4: Implementar el CLI `prisma/seed/index.ts`**

```ts
import { loadConfig } from "../../src/config/env";
import { createPrismaClient } from "../../src/modules/shared/infrastructure/prisma-client";
import { buildSeed } from "./data";
import { todayIn } from "./time";
import { writeChatbot } from "./write-chatbot";
import { writeSimulator } from "./write-simulator";

function parseAnchor(args: readonly string[]): string | undefined {
  const index = args.indexOf("--anchor");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--anchor debe tener formato YYYY-MM-DD");
  }
  return value;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const anchor = parseAnchor(process.argv.slice(2)) ?? todayIn(config.appTimezone, new Date());
  const tenants = buildSeed(anchor, config.appTimezone);
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await writeChatbot(prisma, tenants);
    await writeSimulator(prisma, tenants);
    process.stdout.write(
      `Seed aplicado con ancla ${anchor}: ${tenants.map((t) => `${t.slug} (${t.id})`).join(", ")}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Correr pruebas y el seed real contra `chatbot_dev`**

Run: `npm run test:db`
Expected: `simetria-seed` 4 PASS y el resto en verde.

Run: `npm run db:seed -- --anchor 2026-03-02`
Expected: `Seed aplicado con ancla 2026-03-02: clinica-norte (...), clinica-sur (...)`. Correrlo dos veces no debe fallar.

- [ ] **Step 6: Puertas y commit**

Run: `npm test && npm run typecheck && npx biome ci .`

```bash
git add prisma/seed tests/db/simetria-seed.test.ts
git commit -m "feat(seed): escritores simetricos del chatbot y del simulador, suite simetria-seed"
```

---

### Task 9: CI con Postgres, imagen que migra al arrancar y documentación

**Files:**
- Modify: `.github/workflows/ci.yml` (raíz del repo)
- Modify: `backend/Dockerfile`
- Create: `backend/docker/entrypoint.sh`
- Modify: `README.md`, `CLAUDE.md` (raíz)

**Interfaces:**
- Consumes: scripts `test`, `db:seed` (Tasks 2 y 8); migraciones (Tasks 2 y 3).

- [ ] **Step 1: Servicio Postgres en el job `backend` de CI**

En `.github/workflows/ci.yml`, dentro de `jobs.backend`, añadir antes de `steps:`:

```yaml
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: chatbot_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

y en el bloque `env:` del job añadir:

```yaml
      TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/chatbot_test
```

- [ ] **Step 2: Entrypoint que migra y arranca**

`backend/docker/entrypoint.sh`:

```sh
#!/bin/sh
# Aplica migraciones pendientes y arranca el servidor. Si la migracion falla,
# el contenedor no arranca: nunca se sirve con un esquema desalineado.
set -e
cd /app/tools
npx prisma migrate deploy
cd /app
exec node server.js
```

- [ ] **Step 3: Dockerfile con etapa `tools`**

Reemplazar `backend/Dockerfile` completo:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder solo para `prisma generate` en build; el valor real llega por entorno en runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
RUN npx prisma generate && npm run build

# Herramientas de operacion: CLI de Prisma para migrar y tsx para el seed.
FROM node:26-alpine AS tools
RUN apk add --no-cache openssl
WORKDIR /app/tools
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/config ./src/config
COPY src/modules/shared/infrastructure/prisma-client.ts ./src/modules/shared/infrastructure/prisma-client.ts
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
RUN npx prisma generate

FROM node:26-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=tools --chown=nextjs:nodejs /app/tools ./tools
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
USER nextjs
EXPOSE 3001
CMD ["sh", "/app/entrypoint.sh"]
```

Nota: `tools` necesita `tsconfig.json` para resolver `@/` solo si el seed lo usara; el seed importa con rutas relativas, así que no hace falta.

- [ ] **Step 4: Verificar lo verificable en local**

Docker no está instalado en la máquina de desarrollo. Verificar:

Run: `npm run build`
Expected: build de Next sin errores con `@prisma/adapter-pg` y `pg`.

Run: `sh -n docker/entrypoint.sh`
Expected: sin salida (sintaxis válida).

La verificación del contenedor ocurre al desplegar en Easypanel (servicio `chatbot_hermes_backend`): tras el deploy, `GET /api/v1/health` → 200 y en el Postgres `mango_postgres` la base `chatbot_hermes` con las tablas de ambos schemas. **El deploy lo decide el usuario** (Easypanel despliega desde `main`).

- [ ] **Step 5: Documentación**

En `README.md` (raíz), añadir una sección después de la de arranque local:

```markdown
## Base de datos

- Desarrollo: `DATABASE_URL` apunta a `chatbot_dev` (Postgres local de Laragon o `docker compose up postgres -d`).
- Migraciones: `npm --prefix backend exec prisma migrate dev` (desarrollo) · el contenedor ejecuta `prisma migrate deploy` al arrancar.
- Seed determinista de dos tenants: `npm --prefix backend run db:seed -- --anchor YYYY-MM-DD` (sin `--anchor`, usa hoy en `APP_TIMEZONE`). En el contenedor: `cd /app/tools && npm run db:seed`.
- Pruebas contra Postgres: `npm --prefix backend run test:db` usa `TEST_DATABASE_URL` (por defecto `postgresql://postgres@localhost:5432/chatbot_test`); la suite borra y recrea los schemas de esa base.
```

En `CLAUDE.md` (raíz), en el bloque de comandos, añadir tras la línea de Prisma:

```markdown
Suites contra Postgres: `npm --prefix backend run test:db` (proyecto Vitest `db`, lee `TEST_DATABASE_URL`, destruye y recrea esa base). Seed: `npm --prefix backend run db:seed -- --anchor YYYY-MM-DD`.
```

y en "Estado actual" reemplazar la frase `**No hay modelo de datos** — \`prisma/schema.prisma\` solo declara el datasource — ni persistencia real: eso es la Fase 2.` por:

```markdown
**Fase 2 en curso** (spec en `docs/superpowers/specs/2026-09-22-fase-2-dominio-persistido-design.md`): esquema `public` + `hermes_sim`, núcleo compartido, ajustes del tenant, auditoría, idempotencia y seed listos; faltan casos de uso, rutas y frontend.
```

- [ ] **Step 6: Puertas finales y commit**

Run (desde la raíz): `npm run ci && npm run typecheck && npm test`
Expected: todo en verde (el `npm test` del backend incluye el proyecto `db`).

```bash
git add .github/workflows/ci.yml backend/Dockerfile backend/docker/entrypoint.sh README.md CLAUDE.md
git commit -m "chore: CI con Postgres, imagen que migra al arrancar y docs de base de datos"
```

---

## Cobertura de la spec (sub-proyecto 1)

| Spec | Task |
| --- | --- |
| §3.1 tablas `public`, FKs compuestas, CHECKs | 2 |
| §3.2 schema `hermes_sim` sin FK a `public` | 3 |
| §4.1 `shared` (Clock, IdGenerator, TenantId, cursor), frontera del simulador | 1 |
| §4.2 paginación 50/200 y cursor opaco | 1 |
| §5.3 idempotencia (almacén; la envoltura HTTP es del sub-proyecto 2) | 6 |
| Auditoría sin contenido | 5 |
| Tope de rango por tenant (dato y repositorio; rutas en sub-proyecto 2) | 2, 4 |
| §6 seed determinista, dos escritores | 7, 8 |
| §8 `simetria-seed`, base de `aislamiento-tenant`, `dominio` | 1, 2, 4, 7, 8 |
| §9 migrar al arrancar, CI con Postgres | 9 |

Queda para el sub-proyecto 2: casos de uso de lectura y sus adaptadores Prisma, `idempotentRoute`, `conflict` (409) en `ERROR_CODES`, rutas `/api/v1` y `/api/sim/v1`, `openapi-sim.json`, `HERMES_SIMULATOR_ENABLED`, suites `dominio` de casos de uso, `aislamiento-tenant` completa e `idempotencia` HTTP.
