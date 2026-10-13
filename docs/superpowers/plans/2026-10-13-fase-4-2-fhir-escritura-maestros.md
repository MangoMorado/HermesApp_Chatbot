# Fase 4.2 — FHIR: escritura de maestros. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hermes (rol `service`) escribe maestros por `PUT` condicional en `/fhir` (`Patient`, `Practitioner`, `HealthcareService`, `Schedule`, `Slot`), con idempotencia, auditoría, confirmación de pre-registro y rechazo de solicitudes cuando ocupa un cupo apartado.

**Architecture:** `fhir` parsea el `PUT` y declara puertos de escritura; no importa `patients` ni `scheduling`. El composition root cumple esos puertos con casos de uso nuevos en esos módulos. La idempotencia vive en un adaptador HTTP FHIR que reutiliza `runIdempotent` y responde con `OperationOutcome` / recurso FHIR, nunca con la envoltura REST. `metadata` crece desde el registro.

**Tech Stack:** Next.js 16 (route handlers), Prisma 7 + Postgres, Vitest 5 (`unit` y `db`), Biome 2, TypeScript 7 (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

**Spec:** `docs/superpowers/specs/2026-10-13-fase-4-2-fhir-escritura-maestros-design.md`

## Global Constraints

- Sin IA: ninguna dependencia ni import de LLM, embeddings, vectores o n8n. Esta fase no añade dependencias.
- `/fhir` es exclusivo del rol `service`. `operator`, `admin` y `widget` → `403`. Única ruta pública: `GET /fhir/metadata`.
- `tenant_id` solo del claim del JWT. Recurso de otro tenant → `404`, nunca `403`.
- Toda respuesta de `/fhir`, también los errores, lleva `Content-Type: application/fhir+json` y `X-Request-Id`. El cuerpo de un error es un `OperationOutcome`; nunca la envoltura REST.
- Autenticación y rol se comprueban **antes** de enrutar: sin token `service`, ninguna ruta de `/fhir` responde `404`.
- `GET /fhir/metadata` declara exactamente lo implementado: sale del registro.
- Literales FHIR solo en `backend/src/modules/fhir/domain/profiles.ts`.
- Un mapper y un parser por recurso; no se unifican.
- `domain` y `application` no importan `next`, `@prisma/client`, `node:*` ni `react`.
- `fhir` solo importa `shared` y `auth` de otros módulos; ningún módulo importa `fhir`.
- `process.env` solo en `backend/src/config/env.ts`.
- Clean Code: complejidad cognitiva ≤ 15, ≤ 40 líneas por función (sin blancos), ≤ 400 líneas por archivo de lógica, 0 ciclos. El cableado nuevo va en `composition/fhir-wiring.ts`.
- Código, rutas y campos en inglés; comentarios y mensajes en español (comentarios de código sin tildes).
- No se toca `/api/v1`: `openapi.json` y orval no cambian. No se toca `frontend/`. Sin migración.
- **Rama `fase-4-2-fhir-escritura-maestros`.** Commitear solo los archivos de cada tarea con `git add <rutas>`; nunca `git add -A`, `git stash`, `git checkout --` ni `reset`. **No tocar ni commitear** `CLAUDE.md`, `PRODUCT.md`, `ROADMAP.md`, `docs/brief.md` ni `interactive/`. No hacer merge a `main` ni abrir PR: lo hace el usuario.
- Comandos desde la raíz. Suites `db` necesitan Postgres y `TEST_DATABASE_URL` (por defecto `postgresql://postgres@localhost:5432/chatbot_test`); destruyen y recrean esa base.
- En Windows, para archivos de esta fase usa `npm --prefix backend run lint`. Antes de cada commit: `npm --prefix backend exec -- biome check --write <archivos de la tarea>`.

## Mapa de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `fhir/domain/fhir-error.ts` | `conflict` 409/412; `Allow` configurable en 405 |
| `fhir/domain/resources/types.ts` | `IssueCode` + `conflict`; `CapabilityStatement` con `update` / `conditionalUpdate` / `updateCreate` |
| `fhir/domain/operation-outcome.ts` | Sin cambio de firma; usa el nuevo código |
| `fhir/domain/parsers/*.ts` | Un parser por recurso (cuerpo → comando tipado) |
| `fhir/domain/ports/writers.ts` | Puertos de escritura y tipos de comando / resultado |
| `fhir/domain/registry.ts` | `writable: boolean` (o interacciones) por recurso |
| `fhir/domain/capability-statement.ts` | Emite `update` + flags solo si el recurso es escribible |
| `fhir/domain/profiles.ts` | `CAPABILITY_DATE` → `2026-10-13` (escritura) o la fecha del commit de contrato |
| `fhir/application/conditional-put.ts` | Orquesta parseo → puerto → mapper de lectura |
| `http/fhir-route.ts` | `fhirResponse` con status, `Location`, `Allow`; `toFhirError` traduce `ConflictError` |
| `http/fhir-idempotent-route.ts` | Adaptador idempotente FHIR (reusa `runIdempotent`) |
| `http/fhir-dispatch.ts` | Despacha `PUT` condicional de los cinco tipos |
| `patients/.../upsert-patient-from-hermes.ts` | Upsert + confirmación de pre-registro |
| `patients/.../repositories.ts` + Prisma | `findByIdentifier`, `insertActive`, `updateFromHermes` |
| `scheduling/.../upsert-*-from-hermes.ts` | Cuatro casos de uso (practitioner, service, schedule, slot) |
| `scheduling/...` puertos + Prisma | `findByIdentifier`, insert/update; en slot, hold vivo y rechazo sin liberar |
| `composition/fhir-wiring.ts` | Conecta lecturas y escrituras |
| `tests/helpers/fhir.ts` | `fhirPut` con cuerpo, cabeceras e `Idempotency-Key` |
| Suites | `fhir/parsers`, upserts unitarios, `fhir-conformance` HTTP write, aislamiento, roles, idempotencia |

## Refinamientos sobre la spec

La Tarea 1 los deja escritos en la spec (§9). Salen de leer el código al planificar:

1. **`serviceFhirRoute` siempre responde 200.** El `PUT` usa un envoltorio nuevo (`serviceFhirIdempotentRoute`) que autentica `service`, corre `runIdempotent` y emite el status del resultado (`201`/`200`), con `Location`.
2. **Rechazo del apartado sin liberar el cupo.** `resolveAppointmentRequest` con `rejected` aplica `resolutionEffects(..., "released")`, que pone el cupo en `free`. El upsert de `Slot` **no** llama a ese caso de uso: escribe el estado que manda Hermes, marca la solicitud `rejected` / `slot_unavailable` con `markResolved` y audita, sin pasar el cupo a `free`.
3. **`Allow` en 405.** Tipos escribibles: `Allow: GET, PUT`. `Appointment` y `PUT` por id: `Allow: GET`.
4. **Hash de idempotencia.** El path del hash es `pathname + search` (p. ej. `/fhir/Patient?identifier=...`), para que otra query con la misma clave sea `409`.
5. **`fhirSend` del helper actual no basta.** Se añade `fhirPut(pathAndQuery, token, body, headers?)`.
6. **Documentación de la PR:** `README.md` y `backend/AGENTS.md`. `GOBERNANZA.md` solo si hace falta. `CLAUDE.md` y `ROADMAP.md` los edita el usuario.

## Review Focus

- **Rechazo del apartado:** tras `PUT` con `busy`, el cupo queda `busy` (no `free`) y la solicitud `rejected` / `slot_unavailable`.
- **Pre-registro:** mismo `id` interno; desaparece el tag; identificador de negocio del cuerpo.
- **Idempotencia:** misma clave + misma query + mismo cuerpo → misma respuesta; otra query → `409`.
- **Campo de más / tag en el cuerpo → `400` `not-supported`.**
- **`metadata`:** solo los cinco tienen `update` + `conditionalUpdate` + `updateCreate`; la prueba HTTP ejecuta el `PUT`.

---

### Task 1: Errores, tipos de capability y parsers

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-fase-4-2-fhir-escritura-maestros-design.md` (añadir §9)
- Modify: `backend/src/modules/fhir/domain/resources/types.ts`
- Modify: `backend/src/modules/fhir/domain/fhir-error.ts`
- Modify: `backend/src/http/fhir-route.ts`
- Create: `backend/src/modules/fhir/domain/parsers/body.ts` (helpers compartidos de forma)
- Create: `backend/src/modules/fhir/domain/parsers/patient.ts`
- Create: `backend/src/modules/fhir/domain/parsers/practitioner.ts`
- Create: `backend/src/modules/fhir/domain/parsers/healthcare-service.ts`
- Create: `backend/src/modules/fhir/domain/parsers/schedule.ts`
- Create: `backend/src/modules/fhir/domain/parsers/slot.ts`
- Create: `backend/src/modules/fhir/domain/ports/writers.ts`
- Test: `backend/tests/fhir/parsers.test.ts`
- Modify: `backend/tests/fhir/registro.test.ts` (solo si ya falla por tipos; si no, en Tarea 5)

**Interfaces:**
- Produces:
  - `IssueCode` incluye `"conflict"`.
  - `fhirConflict(message: string): FhirError` → 409.
  - `fhirMultipleMatches(message: string): FhirError` → 412.
  - `fhirMethodNotAllowed(allow: string): FhirError` (ajuste: recibe `Allow`).
  - `fhirResponse(body, status, requestId, extras?: { location?: string; allow?: string })`.
  - `toFhirError` traduce `ConflictError` → `fhirConflict(error.message)`.
  - De `ports/writers.ts`:
    ```ts
    export type WriteOutcome = "created" | "updated";
    export type MasterWriteCommand = {
      readonly tenantId: TenantId;
      readonly actor: AuditActor;
      readonly identifier: FhirIdentifier;
      readonly name: string;
      readonly active: boolean;
    };
    export type PatientWriteCommand = {
      readonly tenantId: TenantId;
      readonly actor: AuditActor;
      readonly queryIdentifier: FhirIdentifier;
      readonly businessIdentifier: FhirIdentifier;
      readonly documentType: DocumentCode;
      readonly documentNumber: string;
      readonly givenNames: string;
      readonly familyNames: string;
      readonly birthDate: string;
      readonly phone: string | null;
      readonly email: string | null;
    };
    export type ScheduleWriteCommand = {
      readonly tenantId: TenantId;
      readonly actor: AuditActor;
      readonly identifier: FhirIdentifier;
      readonly active: boolean;
      readonly practitionerId: string;
      readonly healthcareServiceId: string;
    };
    export type SlotWriteCommand = {
      readonly tenantId: TenantId;
      readonly actor: AuditActor;
      readonly identifier: FhirIdentifier;
      readonly scheduleId: string;
      readonly status: SlotStatusKey;
      readonly startAt: Date;
      readonly endAt: Date;
    };
    export type WriteResult<R> =
      | { readonly outcome: WriteOutcome; readonly record: R }
      | { readonly outcome: "ambiguous" };
    export type FhirWriter<C, R> = (command: C) => Promise<WriteResult<R>>;
    export type FhirWriters = {
      readonly Patient: FhirWriter<PatientWriteCommand, PatientRecord>;
      readonly Practitioner: FhirWriter<MasterWriteCommand, PractitionerRecord>;
      readonly HealthcareService: FhirWriter<MasterWriteCommand, HealthcareServiceRecord>;
      readonly Schedule: FhirWriter<ScheduleWriteCommand, ScheduleRecord>;
      readonly Slot: FhirWriter<SlotWriteCommand, SlotRecord>;
    };
    ```
  - Parsers: `parsePatientBody(body, queryIdentifier)`, etc. Lanzan `FhirError`. Devuelven el comando sin `tenantId`/`actor` (los añade el caso de uso HTTP), o con campos de dominio listos y el llamador completa tenant/actor. **Decisión del plan:** el parser devuelve el payload tipado; `conditional-put` añade `tenantId` y `actor`.

- [ ] **Step 1: Dejar los refinamientos en la spec**

Al final de la spec añade:

```markdown

## 9. Refinamientos al planificar

1. **Envoltorio de escritura aparte.** `serviceFhirRoute` siempre responde 200; el `PUT`
   usa `serviceFhirIdempotentRoute` con status del resultado y `Location`.
2. **Rechazo del apartado sin liberar.** El upsert de `Slot` no llama a
   `resolveAppointmentRequest` (ese caso de uso pone el cupo en `free` al rechazar).
   Escribe el estado de Hermes, hace `markResolved` y audita.
3. **`Allow` en 405.** Escribibles: `GET, PUT`. Resto: `GET`.
4. **Hash de idempotencia** = método + `pathname+search` + cuerpo.
5. **Helper `fhirPut`** con cuerpo e `Idempotency-Key`.
6. **Docs de la PR:** `README.md`, `backend/AGENTS.md`. `CLAUDE.md` y `ROADMAP.md` fuera.
```

- [ ] **Step 2: Ampliar tipos y errores (test primero)**

Crea `backend/tests/fhir/parsers.test.ts` con al menos:

```ts
import { describe, expect, it } from "vitest";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import { parsePatientBody } from "@/modules/fhir/domain/parsers/patient";
import { parsePractitionerBody } from "@/modules/fhir/domain/parsers/practitioner";
import { parseSlotBody } from "@/modules/fhir/domain/parsers/slot";

const query = { system: "urn:hermes:patient", value: "MR-1" };

describe("fhir-conformance: parsers de escritura", () => {
  it("acepta un Patient minimo y ignora id", () => {
    const parsed = parsePatientBody(
      {
        resourceType: "Patient",
        id: "ignorar",
        identifier: [query, { system: "urn:ingenius:document:CC", value: "123" }],
        name: [{ family: "Perez", given: ["Ana", "Maria"] }],
        birthDate: "1990-01-02",
      },
      query,
    );
    expect(parsed.businessIdentifier).toEqual(query);
    expect(parsed.documentType).toBe("CC");
    expect(parsed.givenNames).toBe("Ana Maria");
    expect(parsed.phone).toBeNull();
  });

  it("rechaza tag pre-registered y campos de mas", () => {
    expect(() =>
      parsePatientBody(
        {
          resourceType: "Patient",
          identifier: [query, { system: "urn:ingenius:document:CC", value: "123" }],
          name: [{ family: "Perez", given: ["Ana"] }],
          birthDate: "1990-01-02",
          meta: { tag: [{ system: "urn:ingenius:patient-tag", code: "pre-registered" }] },
        },
        query,
      ),
    ).toThrow(FhirError);
    expect(() =>
      parsePractitionerBody(
        {
          resourceType: "Practitioner",
          identifier: [{ system: "urn:hermes:practitioner", value: "P-1" }],
          active: true,
          name: [{ text: "Dr" }],
          gender: "male",
        },
        { system: "urn:hermes:practitioner", value: "P-1" },
      ),
    ).toThrow(FhirError);
  });

  it("exige identifier de la query en el cuerpo y start < end en Slot", () => {
    expect(() =>
      parsePatientBody(
        {
          resourceType: "Patient",
          identifier: [
            { system: "urn:hermes:patient", value: "OTRO" },
            { system: "urn:ingenius:document:CC", value: "123" },
          ],
          name: [{ family: "Perez", given: ["Ana"] }],
          birthDate: "1990-01-02",
        },
        query,
      ),
    ).toThrow(FhirError);
    expect(() =>
      parseSlotBody(
        {
          resourceType: "Slot",
          identifier: [{ system: "urn:hermes:slot", value: "S-1" }],
          schedule: { reference: "Schedule/sch-1" },
          status: "free",
          start: "2026-06-15T14:00:00.000Z",
          end: "2026-06-15T13:00:00.000Z",
        },
        { system: "urn:hermes:slot", value: "S-1" },
      ),
    ).toThrow(FhirError);
  });
});
```

- [ ] **Step 3: Correr el test y ver que falla**

Run: `npm --prefix backend exec vitest run tests/fhir/parsers.test.ts`
Expected: FAIL (módulos inexistentes)

- [ ] **Step 4: Implementar tipos, errores, helpers y parsers**

En `resources/types.ts`:
- Añadir `"conflict"` a `IssueCode`.
- Ampliar `interaction.code` a `"read" | "search-type" | "update"`.
- En cada recurso del capability: opcionales `conditionalUpdate?: boolean` y `updateCreate?: boolean`.

En `fhir-error.ts`:

```ts
export function fhirConflict(message: string): FhirError {
  return new FhirError(409, "conflict", message);
}

export function fhirMultipleMatches(message: string): FhirError {
  return new FhirError(412, "conflict", message);
}

export function fhirMethodNotAllowed(allow = "GET"): FhirError {
  const error = new FhirError(405, "not-supported", "Interaccion no soportada sobre este recurso");
  (error as FhirError & { allow: string }).allow = allow;
  return error;
}
```

Preferible: campo `readonly allow?: string` en `FhirError` (añadir al constructor opcional).

En `fhir-route.ts`, `fhirResponse` acepta extras; `toFhirError` mapea `ConflictError`; el `Allow` sale de `failure.allow` si el status es 405.

`parsers/body.ts` — helpers:

```ts
import { fhirInvalid, fhirNotSupported } from "../fhir-error";
import type { FhirIdentifier } from "../resources/types";

const ALLOWED_ROOT = new Set([
  "resourceType",
  "id",
  "identifier",
  "active",
  "name",
  "birthDate",
  "telecom",
  "actor",
  "schedule",
  "status",
  "start",
  "end",
]);

export function assertObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw fhirInvalid("El cuerpo debe ser un recurso JSON");
  }
  return body as Record<string, unknown>;
}

export function assertNoExtraKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw fhirNotSupported(`Campo no soportado: ${key}`);
    }
  }
}

export function requireResourceType(body: Record<string, unknown>, type: string): void {
  if (body.resourceType !== type) {
    throw fhirInvalid(`resourceType debe ser ${type}`);
  }
}

export function requireQueryIdentifier(
  identifiers: readonly FhirIdentifier[],
  query: FhirIdentifier,
): void {
  const found = identifiers.some((item) => item.system === query.system && item.value === query.value);
  if (!found) {
    throw fhirInvalid("El identifier de la query debe aparecer en el cuerpo");
  }
}

export function readIdentifierArray(value: unknown): FhirIdentifier[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw fhirInvalid("identifier es obligatorio");
  }
  return value.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw fhirInvalid(`identifier[${index}] invalido`);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.system !== "string" || typeof row.value !== "string" || !row.system || !row.value) {
      throw fhirInvalid(`identifier[${index}] debe tener system y value`);
    }
    return { system: row.system, value: row.value };
  });
}
```

Implementar cada `parse*Body` con la lista exacta de claves permitidas por recurso (Patient: `resourceType`, `id`, `identifier`, `active`, `name`, `birthDate`, `telecom` — `active` si llega debe ser `true`; si llega `meta` → `not-supported`). `PRE_REGISTRATION_SYSTEM` no puede ser el system de negocio. Documento: exactamente un identifier cuyo system sea `documentCodeOf(...)`.

`parseSlotBody`: `start`/`end` con offset (`Z` o `±hh:mm`); `Date` parseables; `start < end`; `status` vía `slotStatusKeyOf`.

`ports/writers.ts` con los tipos de la sección Interfaces (importar `AuditActor`, `TenantId`, records de `sources.ts`, `DocumentCode`, `SlotStatusKey`).

- [ ] **Step 5: Correr parsers y typecheck parcial**

Run: `npm --prefix backend exec vitest run tests/fhir/parsers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-13-fase-4-2-fhir-escritura-maestros-design.md \
  backend/src/modules/fhir/domain/resources/types.ts \
  backend/src/modules/fhir/domain/fhir-error.ts \
  backend/src/http/fhir-route.ts \
  backend/src/modules/fhir/domain/parsers \
  backend/src/modules/fhir/domain/ports/writers.ts \
  backend/tests/fhir/parsers.test.ts
git commit -m "$(cat <<'EOF'
feat(fhir): parsers y errores de escritura condicional

EOF
)"
```

En PowerShell, si el heredoc falla, usa: `git commit -m "feat(fhir): parsers y errores de escritura condicional"`.

---

### Task 2: Upsert de `Patient` en `patients`

**Files:**
- Modify: `backend/src/modules/patients/domain/ports/repositories.ts`
- Modify: `backend/src/modules/patients/infrastructure/prisma-medical-record-repository.ts`
- Create: `backend/src/modules/patients/application/upsert-patient-from-hermes.ts`
- Test: `backend/tests/dominio/upsert-patient-from-hermes.test.ts`

**Interfaces:**
- Consumes: `MedicalRecord`, `AuditLog`, `Clock`, `IdGenerator`, `ConflictError`
- Produces:
  ```ts
  export type UpsertPatientFromHermes = (input: {
    readonly tenantId: TenantId;
    readonly actor: AuditActor;
    readonly queryIdentifier: FhirIdentifier; // system+value
    readonly businessIdentifier: { system: string; value: string };
    readonly documentType: DocumentType;
    readonly documentNumber: string;
    readonly givenNames: string;
    readonly familyNames: string;
    readonly birthDate: string;
    readonly phone: string | null;
    readonly email: string | null;
  }) => Promise<{ outcome: "created" | "updated"; record: MedicalRecord }>;
  ```
  Si hay ambigüedad imposible por índices, no hace falta devolver `ambiguous` aquí; el puerto FHIR puede mapear solo created/updated. **Si el buscador devolviera >1, el writer FHIR traduce a ambiguous** — el repo busca con `findUnique` / `findFirst` y no puede devolver >1. El writer de fhir-wiring envuelve y nunca emite ambiguous salvo que se busque por lista; **esta fase: search by unique keys only**, sin `ambiguous` desde patients. El `412` se prueba a nivel HTTP solo si se puede fabricar (p. ej. sin unique en test) — **refinamiento:** con el esquema actual el `412` queda cubierto por un test unitario del caso de uso de `conditional-put` con puerto falso que devuelve `ambiguous`, no por una fila real en Postgres.

- [ ] **Step 1: Test unitario del caso de uso (falla)**

```ts
import { describe, expect, it, vi } from "vitest";
import { createUpsertPatientFromHermes } from "@/modules/patients/application/upsert-patient-from-hermes";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { MedicalRecord } from "@/modules/patients/domain/entities";

function record(over: Partial<MedicalRecord> = {}): MedicalRecord {
  return {
    id: "mr-1",
    tenantId: "t1",
    identifier: { system: "urn:ingenius:pre-registration", value: "mr-1" },
    documentType: "CC",
    documentNumber: "123",
    givenNames: "Ana",
    familyNames: "Perez",
    birthDate: "1990-01-02",
    phone: null,
    email: null,
    status: "pre_registered",
    ...over,
  };
}

describe("dominio: upsert Patient desde Hermes", () => {
  it("confirma un pre-registro por documento y audita", async () => {
    const existing = record();
    const repo = {
      findByDocument: vi.fn(async () => existing),
      findByIdentifier: vi.fn(async () => null),
      get: vi.fn(),
      insertPreRegistered: vi.fn(),
      insertActive: vi.fn(),
      updateFromHermes: vi.fn(async (row: MedicalRecord) => row),
    };
    const audit = { record: vi.fn(async () => {}) };
    const upsert = createUpsertPatientFromHermes({
      repo,
      ids: { next: () => "new-id" },
      clock: { now: () => new Date("2026-06-15T12:00:00.000Z") },
      audit,
    });
    const result = await upsert({
      tenantId: "t1" as never,
      actor: { actorSubject: "hermes", actorRole: "service", requestId: "r1" },
      queryIdentifier: { system: "urn:hermes:patient", value: "MR-9" },
      businessIdentifier: { system: "urn:hermes:patient", value: "MR-9" },
      documentType: "CC",
      documentNumber: "123",
      givenNames: "Ana",
      familyNames: "Perez",
      birthDate: "1990-01-02",
      phone: null,
      email: null,
    });
    expect(result.outcome).toBe("updated");
    expect(result.record.status).toBe("active");
    expect(result.record.id).toBe("mr-1");
    expect(result.record.identifier).toEqual({ system: "urn:hermes:patient", value: "MR-9" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "patient.written_by_hermes", resourceId: "mr-1" }),
    );
  });

  it("conflicto si el documento es de un active distinto", async () => {
    const repo = {
      findByDocument: vi.fn(async () => record({ status: "active", id: "otro" })),
      findByIdentifier: vi.fn(async () => null),
      get: vi.fn(),
      insertPreRegistered: vi.fn(),
      insertActive: vi.fn(),
      updateFromHermes: vi.fn(),
    };
    const upsert = createUpsertPatientFromHermes({
      repo,
      ids: { next: () => "x" },
      clock: { now: () => new Date() },
      audit: { record: vi.fn(async () => {}) },
    });
    await expect(
      upsert({
        tenantId: "t1" as never,
        actor: { actorSubject: "h", actorRole: "service", requestId: "r" },
        queryIdentifier: { system: "urn:hermes:patient", value: "MR-9" },
        businessIdentifier: { system: "urn:hermes:patient", value: "MR-9" },
        documentType: "CC",
        documentNumber: "123",
        givenNames: "Ana",
        familyNames: "Perez",
        birthDate: "1990-01-02",
        phone: null,
        email: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL**

Run: `npm --prefix backend exec vitest run tests/dominio/upsert-patient-from-hermes.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar puerto e implementación**

Ampliar `MedicalRecordRepository`:

```ts
findByIdentifier(
  tenantId: TenantId,
  identifier: { system: string; value: string },
): Promise<MedicalRecord | null>;
insertActive(record: MedicalRecord): Promise<void>;
updateFromHermes(record: MedicalRecord): Promise<MedicalRecord>;
```

Prisma: `findUnique` por `tenantId_identifierSystem_identifierValue`; `create` con `status: "active"`; `update` de campos demográficos + identifier + status `active`; P2002 → `ConflictError` con mensaje en español.

Lógica de `createUpsertPatientFromHermes` (resumen ejecutable):

1. `byQuery` = si `documentCodeOf(query.system)` entonces `findByDocument`, si no `findByIdentifier(query)`.
2. `byDocument` = `findByDocument(documentType, documentNumber)`.
3. Si `byQuery`:
   - si `byDocument` y `byDocument.id !== byQuery.id` → conflicto;
   - `updateFromHermes` con business identifier + datos + `active`; auditar; return updated.
4. Si no `byQuery` y `byDocument`:
   - si `active` → conflicto;
   - si `pre_registered` → update confirmando; auditar; return updated.
5. Si ninguno → `insertActive` con nuevo id; auditar; return created.

- [ ] **Step 4: PASS + commit**

```bash
git add backend/src/modules/patients backend/tests/dominio/upsert-patient-from-hermes.test.ts
git commit -m "feat(patients): upsert y confirmacion de pre-registro desde Hermes"
```

---

### Task 3: Upserts de `Practitioner`, `HealthcareService` y `Schedule`

**Files:**
- Modify: `backend/src/modules/scheduling/domain/ports/repositories.ts` (o crear `ports/hermes-writes.ts` si el archivo de repos de lectura no es el lugar — **usar** ampliar repos existentes / nuevo puerto `MasterWriteStore` en `scheduling/domain/ports/hermes-masters.ts` para no mezclar listados con escritura)
- Create: `backend/src/modules/scheduling/domain/ports/hermes-masters.ts`
- Create: `backend/src/modules/scheduling/infrastructure/prisma-hermes-masters.ts`
- Create: `backend/src/modules/scheduling/application/upsert-practitioner-from-hermes.ts`
- Create: `backend/src/modules/scheduling/application/upsert-healthcare-service-from-hermes.ts`
- Create: `backend/src/modules/scheduling/application/upsert-schedule-from-hermes.ts`
- Test: `backend/tests/dominio/upsert-masters-from-hermes.test.ts`

**Interfaces:**
- Produces: tres factories `createUpsert*FromHermes` con firma análoga a Patient (sin documento). Schedule valida que existan practitioner y service (`ValidationError` si faltan).
- Puerto:

```ts
export type HermesMasterStore = {
  findPractitionerByIdentifier(tenantId, id): Promise<Practitioner | null>;
  savePractitioner(row: Practitioner, mode: "insert" | "update"): Promise<void>;
  findHealthcareServiceByIdentifier(tenantId, id): Promise<HealthcareService | null>;
  saveHealthcareService(row: HealthcareService, mode: "insert" | "update"): Promise<void>;
  findScheduleByIdentifier(tenantId, id): Promise<Schedule | null>;
  getPractitioner(tenantId, id): Promise<Practitioner | null>;
  getHealthcareService(tenantId, id): Promise<HealthcareService | null>;
  saveSchedule(row: Schedule, mode: "insert" | "update"): Promise<void>;
};
```

P2002 → `ConflictError("El identificador ya existe")`.

- [ ] **Step 1: Test** — alta + update de Practitioner; Schedule con actor inexistente → `ValidationError`.
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implementar store + tres casos de uso** (cada uno ≤ 40 líneas netas; extraer `upsertMaster` privado solo si aparece tres veces idéntico — gobernanza: al tercer uso).
- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(scheduling): upsert de profesionales, servicios y agendas desde Hermes"
```

---

### Task 4: Upsert de `Slot` con conflicto de apartado

**Files:**
- Modify: `backend/src/modules/scheduling/domain/ports/hermes-masters.ts` (o `hermes-slots.ts`)
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-hermes-masters.ts`
- Modify: `backend/src/modules/scheduling/domain/ports/pre-agenda.ts` — añadir `findLiveHoldBySlot(tenantId, slotId, now): Promise<AppointmentRequest | null>`
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-pre-agenda-store.ts`
- Create: `backend/src/modules/scheduling/application/upsert-slot-from-hermes.ts`
- Test: `backend/tests/dominio/upsert-slot-from-hermes.test.ts`

**Interfaces:**
- Produces: `createUpsertSlotFromHermes`
- Reglas:
  1. `expireDue(tenantId, now)` (o el puerto `RequestExpirer`) **antes** de mirar el hold.
  2. `getSchedule` debe existir → si no, `ValidationError`.
  3. Buscar slot por identifier.
  4. Si existe y hay hold vivo:
     - si el comando no cambia solo a status `busy`|`busy_unavailable` **o** cambia schedule/start/end → `ConflictError("El cupo esta apartado")`;
     - si status es `busy`|`busy_unavailable` y el resto de campos iguales a los persistidos (o se permiten los mismos valores): guardar status, `markResolved` rejected/slot_unavailable, auditar `slot.written_by_hermes` + `appointment_request.rejected`.
  5. Si no hay hold: insert/update normal + auditoría slot.
  6. **Nunca** llamar `setSlotStatus(..., "free")` en este flujo de rechazo.

Comparación de campos del cupo apartado: `scheduleId`, `startAt`, `endAt` deben coincidir con el comando; solo `status` puede pasar a ocupado.

- [ ] **Step 1: Test**

```ts
it("ocupa un cupo apartado y rechaza la solicitud sin liberarlo", async () => { /* ... */ });
it("rechaza un PUT free sobre cupo apartado", async () => { /* ... */ });
it("rechaza cambiar start de un cupo apartado", async () => { /* ... */ });
```

- [ ] **Step 2–4: FAIL → implement → PASS → commit**

```bash
git commit -m "feat(scheduling): upsert de Slot con rechazo de apartado por Hermes"
```

---

### Task 5: Registro, capability, caso de uso `conditional-put` y wiring

**Files:**
- Modify: `backend/src/modules/fhir/domain/registry.ts`
- Modify: `backend/src/modules/fhir/domain/capability-statement.ts`
- Modify: `backend/src/modules/fhir/domain/profiles.ts` (`CAPABILITY_DATE`)
- Create: `backend/src/modules/fhir/application/conditional-put.ts`
- Modify: `backend/src/composition/fhir-wiring.ts`
- Modify: `backend/src/composition-root.ts` (exponer `fhir.conditionalPut` en el contenedor; añadir writers a `WritePorts` si el put corre dentro de `withWriteTransaction`)
- Modify: `backend/tests/fhir/registro.test.ts`
- Test: `backend/tests/fhir/conditional-put.test.ts`

**Interfaces:**
- Produces:

```ts
export type ConditionalPut = (input: {
  readonly tenantId: TenantId;
  readonly actor: Actor; // o AuditActor + role service ya garantizado
  readonly type: string;
  readonly entries: readonly [string, string][];
  readonly body: unknown;
}) => Promise<{ status: 200 | 201; resource: FhirResource }>;
```

Flujo:
1. Si tipo no es resource type → el dispatch ya filtró; aquí si no es writable → no se llama.
2. Query: solo `identifier` (un valor `system|value`); otros params → `not-supported`/`invalid`.
3. `parse*Body` según tipo.
4. Llamar writer; si `ambiguous` → `fhirMultipleMatches`; si created → 201; updated → 200.
5. Mapear record con `DEFINITIONS[type].toResource`.

Registro: cada definition gana `readonly writable: boolean` (`Appointment: false`, resto de maestros escribibles: true). `DECLARED_RESOURCES` incluye `writable`.

Capability:

```ts
interaction: writable
  ? [{ code: "read" }, { code: "search-type" }, { code: "update" }]
  : [{ code: "read" }, { code: "search-type" }],
...(writable ? { conditionalUpdate: true, updateCreate: true } : {}),
```

Wiring: construir writers con los casos de uso de patients/scheduling + `expire` en Slot antes del upsert (el caso de uso Slot ya expira; el wiring no duplica).

`WritePorts` gana, p. ej.:

```ts
readonly upsertPatientFromHermes: UpsertPatientFromHermes;
readonly upsertPractitionerFromHermes: ...;
// etc.
```

o un solo `fhirWriters` construido dentro de la transacción. Preferible funciones en `WritePorts` para reutilizar audit/ids/clock de la tx.

- [ ] **Step 1: Actualizar test de capability** en `registro.test.ts` para esperar `update` en cinco recursos y no en `Appointment`.
- [ ] **Step 2: Test de `conditional-put`** con writers falsos (created/updated/ambiguous).
- [ ] **Step 3: Implementar**
- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(fhir): conditional-put y metadata con update"
```

---

### Task 6: Superficie HTTP idempotente

**Files:**
- Create: `backend/src/http/fhir-idempotent-route.ts`
- Modify: `backend/src/http/fhir-dispatch.ts`
- Modify: `backend/src/http/fhir-route.ts` (si faltó algo de Allow/Location en Tarea 1)
- Modify: `backend/tests/helpers/fhir.ts`
- Modify: `backend/tests/roles.test.ts` (añadir casos PUT)
- Test unitario opcional del dispatch si hace falta

**Interfaces:**
- Produces: `serviceFhirIdempotentRoute(request, execute)` donde `execute` recibe `{ actor, body, ports, requestId }` y devuelve `{ status, body, location? }`.

Implementación clave:

```ts
export async function serviceFhirIdempotentRoute(
  request: Request,
  execute: (ctx: {
    actor: Actor;
    body: unknown;
    ports: WritePorts;
    requestId: string;
  }) => Promise<{ status: number; body: unknown; location?: string }>,
): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    const container = getContainer();
    const actor = await container.authenticate(request.headers.get("Authorization"));
    requireRole(actor, ["service"]);
    const url = new URL(request.url);
    // Ampliar readIdempotentRequest con pathMode: "pathname+search" (Tarea 6).
    // Eso incluye la query en `path` y en el hash; no se recalcula a mano.
    const idempotent = await readIdempotentRequest(
      request,
      actor.subject,
      1,
      undefined,
      "pathname+search",
    );
    const result = await runIdempotent({
      request: idempotent,
      outside: tenantScope(container.idempotencyStore, actor.tenantId),
      inside: (ports) => tenantScope(ports.idempotencyStore, actor.tenantId),
      execute: async (ports) => {
        const outcome = await execute({
          actor,
          body: idempotent.body,
          ports,
          requestId,
        });
        return { status: outcome.status, body: outcome.body, stored: outcome.body };
      },
    });
    const resource = result.body as { resourceType?: string; id?: string };
    const location =
      (result.status === 200 || result.status === 201) && resource.resourceType && resource.id
        ? `${getContainer().config.fhirBaseUrl ?? `${url.origin}/fhir`}/${resource.resourceType}/${resource.id}`
        : undefined;
    return fhirResponse(result.body, result.status, requestId, { location });
  } catch (error) {
    const failure = toFhirError(error);
    return fhirResponse(
      operationOutcome(failure.code, failure.message),
      failure.status,
      requestId,
      { allow: failure.allow },
    );
  }
}
```

**Refinamiento de Location en replay:** persistir en `responseBody` el recurso; al responder, si status es 200/201, `Location = base + '/' + resourceType + '/' + id`. Base = `config.fhirBaseUrl ?? origin/fhir`.

Ampliar `readIdempotentRequest` en `idempotency-core.ts`:

```ts
export async function readIdempotentRequest(
  request: Request,
  actorSubject: string,
  minKeyLength = 1,
  hashKey?: string,
  pathMode: "pathname" | "pathname+search" = "pathname",
): Promise<IdempotentRequest>
```

REST sigue con default `pathname`. FHIR pasa `"pathname+search"`.

`handleFhirWrite`:

```ts
export function handleFhirWrite(request: Request, path: readonly string[]): Promise<NextResponse> {
  return serviceFhirIdempotentRoute(request, async ({ actor, body, ports, requestId }) => {
    if (request.method !== "PUT") {
      throw fhirMethodNotAllowed(allowFor(path));
    }
    const [type, id, ...rest] = path;
    if (type === undefined || rest.length > 0) {
      throw type !== undefined && isResourceType(type) ? fhirMethodNotAllowed("GET") : fhirNotFound();
    }
    if (id !== undefined) {
      throw fhirMethodNotAllowed("GET");
    }
    if (!isResourceType(type)) {
      throw fhirNotFound();
    }
    if (type === "Appointment" || !DEFINITIONS[type].writable) {
      throw fhirMethodNotAllowed("GET");
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/fhir+json")) {
      throw fhirInvalid("Content-Type debe ser application/fhir+json");
    }
    const url = new URL(request.url);
    const result = await ports.fhirConditionalPut({
      tenantId: actor.tenantId,
      actor: {
        actorSubject: actor.subject,
        actorRole: actor.role,
        requestId,
      },
      type,
      entries: [...url.searchParams.entries()],
      body,
    });
    const base = getContainer().config.fhirBaseUrl ?? `${url.origin}/fhir`;
    return {
      status: result.status,
      body: result.resource,
      location: `${base}/${result.resource.resourceType}/${result.resource.id}`,
    };
  });
}
```

Nota: `fhirConditionalPut` debe estar en `WritePorts` porque corre dentro de la tx de idempotencia.

Helper:

```ts
export async function fhirPut(
  pathAndQuery: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const url = new URL(`http://localhost/fhir/${pathAndQuery}`);
  const response = await PUT(
    authedRequest(url.toString(), token, {
      method: "PUT",
      headers: {
        "Content-Type": "application/fhir+json",
        "Idempotency-Key": headers["Idempotency-Key"] ?? crypto.randomUUID(),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: segmentsOf(url) }) },
  );
  return { response, body: await response.json() };
}
```

Comprobar que `authedRequest` acepte `body` y headers extra (ajustar helper `token.ts` si no).

Roles test: `PUT /fhir/Patient?identifier=...` con token operator → 403 OperationOutcome.

- [ ] **Step 1–4: tests roles → implement → PASS → commit**

```bash
git commit -m "feat(fhir): PUT condicional idempotente en /fhir"
```

---

### Task 7: Suites HTTP `db` (conformidad, aislamiento, idempotencia)

**Files:**
- Create: `backend/tests/db/fhir-escritura-http.test.ts` (o ampliar `fhir-conformance-http.test.ts`)
- Modify: `backend/tests/db/aislamiento-tenant-http.test.ts` (o archivo fhir aislamiento)
- Modify: `backend/tests/db/idempotencia-http.test.ts`
- Modify: `backend/tests/db/fhir-conformance-http.test.ts` (metadata espera `update` + ejecuta PUT de muestra)

**Casos mínimos (cada uno `it`):**

1. `PUT` Practitioner nuevo → 201 + Location + fila + audit `practitioner.written_by_hermes`.
2. Mismo identifier otra vez → 200 + una sola fila (criterio 2).
3. Patient confirma pre-registro → mismo id, sin tag, status active.
4. Patient documento de active ajeno → 409 conflict.
5. Slot hold: crear request pending vía API/store de prueba; PUT busy → slot busy, request rejected/slot_unavailable; audit de ambos; PUT free → 409 y hold intacto.
6. Schedule con Practitioner inexistente → 400.
7. Appointment PUT condicional → 405 Allow GET.
8. PUT Patient/{id} → 405 Allow GET.
9. Campo de más → 400 not-supported.
10. metadata: cinco con update/conditionalUpdate/updateCreate; Appointment sin update; por cada update declarado, un PUT de muestra → 200/201.
11. Aislamiento: token tenant B no modifica identifier de A; mismo identifier en B crea recurso B.
12. Idempotencia: sin clave → 400; misma clave repite 201; misma clave otro body → 409; misma clave otra query → 409.

Datos: reutilizar `seedTenantDomain` + inserts de pre-registro/hold como en suites existentes de pre-agenda.

- [ ] **Step 1: Escribir tests (FAIL hasta que el cableado esté completo; si Tarea 6 ya permite, deben PASS)**
- [ ] **Step 2: Run**

```bash
npm --prefix backend run test:db -- tests/db/fhir-escritura-http.test.ts tests/db/fhir-conformance-http.test.ts
```

- [ ] **Step 3: Ajustar hasta verde**
- [ ] **Step 4: Commit**

```bash
git commit -m "test(fhir): escritura condicional, aislamiento e idempotencia"
```

---

### Task 8: Documentación y puertas de cierre

**Files:**
- Modify: `README.md` (estado: 4.2 en curso o cerrada según el momento del PR; documentar `PUT` + `Idempotency-Key`)
- Modify: `backend/AGENTS.md` (cómo añadir escritura: parser + writable en registro + writer en wiring)
- Modify: spec estado → implementada en rama (opcional)
- No tocar `CLAUDE.md` / `ROADMAP.md`

- [ ] **Step 1: Actualizar docs**
- [ ] **Step 2: Puertas**

```bash
npm --prefix backend exec -- biome check --write src/modules/fhir src/modules/patients src/modules/scheduling src/http src/composition tests/fhir tests/dominio/upsert-*.ts tests/db/fhir-*.ts tests/helpers/fhir.ts
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:db
```

Expected: todo verde.

- [ ] **Step 3: Commit docs**

```bash
git commit -m "docs: guia de escritura FHIR de maestros (Fase 4.2)"
```

---

## Cobertura de la spec

| Requisito | Tarea |
| --- | --- |
| PUT condicional 5 recursos | 5, 6, 7 |
| Upsert 0/1/412 | 1, 5, 7 |
| Confirmación pre-registro | 2, 7 |
| Conflicto documento | 2, 7 |
| Cupo apartado → rejected/slot_unavailable | 4, 7 |
| PUT free no suelta apartado | 4, 7 |
| Idempotencia + hash con query | 6, 7 |
| Auditoría written_by_hermes | 2–4, 7 |
| metadata update flags | 5, 7 |
| Roles 401/403 | 6, 7 |
| OperationOutcome / conflict code | 1, 6 |
| Fronteras fhir ↛ patients/scheduling | 5 + suite fronteras |
| Sin OpenAPI / sin frontend | Global |

## Autorevisión del plan

1. **Cobertura:** todos los criterios 2, 3, 4, 6 tienen tarea y prueba HTTP.
2. **Placeholders:** eliminados; el `412` real en Postgres se cubre vía puerto falso en Tarea 5 (índices únicos impiden ambigüedad real).
3. **Tipos:** `FhirWriters` / `WriteResult` / `Upsert*FromHermes` alineados entre tareas.
4. **Riesgo `resolveAppointmentRequest`:** documentado en refinamiento 2; Tarea 4 usa `markResolved` directo.
