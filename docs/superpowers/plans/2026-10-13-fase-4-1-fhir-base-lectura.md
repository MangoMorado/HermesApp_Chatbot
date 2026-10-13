# Fase 4.1 — FHIR: base y lectura. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superficie `/fhir` en solo lectura: `read` y `search-type` de `Patient`, `Practitioner`, `HealthcareService`, `Schedule`, `Slot` y `Appointment`, con errores `OperationOutcome` y un `CapabilityStatement` generado del mismo registro que enruta.

**Architecture:** Módulo nuevo `modules/fhir` (solo `domain` y `application`) que declara sus puertos de lectura y no importa ningún otro módulo de negocio. `composition/fhir-wiring.ts` cumple esos puertos con adaptadores Prisma nuevos de `scheduling` y `patients` (lectura por id y búsqueda por desplazamiento con total). Una sola ruta `app/fhir/[[...path]]/route.ts` despacha contra el registro de recursos; `http/fhir-route.ts` autentica, exige `service` y traduce todo error a `OperationOutcome`.

**Tech Stack:** Next.js 16 (route handlers), Prisma 7 + Postgres (`@prisma/adapter-pg`), Vitest 5 (proyectos `unit` y `db`), Biome 2, TypeScript 7 (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

**Spec:** `docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md`

## Global Constraints

- Sin IA: ninguna dependencia ni import de LLM, embeddings, vectores o n8n. Esta fase no añade dependencias.
- `/fhir` es exclusivo del rol `service`, en lectura y escritura. `operator`, `admin` y `widget` → `403`. Única ruta pública: `GET /fhir/metadata`.
- `tenant_id` solo del claim del JWT. Recurso de otro tenant → `404`, nunca `403`.
- Toda respuesta de `/fhir`, también los errores, lleva `Content-Type: application/fhir+json` y la cabecera `X-Request-Id`. El cuerpo de un error es un `OperationOutcome`; nunca la envoltura REST `{ error: … }`.
- Autenticación y rol se comprueban **antes** de enrutar: sin token `service`, cualquier ruta bajo `/fhir` responde `401` o `403`, nunca `404`.
- `GET /fhir/metadata` declara exactamente lo implementado: sale de `DEFINITIONS` en `fhir/domain/registry.ts`, la misma tabla que valida los parámetros.
- Los literales FHIR (systems, tags, versión, MIME) viven solo en `backend/src/modules/fhir/domain/profiles.ts`.
- Un mapper por recurso; no se unifican aunque se parezcan.
- `domain` y `application` no importan `next`, `@prisma/client`, `node:*` ni `react`.
- `fhir` solo importa `shared` y `auth` de otros módulos; ningún módulo importa `fhir`.
- `process.env` solo en `backend/src/config/env.ts`.
- Clean Code: complejidad cognitiva ≤ 15, ≤ 40 líneas por función (sin blancos), ≤ 400 líneas por archivo de lógica, 0 ciclos de importación. `composition-root.ts` va por 386 líneas: el cableado nuevo va en `composition/fhir-wiring.ts` y el root gana como máximo 4 líneas.
- Código, rutas y campos en inglés; comentarios y mensajes en español (los comentarios de código del repo van sin tildes).
- Paginación: `_count` 50 por defecto, máximo 200 (un valor mayor se recorta); `_offset` 0 por defecto.
- No se toca `/api/v1`: `openapi.json` y los clientes orval no cambian. No se toca `frontend/`. Sin migración de base de datos.
- **Rama `fase-4-1-fhir-base-lectura`.** Commitear solo los archivos de cada tarea con `git add <rutas>`; nunca `git add -A`, `git stash`, `git checkout --` ni `reset`. **No tocar ni commitear** `CLAUDE.md`, `PRODUCT.md`, `ROADMAP.md`, `docs/brief.md` ni `interactive/`: el usuario los edita por separado. No hacer merge a `main` ni abrir PR: lo hace el usuario.
- Los comandos se corren desde la raíz del repo. Las suites `db` necesitan Postgres y `TEST_DATABASE_URL` (por defecto `postgresql://postgres@localhost:5432/chatbot_test`); destruyen y recrean esa base.
- En Windows `npm run ci` puede fallar por CRLF preexistente en archivos ajenos; para los archivos de esta fase usa `npm --prefix backend run lint`.
- `lint` es `biome check` e incluye formato (100 columnas). Los bloques de este plan pueden pasarse de ancho: antes de cada commit corre `npm --prefix backend exec -- biome check --write <archivos de la tarea>` y commitea el resultado formateado.

## Refinamientos sobre la spec

La Tarea 1 los deja escritos en la spec (§8). Salen de leer el código al planificar:

1. **Ruta `[[...path]]` (comodín opcional)** en vez de `[...path]`, para que `GET /fhir` sin segmentos también responda `OperationOutcome` y no el 404 de Next.
2. **`FHIR_BASE_URL` opcional** en `config/env.ts`. Los enlaces `self`/`next`/`previous` y los `fullUrl` del `Bundle` deben ser absolutos; detrás de un proxy que termina TLS el origen de la petición puede ser interno o `http`. Sin la variable se usa `<origen de la petición>/fhir`.
3. **`_tag` desconocido → `400` `invalid`.** El único tag que existe es `pre-registered`.
4. **Sin casos de uso nuevos en `scheduling` ni `patients`.** Las lecturas por desplazamiento no orquestan reglas: el wiring conecta los puertos de `fhir` directo con los adaptadores Prisma, como hace `composition/sim-wiring.ts`.
5. **Semántica de fechas sin hora** (día en `APP_TIMEZONE`): `eq` = todo el día; `ge` = desde el inicio del día; `gt` = desde el inicio del día siguiente; `le` = antes del inicio del día siguiente; `lt` = antes del inicio del día. Una fecha con hora exige offset (`Z` o `±hh:mm`).
6. **Un parámetro repetido** solo se admite en `start` y `date`. En los demás, repetido o vacío → `400` `invalid`. No hay `OR` por comas ni modificadores (`:exact`, `:not`): un nombre con modificador es un parámetro no soportado.
7. **`405` lleva `Allow: GET`.**
8. **Documentación de la PR:** `GOBERNANZA.md`, `README.md`, `backend/AGENTS.md` y los `.env.example`. `CLAUDE.md` y `ROADMAP.md` quedan fuera: el usuario los edita por separado.
9. **Tipos R4 en un solo archivo** `fhir/domain/resources/types.ts`.

## Review Focus

- **Offset de zona con `+` sin codificar.** `?start=ge2026-06-15T09:00:00+00:00` llega al servidor con un espacio en lugar del `+`. Se espera que funcione como si fuera `+`, no un `400`. Test en la Tarea 2.
- **`_offset` o `_count` desmedidos** (`_offset=99999999999999999999`): se espera `400` `invalid` para `_offset` y recorte a 200 para `_count`; nunca un `500` de Prisma. Test en la Tarea 2.
- **Fechas imposibles o sin offset** (`2026-02-31`, `2026-06-15T09:00:00`): se espera `400` `invalid`, no un desborde silencioso al mes siguiente ni una hora interpretada en la zona del servidor. Test en la Tarea 2.
- **Parámetro repetido o vacío** (`status=free&status=busy`, `identifier=`): se espera `400` `invalid`, no tomar el primero en silencio. Test en la Tarea 2.
- **Enlaces del `Bundle` detrás de un proxy.** Con `FHIR_BASE_URL` definida, `self`, `next` y `fullUrl` usan esa base, y `next` conserva los filtros de la búsqueda original. Test en la Tarea 6.

---

### Task 1: Base del dominio FHIR y mappers

**Files:**
- Modify: `backend/src/modules/shared/domain/pagination.ts` (añadir al final)
- Create: `backend/src/modules/fhir/domain/profiles.ts`
- Create: `backend/src/modules/fhir/domain/resources/types.ts`
- Create: `backend/src/modules/fhir/domain/ports/sources.ts`
- Create: `backend/src/modules/fhir/domain/mappers/patient.ts`
- Create: `backend/src/modules/fhir/domain/mappers/practitioner.ts`
- Create: `backend/src/modules/fhir/domain/mappers/healthcare-service.ts`
- Create: `backend/src/modules/fhir/domain/mappers/schedule.ts`
- Create: `backend/src/modules/fhir/domain/mappers/slot.ts`
- Create: `backend/src/modules/fhir/domain/mappers/appointment.ts`
- Test: `backend/tests/fhir/mapeo.test.ts`
- Modify: `backend/tests/fronteras.test.ts` (añadir un `it` al final del `describe`)
- Modify: `docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md` (§8 nueva)

**Interfaces:**
- Produces:
  - `OffsetPage<T> = { data: readonly T[]; total: number }` y `OffsetWindow = { offset: number; limit: number }` en `shared/domain/pagination.ts`.
  - De `profiles.ts`: `FHIR_VERSION`, `FHIR_MIME`, `CAPABILITY_DATE`, `SOFTWARE_NAME`, `RESOURCE_TYPES`, `type ResourceType`, `isResourceType(value: string): value is ResourceType`, `reference(type, id): { reference: string }`, `DOCUMENT_CODES`, `type DocumentCode`, `documentSystem(code): string`, `documentCodeOf(system): DocumentCode | null`, `PRE_REGISTERED_TAG`, `SLOT_STATUS`, `type SlotStatusKey`, `type FhirSlotStatus`, `slotStatusKeyOf(code: string): SlotStatusKey | null`, `APPOINTMENT_STATUSES`, `type AppointmentStatusCode`.
  - De `resources/types.ts`: `FhirIdentifier`, `FhirReference`, `FhirCoding`, `FhirPatient`, `FhirPractitioner`, `FhirHealthcareService`, `FhirSchedule`, `FhirSlot`, `FhirAppointment`, `FhirResource`, `IssueCode`, `OperationOutcome`, `BundleLink`, `FhirBundle`, `SearchParamType`, `CapabilityStatement`.
  - De `ports/sources.ts`: `PatientRecord`, `PractitionerRecord`, `HealthcareServiceRecord`, `ScheduleRecord`, `SlotRecord`, `AppointmentRecord`, `DateBound`, `MasterQuery`, `ScheduleQuery`, `SlotQuery`, `AppointmentQuery`, `PatientQuery`, `FhirSource<R, Q>`, `FhirSources`.
  - Mappers: `toPatient`, `toPractitioner`, `toHealthcareService`, `toSchedule`, `toSlot`, `toAppointment`.

- [ ] **Step 1: Dejar los refinamientos en la spec**

Al final de `docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md` añade:

```markdown

## 8. Refinamientos al planificar

1. **Ruta `[[...path]]` (comodín opcional)** en vez de `[...path]`: `GET /fhir` sin segmentos
   también responde `OperationOutcome`.
2. **`FHIR_BASE_URL` opcional.** Base pública de los enlaces y `fullUrl` del `Bundle`; sin ella
   se usa `<origen de la petición>/fhir`.
3. **`_tag` desconocido → `400` `invalid`.**
4. **Sin casos de uso nuevos en `scheduling` ni `patients`:** el wiring conecta los puertos de
   `fhir` directo con los adaptadores Prisma de lectura por desplazamiento.
5. **Fechas sin hora** (día en `APP_TIMEZONE`): `eq` todo el día; `ge` desde el inicio del día;
   `gt` desde el inicio del día siguiente; `le` antes del inicio del día siguiente; `lt` antes
   del inicio del día. Una fecha con hora exige offset.
6. **Parámetro repetido** solo en `start` y `date`; en los demás, repetido o vacío → `400`
   `invalid`. Sin `OR` por comas ni modificadores.
7. **`405` lleva `Allow: GET`.**
8. **Documentación de la PR:** `GOBERNANZA.md`, `README.md`, `backend/AGENTS.md` y los
   `.env.example`. `CLAUDE.md` y `ROADMAP.md` los edita el usuario por separado.
9. **Tipos R4 en un solo archivo** `fhir/domain/resources/types.ts`.
```

- [ ] **Step 2: Escribir el test de mapeo (falla)**

Crea `backend/tests/fhir/mapeo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toAppointment } from "@/modules/fhir/domain/mappers/appointment";
import { toHealthcareService } from "@/modules/fhir/domain/mappers/healthcare-service";
import { toPatient } from "@/modules/fhir/domain/mappers/patient";
import { toPractitioner } from "@/modules/fhir/domain/mappers/practitioner";
import { toSchedule } from "@/modules/fhir/domain/mappers/schedule";
import { toSlot } from "@/modules/fhir/domain/mappers/slot";
import type { PatientRecord } from "@/modules/fhir/domain/ports/sources";
import {
  documentCodeOf,
  documentSystem,
  isResourceType,
  slotStatusKeyOf,
} from "@/modules/fhir/domain/profiles";

const IDENTIFIER = { system: "urn:hermes:x", value: "X-1" };

const patient: PatientRecord = {
  id: "mr-1",
  identifier: { system: "urn:hermes:patient", value: "MR-1" },
  documentType: "CC",
  documentNumber: "1000",
  givenNames: "Ana  Maria",
  familyNames: "Perez Gomez",
  birthDate: "1990-01-15",
  phone: "3001234567",
  email: null,
  status: "active",
};

describe("fhir-conformance: perfiles", () => {
  it("el system de documento va y vuelve", () => {
    expect(documentCodeOf(documentSystem("TI"))).toBe("TI");
    expect(documentCodeOf("urn:hermes:patient")).toBeNull();
    expect(documentCodeOf("urn:ingenius:document:XX")).toBeNull();
  });

  it("reconoce solo los seis tipos de recurso", () => {
    expect(isResourceType("Slot")).toBe(true);
    expect(isResourceType("Task")).toBe(false);
    expect(isResourceType("slot")).toBe(false);
  });

  it("traduce el estado FHIR de un cupo a su clave interna", () => {
    expect(slotStatusKeyOf("busy-tentative")).toBe("busy_tentative");
    expect(slotStatusKeyOf("busy_tentative")).toBeNull();
  });
});

describe("fhir-conformance: Patient", () => {
  it("lleva el identificador Hermes y el documento", () => {
    expect(toPatient(patient)).toEqual({
      resourceType: "Patient",
      id: "mr-1",
      identifier: [
        { system: "urn:hermes:patient", value: "MR-1" },
        { system: "urn:ingenius:document:CC", value: "1000" },
      ],
      active: true,
      name: [{ family: "Perez Gomez", given: ["Ana", "Maria"] }],
      birthDate: "1990-01-15",
      telecom: [{ system: "phone", value: "3001234567" }],
    });
  });

  it("sin telefono ni correo no lleva telecom", () => {
    expect(toPatient({ ...patient, phone: null })).not.toHaveProperty("telecom");
  });

  it("un pre-registro lleva el tag pre-registered", () => {
    expect(toPatient({ ...patient, status: "pre_registered" }).meta).toEqual({
      tag: [{ system: "urn:ingenius:patient-tag", code: "pre-registered" }],
    });
    expect(toPatient(patient)).not.toHaveProperty("meta");
  });

  it("no filtra campos internos del registro", () => {
    const withTenant = { ...patient, tenantId: "tenant-a" };
    expect(JSON.stringify(toPatient(withTenant))).not.toContain("tenant-a");
  });
});

describe("fhir-conformance: maestros", () => {
  it("Practitioner", () => {
    expect(toPractitioner({ id: "p-1", identifier: IDENTIFIER, name: "Dra. Ruiz", active: true })).toEqual(
      {
        resourceType: "Practitioner",
        id: "p-1",
        identifier: [IDENTIFIER],
        active: true,
        name: [{ text: "Dra. Ruiz" }],
      },
    );
  });

  it("HealthcareService", () => {
    expect(
      toHealthcareService({ id: "s-1", identifier: IDENTIFIER, name: "Odontologia", active: false }),
    ).toEqual({
      resourceType: "HealthcareService",
      id: "s-1",
      identifier: [IDENTIFIER],
      active: false,
      name: "Odontologia",
    });
  });

  it("Schedule referencia al profesional y al servicio", () => {
    expect(
      toSchedule({
        id: "sch-1",
        identifier: IDENTIFIER,
        practitionerId: "p-1",
        healthcareServiceId: "s-1",
        active: true,
      }),
    ).toEqual({
      resourceType: "Schedule",
      id: "sch-1",
      identifier: [IDENTIFIER],
      active: true,
      actor: [{ reference: "Practitioner/p-1" }, { reference: "HealthcareService/s-1" }],
    });
  });
});

describe("fhir-conformance: Slot y Appointment", () => {
  const startAt = new Date("2026-06-15T14:00:00.000Z");
  const endAt = new Date("2026-06-15T14:30:00.000Z");

  it("Slot traduce el estado al value set de R4", () => {
    expect(
      toSlot({
        id: "sl-1",
        identifier: IDENTIFIER,
        scheduleId: "sch-1",
        startAt,
        endAt,
        status: "busy_tentative",
      }),
    ).toEqual({
      resourceType: "Slot",
      id: "sl-1",
      identifier: [IDENTIFIER],
      schedule: { reference: "Schedule/sch-1" },
      status: "busy-tentative",
      start: "2026-06-15T14:00:00.000Z",
      end: "2026-06-15T14:30:00.000Z",
    });
  });

  it("Appointment lleva cupo y los tres participantes", () => {
    expect(
      toAppointment({
        id: "ap-1",
        identifier: IDENTIFIER,
        medicalRecordId: "mr-1",
        slotId: "sl-1",
        practitionerId: "p-1",
        healthcareServiceId: "s-1",
        startAt,
        endAt,
        status: "booked",
      }),
    ).toEqual({
      resourceType: "Appointment",
      id: "ap-1",
      identifier: [IDENTIFIER],
      status: "booked",
      start: "2026-06-15T14:00:00.000Z",
      end: "2026-06-15T14:30:00.000Z",
      slot: [{ reference: "Slot/sl-1" }],
      participant: [
        { actor: { reference: "Patient/mr-1" }, status: "accepted" },
        { actor: { reference: "Practitioner/p-1" }, status: "accepted" },
        { actor: { reference: "HealthcareService/s-1" }, status: "accepted" },
      ],
    });
  });
});
```

- [ ] **Step 3: Correr el test y verlo fallar**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fhir/mapeo.test.ts`
Expected: FAIL, no resuelve `@/modules/fhir/domain/mappers/appointment`.

- [ ] **Step 4: `OffsetPage` en la paginación compartida**

Al final de `backend/src/modules/shared/domain/pagination.ts` añade:

```ts

/** Ventana por desplazamiento (FHIR `_count`/`_offset`). REST sigue paginando por cursor. */
export type OffsetWindow = { readonly offset: number; readonly limit: number };

export type OffsetPage<T> = { readonly data: readonly T[]; readonly total: number };
```

- [ ] **Step 5: `profiles.ts`**

Crea `backend/src/modules/fhir/domain/profiles.ts`:

```ts
/**
 * Unico modulo con literales FHIR: version, MIME, systems, tags y value sets
 * (GOBERNANZA §3.1). Ningun otro archivo repite estos valores.
 */

export const FHIR_VERSION = "4.0.1";
export const FHIR_MIME = "application/fhir+json";
export const SOFTWARE_NAME = "Chatbot Ingenius 360";
/** Fecha del contrato; se cambia cuando cambia lo que declara `metadata`. */
export const CAPABILITY_DATE = "2026-10-13";

export const RESOURCE_TYPES = [
  "Patient",
  "Practitioner",
  "HealthcareService",
  "Schedule",
  "Slot",
  "Appointment",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

export function reference(type: ResourceType, id: string): { readonly reference: string } {
  return { reference: `${type}/${id}` };
}

export const DOCUMENT_CODES = ["CC", "TI", "CE", "PA", "RC"] as const;

export type DocumentCode = (typeof DOCUMENT_CODES)[number];

const DOCUMENT_SYSTEM_PREFIX = "urn:ingenius:document:";

export function documentSystem(code: DocumentCode): string {
  return `${DOCUMENT_SYSTEM_PREFIX}${code}`;
}

/** Tipo de documento de un `system`, o `null` si no es un system de documento. */
export function documentCodeOf(system: string): DocumentCode | null {
  if (!system.startsWith(DOCUMENT_SYSTEM_PREFIX)) {
    return null;
  }
  const code = system.slice(DOCUMENT_SYSTEM_PREFIX.length);
  return (DOCUMENT_CODES as readonly string[]).includes(code) ? (code as DocumentCode) : null;
}

export const PRE_REGISTERED_TAG = {
  system: "urn:ingenius:patient-tag",
  code: "pre-registered",
} as const;

/** Estado interno del cupo -> codigo del value set `slotstatus` de R4. */
export const SLOT_STATUS = {
  free: "free",
  busy: "busy",
  busy_tentative: "busy-tentative",
  busy_unavailable: "busy-unavailable",
} as const;

export type SlotStatusKey = keyof typeof SLOT_STATUS;
export type FhirSlotStatus = (typeof SLOT_STATUS)[SlotStatusKey];

export function slotStatusKeyOf(code: string): SlotStatusKey | null {
  const keys = Object.keys(SLOT_STATUS) as SlotStatusKey[];
  return keys.find((key) => SLOT_STATUS[key] === code) ?? null;
}

/** Citas en firme: los codigos internos ya son los de `appointmentstatus` de R4. */
export const APPOINTMENT_STATUSES = ["booked", "cancelled", "fulfilled", "noshow"] as const;

export type AppointmentStatusCode = (typeof APPOINTMENT_STATUSES)[number];
```

- [ ] **Step 6: Tipos R4**

Crea `backend/src/modules/fhir/domain/resources/types.ts`:

```ts
import type { AppointmentStatusCode, FhirSlotStatus, ResourceType } from "../profiles";

/** Subconjunto de R4 que este servicio expone. Solo los campos que se emiten. */

export type FhirIdentifier = { readonly system: string; readonly value: string };
export type FhirReference = { readonly reference: string };
export type FhirCoding = { readonly system: string; readonly code: string };

export type FhirPatient = {
  readonly resourceType: "Patient";
  readonly id: string;
  readonly meta?: { readonly tag: readonly FhirCoding[] };
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly name: readonly { readonly family: string; readonly given: readonly string[] }[];
  readonly birthDate: string;
  readonly telecom?: readonly { readonly system: "phone" | "email"; readonly value: string }[];
};

export type FhirPractitioner = {
  readonly resourceType: "Practitioner";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly name: readonly { readonly text: string }[];
};

export type FhirHealthcareService = {
  readonly resourceType: "HealthcareService";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly name: string;
};

export type FhirSchedule = {
  readonly resourceType: "Schedule";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly actor: readonly FhirReference[];
};

export type FhirSlot = {
  readonly resourceType: "Slot";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly schedule: FhirReference;
  readonly status: FhirSlotStatus;
  readonly start: string;
  readonly end: string;
};

export type FhirAppointment = {
  readonly resourceType: "Appointment";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly status: AppointmentStatusCode;
  readonly start: string;
  readonly end: string;
  readonly slot: readonly FhirReference[];
  readonly participant: readonly { readonly actor: FhirReference; readonly status: "accepted" }[];
};

export type FhirResource =
  | FhirPatient
  | FhirPractitioner
  | FhirHealthcareService
  | FhirSchedule
  | FhirSlot
  | FhirAppointment;

export type IssueCode =
  | "login"
  | "forbidden"
  | "not-found"
  | "not-supported"
  | "invalid"
  | "exception";

export type OperationOutcome = {
  readonly resourceType: "OperationOutcome";
  readonly issue: readonly {
    readonly severity: "error";
    readonly code: IssueCode;
    readonly diagnostics: string;
  }[];
};

export type BundleLink = {
  readonly relation: "self" | "next" | "previous";
  readonly url: string;
};

export type FhirBundle = {
  readonly resourceType: "Bundle";
  readonly type: "searchset";
  readonly total: number;
  readonly link: readonly BundleLink[];
  readonly entry: readonly {
    readonly fullUrl: string;
    readonly resource: FhirResource;
    readonly search: { readonly mode: "match" };
  }[];
};

export type SearchParamType = "token" | "reference" | "date";

export type CapabilityStatement = {
  readonly resourceType: "CapabilityStatement";
  readonly status: "active";
  readonly date: string;
  readonly kind: "instance";
  readonly software: { readonly name: string };
  readonly implementation: { readonly description: string };
  readonly fhirVersion: string;
  readonly format: readonly string[];
  readonly rest: readonly {
    readonly mode: "server";
    readonly security: { readonly description: string };
    readonly resource: readonly {
      readonly type: ResourceType;
      readonly interaction: readonly { readonly code: "read" | "search-type" }[];
      readonly searchParam: readonly { readonly name: string; readonly type: SearchParamType }[];
    }[];
  }[];
};
```

- [ ] **Step 7: Puertos de lectura**

Crea `backend/src/modules/fhir/domain/ports/sources.ts`:

```ts
import type { OffsetPage, OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { AppointmentStatusCode, DocumentCode, SlotStatusKey } from "../profiles";
import type { FhirIdentifier } from "../resources/types";

/**
 * Lo que `fhir` necesita leer, con la forma minima de cada registro. El composition
 * root cumple estos puertos con `scheduling` y `patients`; `fhir` no los importa.
 */

export type PatientRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly documentType: DocumentCode;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly status: "active" | "pre_registered";
};

export type PractitionerRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type HealthcareServiceRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type ScheduleRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly active: boolean;
};

export type SlotRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: SlotStatusKey;
};

export type AppointmentRecord = {
  readonly id: string;
  readonly identifier: FhirIdentifier;
  readonly medicalRecordId: string;
  readonly slotId: string;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: AppointmentStatusCode;
};

/** Cota sobre el inicio de un cupo o cita. Varias cotas se combinan con AND. */
export type DateBound = { readonly op: "ge" | "gt" | "le" | "lt"; readonly at: Date };

export type MasterQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly active: boolean | null;
};

export type ScheduleQuery = MasterQuery & {
  readonly practitionerId: string | null;
  readonly healthcareServiceId: string | null;
};

export type SlotQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly scheduleId: string | null;
  readonly status: SlotStatusKey | null;
  readonly start: readonly DateBound[];
};

export type AppointmentQuery = OffsetWindow & {
  readonly identifier: FhirIdentifier | null;
  readonly medicalRecordId: string | null;
  readonly slotId: string | null;
  readonly status: AppointmentStatusCode | null;
  readonly start: readonly DateBound[];
};

export type PatientQuery = OffsetWindow & {
  /** Identificador Hermes. Excluyente con `document`. */
  readonly identifier: FhirIdentifier | null;
  readonly document: { readonly type: DocumentCode; readonly number: string } | null;
  readonly preRegistered: boolean | null;
};

export type FhirSource<R, Q> = {
  /** `null` si no existe en el tenant. */
  read(tenantId: TenantId, id: string): Promise<R | null>;
  search(tenantId: TenantId, query: Q): Promise<OffsetPage<R>>;
};

export type FhirSources = {
  readonly Patient: FhirSource<PatientRecord, PatientQuery>;
  readonly Practitioner: FhirSource<PractitionerRecord, MasterQuery>;
  readonly HealthcareService: FhirSource<HealthcareServiceRecord, MasterQuery>;
  readonly Schedule: FhirSource<ScheduleRecord, ScheduleQuery>;
  readonly Slot: FhirSource<SlotRecord, SlotQuery>;
  readonly Appointment: FhirSource<AppointmentRecord, AppointmentQuery>;
};
```

- [ ] **Step 8: Los seis mappers**

Cada mapper copia los campos uno a uno: el registro que llega en tiempo de ejecución trae campos internos (`tenantId`) que no deben salir.

`backend/src/modules/fhir/domain/mappers/patient.ts`:

```ts
import type { PatientRecord } from "../ports/sources";
import { documentSystem, PRE_REGISTERED_TAG } from "../profiles";
import type { FhirPatient } from "../resources/types";

function telecomOf(record: PatientRecord): FhirPatient["telecom"] {
  const telecom = [
    ...(record.phone ? [{ system: "phone" as const, value: record.phone }] : []),
    ...(record.email ? [{ system: "email" as const, value: record.email }] : []),
  ];
  return telecom.length > 0 ? telecom : undefined;
}

export function toPatient(record: PatientRecord): FhirPatient {
  const telecom = telecomOf(record);
  return {
    resourceType: "Patient",
    id: record.id,
    ...(record.status === "pre_registered" ? { meta: { tag: [PRE_REGISTERED_TAG] } } : {}),
    identifier: [
      { system: record.identifier.system, value: record.identifier.value },
      { system: documentSystem(record.documentType), value: record.documentNumber },
    ],
    active: true,
    name: [
      { family: record.familyNames, given: record.givenNames.split(/\s+/).filter(Boolean) },
    ],
    birthDate: record.birthDate,
    ...(telecom ? { telecom } : {}),
  };
}
```

`backend/src/modules/fhir/domain/mappers/practitioner.ts`:

```ts
import type { PractitionerRecord } from "../ports/sources";
import type { FhirPractitioner } from "../resources/types";

export function toPractitioner(record: PractitionerRecord): FhirPractitioner {
  return {
    resourceType: "Practitioner",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    active: record.active,
    name: [{ text: record.name }],
  };
}
```

`backend/src/modules/fhir/domain/mappers/healthcare-service.ts`:

```ts
import type { HealthcareServiceRecord } from "../ports/sources";
import type { FhirHealthcareService } from "../resources/types";

export function toHealthcareService(record: HealthcareServiceRecord): FhirHealthcareService {
  return {
    resourceType: "HealthcareService",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    active: record.active,
    name: record.name,
  };
}
```

`backend/src/modules/fhir/domain/mappers/schedule.ts`:

```ts
import type { ScheduleRecord } from "../ports/sources";
import { reference } from "../profiles";
import type { FhirSchedule } from "../resources/types";

export function toSchedule(record: ScheduleRecord): FhirSchedule {
  return {
    resourceType: "Schedule",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    active: record.active,
    actor: [
      reference("Practitioner", record.practitionerId),
      reference("HealthcareService", record.healthcareServiceId),
    ],
  };
}
```

`backend/src/modules/fhir/domain/mappers/slot.ts`:

```ts
import type { SlotRecord } from "../ports/sources";
import { reference, SLOT_STATUS } from "../profiles";
import type { FhirSlot } from "../resources/types";

export function toSlot(record: SlotRecord): FhirSlot {
  return {
    resourceType: "Slot",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    schedule: reference("Schedule", record.scheduleId),
    status: SLOT_STATUS[record.status],
    start: record.startAt.toISOString(),
    end: record.endAt.toISOString(),
  };
}
```

`backend/src/modules/fhir/domain/mappers/appointment.ts`:

```ts
import type { AppointmentRecord } from "../ports/sources";
import { reference } from "../profiles";
import type { FhirAppointment } from "../resources/types";

export function toAppointment(record: AppointmentRecord): FhirAppointment {
  return {
    resourceType: "Appointment",
    id: record.id,
    identifier: [{ system: record.identifier.system, value: record.identifier.value }],
    status: record.status,
    start: record.startAt.toISOString(),
    end: record.endAt.toISOString(),
    slot: [reference("Slot", record.slotId)],
    participant: [
      { actor: reference("Patient", record.medicalRecordId), status: "accepted" },
      { actor: reference("Practitioner", record.practitionerId), status: "accepted" },
      { actor: reference("HealthcareService", record.healthcareServiceId), status: "accepted" },
    ],
  };
}
```

- [ ] **Step 9: Correr el test de mapeo**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fhir/mapeo.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 10: Regla de fronteras para `fhir`**

En `backend/tests/fronteras.test.ts`, dentro del `describe("fronteras de capas", …)` y después del último `it`, añade:

```ts

  it("fhir solo importa shared y auth, y ningun modulo importa fhir", () => {
    const allowed = new Set(["fhir", "shared", "auth"]);
    const outgoing = listFiles(join(MODULES_DIR, "fhir")).flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({ specifier, module: /modules\/([^/]+)/.exec(specifier)?.[1] }))
        .filter(({ module }) => module !== undefined && !allowed.has(module))
        .map(({ specifier }) => `${file} -> ${specifier}`),
    );
    const incoming = readdirSync(MODULES_DIR)
      .filter((entry) => entry !== "fhir" && statSync(join(MODULES_DIR, entry)).isDirectory())
      .flatMap((mod) => listFiles(join(MODULES_DIR, mod)))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => /(^|\/)modules\/fhir(\/|$)/.test(specifier))
          .map((specifier) => `${file} -> ${specifier}`),
      );

    expect(listFiles(join(MODULES_DIR, "fhir")).length).toBeGreaterThan(0);
    expect([...outgoing, ...incoming]).toEqual([]);
  });
```

- [ ] **Step 11: Fronteras, typecheck y lint**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fronteras.test.ts`
Expected: PASS, 8 tests.

Run: `npm --prefix backend run typecheck`
Expected: sin errores.

Run: `npm --prefix backend run lint`
Expected: sin errores en `src/modules/fhir`, `tests/fhir` ni `tests/fronteras.test.ts`.

- [ ] **Step 12: Commit**

```bash
git add backend/src/modules/shared/domain/pagination.ts backend/src/modules/fhir backend/tests/fhir/mapeo.test.ts backend/tests/fronteras.test.ts docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md
git commit -m "feat(fhir): perfiles, tipos R4, puertos de lectura y mappers"
```

---

### Task 2: Errores FHIR y parseo de búsqueda

**Files:**
- Create: `backend/src/modules/fhir/domain/fhir-error.ts`
- Create: `backend/src/modules/fhir/domain/operation-outcome.ts`
- Create: `backend/src/modules/fhir/domain/search.ts`
- Test: `backend/tests/fhir/busqueda.test.ts`

**Interfaces:**
- Consumes: `IssueCode`, `OperationOutcome`, `FhirIdentifier` de `resources/types.ts`; `ResourceType` de `profiles.ts`; `DateBound` de `ports/sources.ts`; `OffsetWindow`, `DEFAULT_PAGE_LIMIT`, `MAX_PAGE_LIMIT` de `shared/domain/pagination.ts`; `startOfDayInZone(date: string, timeZone: string): Date` de `shared/domain/date-range.ts`.
- Produces:
  - `class FhirError extends Error { status: number; code: IssueCode }` y las fábricas `fhirLogin()`, `fhirForbidden()`, `fhirNotFound()`, `fhirInvalid(message)`, `fhirNotSupported(message)`, `fhirMethodNotAllowed()`, `fhirException()`.
  - `operationOutcome(code: IssueCode, diagnostics: string): OperationOutcome`.
  - De `search.ts`: `type SearchParams = ReadonlyMap<string, readonly string[]>`, `collectParams(entries): SearchParams`, `assertSupported(params, supported: readonly string[]): void`, `single(params, name): string | null`, `parseToken(name, raw): FhirIdentifier`, `parseReference(name, raw, types: readonly ResourceType[]): { type: ResourceType; id: string }`, `parseBoolean(name, raw): boolean`, `parseCode<T extends string>(name, raw, allowed: readonly T[]): T`, `parseWindow(params): OffsetWindow`, `parseDateBounds(name, values: readonly string[], timeZone): DateBound[]`.

- [ ] **Step 1: Escribir el test (falla)**

Crea `backend/tests/fhir/busqueda.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import { operationOutcome } from "@/modules/fhir/domain/operation-outcome";
import {
  assertSupported,
  collectParams,
  parseBoolean,
  parseCode,
  parseDateBounds,
  parseReference,
  parseToken,
  parseWindow,
  single,
} from "@/modules/fhir/domain/search";

const ZONE = "America/Bogota";

function params(query: string) {
  return collectParams(new URLSearchParams(query).entries());
}

function failure(run: () => unknown): { status: number; code: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof FhirError) {
      return { status: error.status, code: error.code };
    }
    throw error;
  }
  throw new Error("deberia haber fallado");
}

const INVALID = { status: 400, code: "invalid" };

describe("fhir-conformance: OperationOutcome", () => {
  it("lleva un issue de severidad error", () => {
    expect(operationOutcome("not-found", "Recurso inexistente")).toEqual({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "not-found", diagnostics: "Recurso inexistente" }],
    });
  });
});

describe("fhir-conformance: parametros soportados", () => {
  it("admite los declarados y los de control", () => {
    expect(() => assertSupported(params("active=true&_count=5&_offset=0"), ["active"])).not.toThrow();
  });

  it("rechaza uno no declarado con not-supported", () => {
    expect(failure(() => assertSupported(params("name=ana"), ["active"]))).toEqual({
      status: 400,
      code: "not-supported",
    });
  });

  it("un modificador es un parametro no soportado", () => {
    expect(failure(() => assertSupported(params("active:not=true"), ["active"])).code).toBe(
      "not-supported",
    );
  });
});

describe("fhir-conformance: valores unicos", () => {
  it("devuelve null si el parametro no viene", () => {
    expect(single(params(""), "status")).toBeNull();
  });

  it("repetido o vacio es invalid", () => {
    expect(failure(() => single(params("status=free&status=busy"), "status"))).toEqual(INVALID);
    expect(failure(() => single(params("identifier="), "identifier"))).toEqual(INVALID);
  });
});

describe("fhir-conformance: token, referencia, booleano y codigo", () => {
  it("token exige system y value", () => {
    expect(parseToken("identifier", "urn:hermes:patient|MR-1")).toEqual({
      system: "urn:hermes:patient",
      value: "MR-1",
    });
    expect(parseToken("identifier", "urn:x|a|b").value).toBe("a|b");
    for (const raw of ["MR-1", "|MR-1", "urn:x|"]) {
      expect(failure(() => parseToken("identifier", raw))).toEqual(INVALID);
    }
  });

  it("referencia exige un tipo admitido y un id", () => {
    expect(parseReference("schedule", "Schedule/s-1", ["Schedule"])).toEqual({
      type: "Schedule",
      id: "s-1",
    });
    for (const raw of ["s-1", "Slot/s-1", "Schedule/", "Schedule/a/b"]) {
      expect(failure(() => parseReference("schedule", raw, ["Schedule"]))).toEqual(INVALID);
    }
  });

  it("booleano y codigo validan su valor", () => {
    expect(parseBoolean("active", "false")).toBe(false);
    expect(failure(() => parseBoolean("active", "si"))).toEqual(INVALID);
    expect(parseCode("status", "booked", ["booked", "cancelled"])).toBe("booked");
    expect(failure(() => parseCode("status", "free,busy", ["free", "busy"]))).toEqual(INVALID);
  });
});

describe("fhir-conformance: _count y _offset", () => {
  it("aplica los predeterminados", () => {
    expect(parseWindow(params(""))).toEqual({ offset: 0, limit: 50 });
  });

  it("recorta _count al maximo, tambien un valor desmedido", () => {
    expect(parseWindow(params("_count=500")).limit).toBe(200);
    expect(parseWindow(params("_count=99999999999999999999")).limit).toBe(200);
  });

  it("rechaza _count no entero o menor que 1", () => {
    for (const raw of ["0", "-1", "1.5", "abc"]) {
      expect(failure(() => parseWindow(params(`_count=${raw}`)))).toEqual(INVALID);
    }
  });

  it("rechaza _offset negativo, no entero o desmedido", () => {
    for (const raw of ["-1", "2.5", "abc", "99999999999999999999", "2147483648"]) {
      expect(failure(() => parseWindow(params(`_offset=${raw}`)))).toEqual(INVALID);
    }
    expect(parseWindow(params("_offset=2147483647")).offset).toBe(2147483647);
  });
});

describe("fhir-conformance: fechas", () => {
  const day = new Date("2026-06-15T05:00:00.000Z");
  const nextDay = new Date("2026-06-16T05:00:00.000Z");

  it("una fecha sin hora es el dia en la zona de la aplicacion", () => {
    expect(parseDateBounds("start", ["2026-06-15"], ZONE)).toEqual([
      { op: "ge", at: day },
      { op: "lt", at: nextDay },
    ]);
    expect(parseDateBounds("start", ["eq2026-06-15"], ZONE)).toHaveLength(2);
    expect(parseDateBounds("start", ["ge2026-06-15"], ZONE)).toEqual([{ op: "ge", at: day }]);
    expect(parseDateBounds("start", ["gt2026-06-15"], ZONE)).toEqual([{ op: "ge", at: nextDay }]);
    expect(parseDateBounds("start", ["le2026-06-15"], ZONE)).toEqual([{ op: "lt", at: nextDay }]);
    expect(parseDateBounds("start", ["lt2026-06-15"], ZONE)).toEqual([{ op: "lt", at: day }]);
  });

  it("un instante con offset se usa tal cual", () => {
    const at = new Date("2026-06-15T14:00:00.000Z");
    expect(parseDateBounds("start", ["ge2026-06-15T09:00:00-05:00"], ZONE)).toEqual([
      { op: "ge", at },
    ]);
    expect(parseDateBounds("start", ["2026-06-15T14:00:00Z"], ZONE)).toEqual([
      { op: "ge", at },
      { op: "le", at },
    ]);
  });

  it("varias cotas forman un rango", () => {
    expect(parseDateBounds("start", ["ge2026-06-15", "lt2026-06-16"], ZONE)).toEqual([
      { op: "ge", at: day },
      { op: "lt", at: nextDay },
    ]);
  });

  it("acepta el + del offset aunque llegue como espacio", () => {
    const decoded = new URLSearchParams("start=ge2026-06-15T14:00:00+00:00").getAll("start");
    expect(decoded).toEqual(["ge2026-06-15T14:00:00 00:00"]);
    expect(parseDateBounds("start", decoded, ZONE)).toEqual([
      { op: "ge", at: new Date("2026-06-15T14:00:00.000Z") },
    ]);
  });

  it("rechaza fechas imposibles, sin offset o mal formadas", () => {
    for (const raw of ["2026-02-31", "2026-06-15T09:00:00", "ayer", "ge", "xx2026-06-15", ""]) {
      expect(failure(() => parseDateBounds("start", [raw], ZONE))).toEqual(INVALID);
    }
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fhir/busqueda.test.ts`
Expected: FAIL, no resuelve `@/modules/fhir/domain/fhir-error`.

- [ ] **Step 3: `fhir-error.ts`**

Crea `backend/src/modules/fhir/domain/fhir-error.ts`:

```ts
import type { IssueCode } from "./resources/types";

/** Error de la superficie FHIR. El adaptador HTTP lo traduce a un `OperationOutcome`. */
export class FhirError extends Error {
  readonly status: number;
  readonly code: IssueCode;

  constructor(status: number, code: IssueCode, message: string) {
    super(message);
    this.name = "FhirError";
    this.status = status;
    this.code = code;
  }
}

/** Mensaje fijo: decir por que fallo el token ya es informacion. */
export function fhirLogin(): FhirError {
  return new FhirError(401, "login", "Credenciales ausentes o invalidas");
}

export function fhirForbidden(): FhirError {
  return new FhirError(403, "forbidden", "El rol no admite esta operacion");
}

export function fhirNotFound(): FhirError {
  return new FhirError(404, "not-found", "Recurso inexistente");
}

export function fhirInvalid(message: string): FhirError {
  return new FhirError(400, "invalid", message);
}

export function fhirNotSupported(message: string): FhirError {
  return new FhirError(400, "not-supported", message);
}

export function fhirMethodNotAllowed(): FhirError {
  return new FhirError(405, "not-supported", "Interaccion no soportada sobre este recurso");
}

export function fhirException(): FhirError {
  return new FhirError(500, "exception", "Error interno");
}
```

- [ ] **Step 4: `operation-outcome.ts`**

Crea `backend/src/modules/fhir/domain/operation-outcome.ts`:

```ts
import type { IssueCode, OperationOutcome } from "./resources/types";

export function operationOutcome(code: IssueCode, diagnostics: string): OperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  };
}
```

- [ ] **Step 5: `search.ts`**

Crea `backend/src/modules/fhir/domain/search.ts`:

```ts
import { startOfDayInZone } from "@/modules/shared/domain/date-range";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type OffsetWindow,
} from "@/modules/shared/domain/pagination";
import { fhirInvalid, fhirNotSupported } from "./fhir-error";
import type { DateBound } from "./ports/sources";
import type { ResourceType } from "./profiles";
import type { FhirIdentifier } from "./resources/types";

/** Parametros de busqueda tal como llegan: nombre -> valores en orden. */
export type SearchParams = ReadonlyMap<string, readonly string[]>;

const CONTROL_PARAMS: readonly string[] = ["_count", "_offset"];

export function collectParams(entries: Iterable<readonly [string, string]>): SearchParams {
  const collected = new Map<string, string[]>();
  for (const [name, value] of entries) {
    collected.set(name, [...(collected.get(name) ?? []), value]);
  }
  return collected;
}

/** Un parametro que el recurso no declara no se ignora: responde `not-supported`. */
export function assertSupported(params: SearchParams, supported: readonly string[]): void {
  for (const name of params.keys()) {
    if (!supported.includes(name) && !CONTROL_PARAMS.includes(name)) {
      throw fhirNotSupported(`Parametro de busqueda no soportado: ${name}`);
    }
  }
}

/** Valor unico de un parametro. Repetido o vacio -> `invalid`. */
export function single(params: SearchParams, name: string): string | null {
  const values = params.get(name);
  if (!values) {
    return null;
  }
  const [value] = values;
  if (values.length !== 1 || value === undefined || value === "") {
    throw fhirInvalid(`${name} admite un solo valor no vacio`);
  }
  return value;
}

export function parseToken(name: string, raw: string): FhirIdentifier {
  const at = raw.indexOf("|");
  const system = at < 0 ? "" : raw.slice(0, at);
  const value = at < 0 ? "" : raw.slice(at + 1);
  if (system === "" || value === "") {
    throw fhirInvalid(`${name} debe tener la forma system|value`);
  }
  return { system, value };
}

export function parseReference(
  name: string,
  raw: string,
  types: readonly ResourceType[],
): { readonly type: ResourceType; readonly id: string } {
  const [type, id, ...rest] = raw.split("/");
  const known = types.find((candidate) => candidate === type);
  if (!known || !id || rest.length > 0) {
    const shapes = types.map((candidate) => `${candidate}/{id}`).join(" o ");
    throw fhirInvalid(`${name} debe ser una referencia ${shapes}`);
  }
  return { type: known, id };
}

export function parseBoolean(name: string, raw: string): boolean {
  if (raw !== "true" && raw !== "false") {
    throw fhirInvalid(`${name} debe ser true o false`);
  }
  return raw === "true";
}

export function parseCode<T extends string>(name: string, raw: string, allowed: readonly T[]): T {
  const code = allowed.find((candidate) => candidate === raw);
  if (code === undefined) {
    throw fhirInvalid(`${name} debe ser uno de: ${allowed.join(", ")}`);
  }
  return code;
}

const INTEGER = /^\d+$/;
/** Tope de `skip` en Prisma (entero de 32 bits). */
const MAX_OFFSET = 2_147_483_647;

export function parseWindow(params: SearchParams): OffsetWindow {
  const count = single(params, "_count");
  const offset = single(params, "_offset");
  if (count !== null && (!INTEGER.test(count) || Number(count) < 1)) {
    throw fhirInvalid("_count debe ser un entero mayor o igual a 1");
  }
  if (offset !== null && (!INTEGER.test(offset) || Number(offset) > MAX_OFFSET)) {
    throw fhirInvalid(`_offset debe ser un entero entre 0 y ${MAX_OFFSET}`);
  }
  return {
    offset: offset === null ? 0 : Number(offset),
    limit: count === null ? DEFAULT_PAGE_LIMIT : Math.min(Number(count), MAX_PAGE_LIMIT),
  };
}

type Prefix = "eq" | "ge" | "gt" | "le" | "lt";

const PREFIXED = /^(eq|ge|gt|le|lt)?(.*)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** `2026-02-31` no existe: `Date` lo desbordaria a marzo sin avisar. */
function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function dayBounds(prefix: Prefix, date: string, timeZone: string): DateBound[] {
  const start = startOfDayInZone(date, timeZone);
  const end = startOfDayInZone(nextDay(date), timeZone);
  switch (prefix) {
    case "eq":
      return [
        { op: "ge", at: start },
        { op: "lt", at: end },
      ];
    case "ge":
      return [{ op: "ge", at: start }];
    case "gt":
      return [{ op: "ge", at: end }];
    case "le":
      return [{ op: "lt", at: end }];
    case "lt":
      return [{ op: "lt", at: start }];
  }
}

function instantBounds(prefix: Prefix, at: Date): DateBound[] {
  if (prefix === "eq") {
    return [
      { op: "ge", at },
      { op: "le", at },
    ];
  }
  return [{ op: prefix, at }];
}

function boundsOf(name: string, raw: string, timeZone: string): DateBound[] {
  const invalid = fhirInvalid(
    `${name} debe ser una fecha (YYYY-MM-DD) o un instante con offset, con prefijo opcional eq, ge, gt, le o lt`,
  );
  const match = PREFIXED.exec(raw);
  const prefix: Prefix = (match?.[1] as Prefix | undefined) ?? "eq";
  // Un `+` sin codificar en la URL llega como espacio antes del offset.
  const value = (match?.[2] ?? "").replace(/ (\d{2}:\d{2})$/, "+$1");
  if (DATE_ONLY.test(value)) {
    if (!isRealDate(value)) {
      throw invalid;
    }
    return dayBounds(prefix, value, timeZone);
  }
  const at = INSTANT.test(value) ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) {
    throw invalid;
  }
  return instantBounds(prefix, at);
}

/** Cotas de un parametro `date`; puede repetirse para formar un rango. */
export function parseDateBounds(
  name: string,
  values: readonly string[],
  timeZone: string,
): DateBound[] {
  return values.flatMap((raw) => boundsOf(name, raw, timeZone));
}
```

- [ ] **Step 6: Correr el test**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fhir/busqueda.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 7: Typecheck, lint y fronteras**

Run: `npm --prefix backend run typecheck`
Expected: sin errores.

Run: `npm --prefix backend run lint`
Expected: sin errores en `src/modules/fhir` ni `tests/fhir`.

Run: `npm --prefix backend exec -- vitest run --project unit tests/fronteras.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/fhir/domain/fhir-error.ts backend/src/modules/fhir/domain/operation-outcome.ts backend/src/modules/fhir/domain/search.ts backend/tests/fhir/busqueda.test.ts
git commit -m "feat(fhir): errores OperationOutcome y parseo de busqueda"
```

---

### Task 3: Registro, Bundle, CapabilityStatement y casos de uso

**Files:**
- Create: `backend/src/modules/fhir/domain/registry.ts`
- Create: `backend/src/modules/fhir/domain/bundle.ts`
- Create: `backend/src/modules/fhir/domain/capability-statement.ts`
- Create: `backend/src/modules/fhir/application/resource-handlers.ts`
- Create: `backend/src/modules/fhir/application/read-resource.ts`
- Create: `backend/src/modules/fhir/application/search-resources.ts`
- Create: `backend/src/modules/fhir/application/get-capability-statement.ts`
- Test: `backend/tests/fhir/registro.test.ts`

**Interfaces:**
- Consumes: todo lo de las Tareas 1 y 2.
- Produces:
  - De `registry.ts`: `type SearchParamDef = { name: string; type: SearchParamType }`, `type SearchContext = { params: SearchParams; timeZone: string }`, `type ResourceDefinition<R, Q> = { type: ResourceType; searchParams: readonly SearchParamDef[]; buildQuery(context: SearchContext): Q; toResource(record: R): FhirResource }`, `DEFINITIONS` (objeto con una definición por `ResourceType`), `type DeclaredResource = { type: ResourceType; searchParams: readonly SearchParamDef[] }`, `DECLARED_RESOURCES: readonly DeclaredResource[]`.
  - De `bundle.ts`: `searchBundle(input: { baseUrl: string; type: ResourceType; filters: readonly (readonly [string, string])[]; resources: readonly FhirResource[]; total: number; offset: number; limit: number }): FhirBundle`.
  - De `capability-statement.ts`: `capabilityStatement(resources: readonly DeclaredResource[]): CapabilityStatement`.
  - De `application/resource-handlers.ts`: `type SearchResult = OffsetWindow & { resources: readonly FhirResource[]; total: number }`, `type ResourceHandler`, `type ResourceHandlers = Readonly<Record<ResourceType, ResourceHandler>>`, `createResourceHandlers(sources: FhirSources): ResourceHandlers`.
  - `type ReadResource = (tenantId: TenantId, type: string, id: string) => Promise<FhirResource>` y `createReadResource(handlers): ReadResource`.
  - `type SearchResourcesInput = { tenantId: TenantId; type: string; entries: readonly (readonly [string, string])[]; baseUrl: string }`, `type SearchResources = (input: SearchResourcesInput) => Promise<FhirBundle>` y `createSearchResources(handlers, timeZone: string): SearchResources`.
  - `type GetCapabilityStatement = () => CapabilityStatement` y `createGetCapabilityStatement(): GetCapabilityStatement`.

- [ ] **Step 1: Escribir el test (falla)**

Crea `backend/tests/fhir/registro.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createGetCapabilityStatement } from "@/modules/fhir/application/get-capability-statement";
import { createReadResource } from "@/modules/fhir/application/read-resource";
import { createResourceHandlers } from "@/modules/fhir/application/resource-handlers";
import { createSearchResources } from "@/modules/fhir/application/search-resources";
import { searchBundle } from "@/modules/fhir/domain/bundle";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import type {
  AppointmentQuery,
  FhirSource,
  FhirSources,
  MasterQuery,
  PatientQuery,
  ScheduleQuery,
  SlotQuery,
  SlotRecord,
} from "@/modules/fhir/domain/ports/sources";
import { RESOURCE_TYPES } from "@/modules/fhir/domain/profiles";
import { DECLARED_RESOURCES } from "@/modules/fhir/domain/registry";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const TENANT = toTenantId("tenant-a");
const BASE = "https://api.test/fhir";

const slot: SlotRecord = {
  id: "sl-1",
  identifier: { system: "urn:hermes:slot", value: "SL-1" },
  scheduleId: "sch-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "free",
};

type Seen = {
  patient: PatientQuery[];
  master: MasterQuery[];
  schedule: ScheduleQuery[];
  slot: SlotQuery[];
  appointment: AppointmentQuery[];
};

function source<R extends { id: string }, Q>(rows: R[], seen: Q[], total = rows.length): FhirSource<R, Q> {
  return {
    read: async (_tenantId, id) => rows.find((row) => row.id === id) ?? null,
    search: async (_tenantId, query) => {
      seen.push(query);
      return { data: rows, total };
    },
  };
}

function world(slotTotal = 1) {
  const seen: Seen = { patient: [], master: [], schedule: [], slot: [], appointment: [] };
  const sources: FhirSources = {
    Patient: source([], seen.patient),
    Practitioner: source([], seen.master),
    HealthcareService: source([], seen.master),
    Schedule: source([], seen.schedule),
    Slot: source([slot], seen.slot, slotTotal),
    Appointment: source([], seen.appointment),
  };
  const handlers = createResourceHandlers(sources);
  return {
    seen,
    read: createReadResource(handlers),
    search: createSearchResources(handlers, "America/Bogota"),
  };
}

function entries(query: string): [string, string][] {
  return [...new URLSearchParams(query).entries()];
}

async function failure(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FhirError) {
      return { status: error.status, code: error.code };
    }
    throw error;
  }
  throw new Error("deberia haber fallado");
}

describe("fhir-conformance: read", () => {
  it("devuelve el recurso mapeado", async () => {
    const resource = await world().read(TENANT, "Slot", "sl-1");
    expect(resource).toMatchObject({ resourceType: "Slot", id: "sl-1", status: "free" });
  });

  it("id inexistente y tipo desconocido son not-found", async () => {
    const { read } = world();
    expect(await failure(() => read(TENANT, "Slot", "otro"))).toEqual({
      status: 404,
      code: "not-found",
    });
    expect(await failure(() => read(TENANT, "Task", "sl-1"))).toEqual({
      status: 404,
      code: "not-found",
    });
  });
});

describe("fhir-conformance: search arma la consulta del puerto", () => {
  it("Slot: referencia, estado, cotas y ventana", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Slot",
      entries: entries("schedule=Schedule/sch-1&status=busy-tentative&start=ge2026-06-15&_count=10"),
      baseUrl: BASE,
    });
    expect(seen.slot).toEqual([
      {
        identifier: null,
        scheduleId: "sch-1",
        status: "busy_tentative",
        start: [{ op: "ge", at: new Date("2026-06-15T05:00:00.000Z") }],
        offset: 0,
        limit: 10,
      },
    ]);
  });

  it("Patient: un system de documento busca por documento", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Patient",
      entries: entries(`identifier=${encodeURIComponent("urn:ingenius:document:CC|1000")}`),
      baseUrl: BASE,
    });
    await search({
      tenantId: TENANT,
      type: "Patient",
      entries: entries(
        `identifier=${encodeURIComponent("urn:hermes:patient|MR-1")}&_tag=${encodeURIComponent("urn:ingenius:patient-tag|pre-registered")}`,
      ),
      baseUrl: BASE,
    });
    expect(seen.patient).toEqual([
      {
        identifier: null,
        document: { type: "CC", number: "1000" },
        preRegistered: null,
        offset: 0,
        limit: 50,
      },
      {
        identifier: { system: "urn:hermes:patient", value: "MR-1" },
        document: null,
        preRegistered: true,
        offset: 0,
        limit: 50,
      },
    ]);
  });

  it("Schedule: actor acepta profesional o servicio", async () => {
    const { search, seen } = world();
    await search({ tenantId: TENANT, type: "Schedule", entries: entries("actor=Practitioner/p-1"), baseUrl: BASE });
    await search({
      tenantId: TENANT,
      type: "Schedule",
      entries: entries("actor=HealthcareService/s-1&active=true"),
      baseUrl: BASE,
    });
    expect(seen.schedule.map((query) => [query.practitionerId, query.healthcareServiceId, query.active])).toEqual([
      ["p-1", null, null],
      [null, "s-1", true],
    ]);
  });

  it("Appointment: paciente, cupo, estado y fecha", async () => {
    const { search, seen } = world();
    await search({
      tenantId: TENANT,
      type: "Appointment",
      entries: entries("patient=Patient/mr-1&slot=Slot/sl-1&status=booked&date=lt2026-06-16"),
      baseUrl: BASE,
    });
    expect(seen.appointment[0]).toMatchObject({
      medicalRecordId: "mr-1",
      slotId: "sl-1",
      status: "booked",
      start: [{ op: "lt", at: new Date("2026-06-16T05:00:00.000Z") }],
    });
  });

  it("rechaza parametros no declarados, tags desconocidos y tipos desconocidos", async () => {
    const { search } = world();
    const run = (type: string, query: string) => () =>
      search({ tenantId: TENANT, type, entries: entries(query), baseUrl: BASE });
    expect(await failure(run("Slot", "patient=Patient/x"))).toEqual({ status: 400, code: "not-supported" });
    expect(await failure(run("Patient", `_tag=${encodeURIComponent("urn:x|otro")}`))).toEqual({
      status: 400,
      code: "invalid",
    });
    expect(await failure(run("Slot", "status=ocupado"))).toEqual({ status: 400, code: "invalid" });
    expect(await failure(run("Task", ""))).toEqual({ status: 404, code: "not-found" });
  });
});

describe("fhir-conformance: Bundle", () => {
  it("es un searchset con total, fullUrl y enlace self", async () => {
    const bundle = await world().search({ tenantId: TENANT, type: "Slot", entries: [], baseUrl: BASE });
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "searchset", total: 1 });
    expect(bundle.entry).toEqual([
      {
        fullUrl: `${BASE}/Slot/sl-1`,
        resource: expect.objectContaining({ id: "sl-1" }),
        search: { mode: "match" },
      },
    ]);
    expect(bundle.link).toEqual([{ relation: "self", url: `${BASE}/Slot?_count=50&_offset=0` }]);
  });

  it("next y previous conservan los filtros y mueven el desplazamiento", () => {
    const bundle = searchBundle({
      baseUrl: BASE,
      type: "Slot",
      filters: [
        ["status", "free"],
        ["_count", "2"],
        ["_offset", "2"],
        ["start", "ge2026-06-15"],
      ],
      resources: [],
      total: 5,
      offset: 2,
      limit: 2,
    });
    expect(bundle.link).toEqual([
      { relation: "self", url: `${BASE}/Slot?status=free&start=ge2026-06-15&_count=2&_offset=2` },
      { relation: "next", url: `${BASE}/Slot?status=free&start=ge2026-06-15&_count=2&_offset=4` },
      { relation: "previous", url: `${BASE}/Slot?status=free&start=ge2026-06-15&_count=2&_offset=0` },
    ]);
  });

  it("en la ultima pagina no hay next y previous no baja de cero", () => {
    const bundle = searchBundle({
      baseUrl: BASE,
      type: "Slot",
      filters: [],
      resources: [],
      total: 3,
      offset: 1,
      limit: 2,
    });
    expect(bundle.link.map((link) => link.relation)).toEqual(["self", "previous"]);
    expect(bundle.link[1]?.url).toBe(`${BASE}/Slot?_count=2&_offset=0`);
  });
});

describe("fhir-conformance: CapabilityStatement", () => {
  const statement = createGetCapabilityStatement()();

  it("declara R4, JSON y un servidor", () => {
    expect(statement).toMatchObject({
      resourceType: "CapabilityStatement",
      status: "active",
      kind: "instance",
      fhirVersion: "4.0.1",
      format: ["json"],
    });
    expect(statement.implementation.description).toEqual(expect.any(String));
    expect(statement.rest).toHaveLength(1);
    expect(statement.rest[0]?.mode).toBe("server");
  });

  it("declara exactamente los recursos y parametros del registro", () => {
    const declared = statement.rest[0]?.resource ?? [];
    expect(declared.map((resource) => resource.type)).toEqual([...RESOURCE_TYPES]);
    for (const resource of declared) {
      expect(resource.interaction).toEqual([{ code: "read" }, { code: "search-type" }]);
      const definition = DECLARED_RESOURCES.find((entry) => entry.type === resource.type);
      expect(resource.searchParam).toEqual(definition?.searchParams);
    }
  });

  it("los parametros por recurso son los de la spec", () => {
    const names = Object.fromEntries(
      DECLARED_RESOURCES.map((entry) => [entry.type, entry.searchParams.map((param) => param.name)]),
    );
    expect(names).toEqual({
      Patient: ["identifier", "_tag"],
      Practitioner: ["identifier", "active"],
      HealthcareService: ["identifier", "active"],
      Schedule: ["identifier", "actor", "active"],
      Slot: ["identifier", "schedule", "status", "start"],
      Appointment: ["identifier", "patient", "slot", "status", "date"],
    });
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fhir/registro.test.ts`
Expected: FAIL, no resuelve `@/modules/fhir/application/get-capability-statement`.

- [ ] **Step 3: `registry.ts`**

Crea `backend/src/modules/fhir/domain/registry.ts`:

```ts
import { fhirInvalid } from "./fhir-error";
import { toAppointment } from "./mappers/appointment";
import { toHealthcareService } from "./mappers/healthcare-service";
import { toPatient } from "./mappers/patient";
import { toPractitioner } from "./mappers/practitioner";
import { toSchedule } from "./mappers/schedule";
import { toSlot } from "./mappers/slot";
import type {
  AppointmentQuery,
  AppointmentRecord,
  HealthcareServiceRecord,
  MasterQuery,
  PatientQuery,
  PatientRecord,
  PractitionerRecord,
  ScheduleQuery,
  ScheduleRecord,
  SlotQuery,
  SlotRecord,
} from "./ports/sources";
import {
  APPOINTMENT_STATUSES,
  documentCodeOf,
  PRE_REGISTERED_TAG,
  type ResourceType,
  SLOT_STATUS,
  slotStatusKeyOf,
} from "./profiles";
import type { FhirIdentifier, FhirResource, SearchParamType } from "./resources/types";
import {
  parseBoolean,
  parseCode,
  parseDateBounds,
  parseReference,
  parseToken,
  parseWindow,
  type SearchParams,
  single,
} from "./search";

/**
 * Registro de recursos: la unica tabla que dice que se puede leer y buscar.
 * De aqui salen la validacion de parametros y el `CapabilityStatement`, asi
 * que `metadata` no puede declarar algo que no exista.
 */

export type SearchParamDef = { readonly name: string; readonly type: SearchParamType };

export type SearchContext = { readonly params: SearchParams; readonly timeZone: string };

export type ResourceDefinition<R, Q> = {
  readonly type: ResourceType;
  readonly searchParams: readonly SearchParamDef[];
  buildQuery(context: SearchContext): Q;
  toResource(record: R): FhirResource;
};

const IDENTIFIER: SearchParamDef = { name: "identifier", type: "token" };
const ACTIVE: SearchParamDef = { name: "active", type: "token" };

function identifierOf(params: SearchParams): FhirIdentifier | null {
  const raw = single(params, "identifier");
  return raw === null ? null : parseToken("identifier", raw);
}

function activeOf(params: SearchParams): boolean | null {
  const raw = single(params, "active");
  return raw === null ? null : parseBoolean("active", raw);
}

function referenceIdOf(params: SearchParams, name: string, type: ResourceType): string | null {
  const raw = single(params, name);
  return raw === null ? null : parseReference(name, raw, [type]).id;
}

function masterQuery({ params }: SearchContext): MasterQuery {
  return { identifier: identifierOf(params), active: activeOf(params), ...parseWindow(params) };
}

function preRegisteredOf(params: SearchParams): boolean | null {
  const raw = single(params, "_tag");
  if (raw === null) {
    return null;
  }
  const tag = parseToken("_tag", raw);
  if (tag.system !== PRE_REGISTERED_TAG.system || tag.value !== PRE_REGISTERED_TAG.code) {
    throw fhirInvalid("_tag desconocido");
  }
  return true;
}

const patient: ResourceDefinition<PatientRecord, PatientQuery> = {
  type: "Patient",
  searchParams: [IDENTIFIER, { name: "_tag", type: "token" }],
  buildQuery({ params }) {
    const token = identifierOf(params);
    const documentType = token ? documentCodeOf(token.system) : null;
    return {
      identifier: token && !documentType ? token : null,
      document: token && documentType ? { type: documentType, number: token.value } : null,
      preRegistered: preRegisteredOf(params),
      ...parseWindow(params),
    };
  },
  toResource: toPatient,
};

const practitioner: ResourceDefinition<PractitionerRecord, MasterQuery> = {
  type: "Practitioner",
  searchParams: [IDENTIFIER, ACTIVE],
  buildQuery: masterQuery,
  toResource: toPractitioner,
};

const healthcareService: ResourceDefinition<HealthcareServiceRecord, MasterQuery> = {
  type: "HealthcareService",
  searchParams: [IDENTIFIER, ACTIVE],
  buildQuery: masterQuery,
  toResource: toHealthcareService,
};

const schedule: ResourceDefinition<ScheduleRecord, ScheduleQuery> = {
  type: "Schedule",
  searchParams: [IDENTIFIER, { name: "actor", type: "reference" }, ACTIVE],
  buildQuery(context) {
    const raw = single(context.params, "actor");
    const actor =
      raw === null ? null : parseReference("actor", raw, ["Practitioner", "HealthcareService"]);
    return {
      ...masterQuery(context),
      practitionerId: actor?.type === "Practitioner" ? actor.id : null,
      healthcareServiceId: actor?.type === "HealthcareService" ? actor.id : null,
    };
  },
  toResource: toSchedule,
};

const slot: ResourceDefinition<SlotRecord, SlotQuery> = {
  type: "Slot",
  searchParams: [
    IDENTIFIER,
    { name: "schedule", type: "reference" },
    { name: "status", type: "token" },
    { name: "start", type: "date" },
  ],
  buildQuery({ params, timeZone }) {
    const raw = single(params, "status");
    const code = raw === null ? null : parseCode("status", raw, Object.values(SLOT_STATUS));
    return {
      identifier: identifierOf(params),
      scheduleId: referenceIdOf(params, "schedule", "Schedule"),
      status: code === null ? null : slotStatusKeyOf(code),
      start: parseDateBounds("start", params.get("start") ?? [], timeZone),
      ...parseWindow(params),
    };
  },
  toResource: toSlot,
};

const appointment: ResourceDefinition<AppointmentRecord, AppointmentQuery> = {
  type: "Appointment",
  searchParams: [
    IDENTIFIER,
    { name: "patient", type: "reference" },
    { name: "slot", type: "reference" },
    { name: "status", type: "token" },
    { name: "date", type: "date" },
  ],
  buildQuery({ params, timeZone }) {
    const raw = single(params, "status");
    return {
      identifier: identifierOf(params),
      medicalRecordId: referenceIdOf(params, "patient", "Patient"),
      slotId: referenceIdOf(params, "slot", "Slot"),
      status: raw === null ? null : parseCode("status", raw, APPOINTMENT_STATUSES),
      start: parseDateBounds("date", params.get("date") ?? [], timeZone),
      ...parseWindow(params),
    };
  },
  toResource: toAppointment,
};

export const DEFINITIONS = {
  Patient: patient,
  Practitioner: practitioner,
  HealthcareService: healthcareService,
  Schedule: schedule,
  Slot: slot,
  Appointment: appointment,
} as const;

export type DeclaredResource = {
  readonly type: ResourceType;
  readonly searchParams: readonly SearchParamDef[];
};

/** Lo que declara `metadata`, en el orden de `RESOURCE_TYPES`. */
export const DECLARED_RESOURCES: readonly DeclaredResource[] = Object.values(DEFINITIONS);
```

- [ ] **Step 4: `bundle.ts`**

Crea `backend/src/modules/fhir/domain/bundle.ts`:

```ts
import type { ResourceType } from "./profiles";
import type { BundleLink, FhirBundle, FhirResource } from "./resources/types";

export type SearchBundleInput = {
  /** Base absoluta de la superficie, sin barra final: `https://host/fhir`. */
  readonly baseUrl: string;
  readonly type: ResourceType;
  /** Parametros de la peticion original, en orden. */
  readonly filters: readonly (readonly [string, string])[];
  readonly resources: readonly FhirResource[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
};

const CONTROL_PARAMS: readonly string[] = ["_count", "_offset"];

function pageUrl(input: SearchBundleInput, offset: number): string {
  const query = new URLSearchParams();
  for (const [name, value] of input.filters) {
    if (!CONTROL_PARAMS.includes(name)) {
      query.append(name, value);
    }
  }
  query.set("_count", String(input.limit));
  query.set("_offset", String(offset));
  return `${input.baseUrl}/${input.type}?${query.toString()}`;
}

function linksOf(input: SearchBundleInput): BundleLink[] {
  const links: BundleLink[] = [{ relation: "self", url: pageUrl(input, input.offset) }];
  if (input.offset + input.limit < input.total) {
    links.push({ relation: "next", url: pageUrl(input, input.offset + input.limit) });
  }
  if (input.offset > 0) {
    links.push({
      relation: "previous",
      url: pageUrl(input, Math.max(0, input.offset - input.limit)),
    });
  }
  return links;
}

export function searchBundle(input: SearchBundleInput): FhirBundle {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: input.total,
    link: linksOf(input),
    entry: input.resources.map((resource) => ({
      fullUrl: `${input.baseUrl}/${input.type}/${resource.id}`,
      resource,
      search: { mode: "match" },
    })),
  };
}
```

- [ ] **Step 5: `capability-statement.ts`**

Crea `backend/src/modules/fhir/domain/capability-statement.ts`:

```ts
import { CAPABILITY_DATE, FHIR_VERSION, SOFTWARE_NAME } from "./profiles";
import type { DeclaredResource } from "./registry";
import type { CapabilityStatement } from "./resources/types";

/** `metadata` se genera del registro: declara exactamente lo que se despacha. */
export function capabilityStatement(resources: readonly DeclaredResource[]): CapabilityStatement {
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: CAPABILITY_DATE,
    kind: "instance",
    software: { name: SOFTWARE_NAME },
    implementation: { description: `${SOFTWARE_NAME}: integracion FHIR con Hermes` },
    fhirVersion: FHIR_VERSION,
    format: ["json"],
    rest: [
      {
        mode: "server",
        security: { description: "Token portador (JWT) con rol service. Sin SMART." },
        resource: resources.map((resource) => ({
          type: resource.type,
          interaction: [{ code: "read" }, { code: "search-type" }],
          searchParam: resource.searchParams.map((param) => ({
            name: param.name,
            type: param.type,
          })),
        })),
      },
    ],
  };
}
```

- [ ] **Step 6: Casos de uso**

`backend/src/modules/fhir/application/resource-handlers.ts`:

```ts
import type { OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { FhirSource, FhirSources } from "../domain/ports/sources";
import type { ResourceType } from "../domain/profiles";
import { DEFINITIONS, type ResourceDefinition, type SearchContext } from "../domain/registry";
import type { FhirResource } from "../domain/resources/types";
import { assertSupported } from "../domain/search";

export type SearchResult = OffsetWindow & {
  readonly resources: readonly FhirResource[];
  readonly total: number;
};

export type ResourceHandler = {
  read(tenantId: TenantId, id: string): Promise<FhirResource | null>;
  search(tenantId: TenantId, context: SearchContext): Promise<SearchResult>;
};

export type ResourceHandlers = Readonly<Record<ResourceType, ResourceHandler>>;

/** Une la definicion de un recurso con su fuente, borrando los tipos del registro. */
function bind<R, Q extends OffsetWindow>(
  definition: ResourceDefinition<R, Q>,
  source: FhirSource<R, Q>,
): ResourceHandler {
  return {
    async read(tenantId, id) {
      const record = await source.read(tenantId, id);
      return record ? definition.toResource(record) : null;
    },
    async search(tenantId, context) {
      assertSupported(
        context.params,
        definition.searchParams.map((param) => param.name),
      );
      const query = definition.buildQuery(context);
      const page = await source.search(tenantId, query);
      return {
        resources: page.data.map((record) => definition.toResource(record)),
        total: page.total,
        offset: query.offset,
        limit: query.limit,
      };
    },
  };
}

export function createResourceHandlers(sources: FhirSources): ResourceHandlers {
  return {
    Patient: bind(DEFINITIONS.Patient, sources.Patient),
    Practitioner: bind(DEFINITIONS.Practitioner, sources.Practitioner),
    HealthcareService: bind(DEFINITIONS.HealthcareService, sources.HealthcareService),
    Schedule: bind(DEFINITIONS.Schedule, sources.Schedule),
    Slot: bind(DEFINITIONS.Slot, sources.Slot),
    Appointment: bind(DEFINITIONS.Appointment, sources.Appointment),
  };
}
```

`backend/src/modules/fhir/application/read-resource.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { fhirNotFound } from "../domain/fhir-error";
import { isResourceType } from "../domain/profiles";
import type { FhirResource } from "../domain/resources/types";
import type { ResourceHandlers } from "./resource-handlers";

export type ReadResource = (tenantId: TenantId, type: string, id: string) => Promise<FhirResource>;

/** Tipo desconocido, id inexistente o de otro tenant: el mismo `not-found`. */
export function createReadResource(handlers: ResourceHandlers): ReadResource {
  return async (tenantId, type, id) => {
    const resource = isResourceType(type) ? await handlers[type].read(tenantId, id) : null;
    if (!resource) {
      throw fhirNotFound();
    }
    return resource;
  };
}
```

`backend/src/modules/fhir/application/search-resources.ts`:

```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { searchBundle } from "../domain/bundle";
import { fhirNotFound } from "../domain/fhir-error";
import { isResourceType } from "../domain/profiles";
import type { FhirBundle } from "../domain/resources/types";
import { collectParams } from "../domain/search";
import type { ResourceHandlers } from "./resource-handlers";

export type SearchResourcesInput = {
  readonly tenantId: TenantId;
  readonly type: string;
  /** Parametros de la query tal como llegaron, en orden. */
  readonly entries: readonly (readonly [string, string])[];
  readonly baseUrl: string;
};

export type SearchResources = (input: SearchResourcesInput) => Promise<FhirBundle>;

export function createSearchResources(
  handlers: ResourceHandlers,
  timeZone: string,
): SearchResources {
  return async (input) => {
    if (!isResourceType(input.type)) {
      throw fhirNotFound();
    }
    const result = await handlers[input.type].search(input.tenantId, {
      params: collectParams(input.entries),
      timeZone,
    });
    return searchBundle({
      baseUrl: input.baseUrl,
      type: input.type,
      filters: input.entries,
      ...result,
    });
  };
}
```

`backend/src/modules/fhir/application/get-capability-statement.ts`:

```ts
import { capabilityStatement } from "../domain/capability-statement";
import { DECLARED_RESOURCES } from "../domain/registry";
import type { CapabilityStatement } from "../domain/resources/types";

export type GetCapabilityStatement = () => CapabilityStatement;

export function createGetCapabilityStatement(): GetCapabilityStatement {
  return () => capabilityStatement(DECLARED_RESOURCES);
}
```

- [ ] **Step 7: Correr el test**

Run: `npm --prefix backend exec -- vitest run --project unit tests/fhir/registro.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 8: Typecheck, lint y fronteras**

Run: `npm --prefix backend run typecheck`
Expected: sin errores.

Run: `npm --prefix backend run lint`
Expected: sin errores en `src/modules/fhir` ni `tests/fhir`.

Run: `npm --prefix backend exec -- vitest run --project unit tests/fronteras.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/fhir/domain/registry.ts backend/src/modules/fhir/domain/bundle.ts backend/src/modules/fhir/domain/capability-statement.ts backend/src/modules/fhir/application backend/tests/fhir/registro.test.ts
git commit -m "feat(fhir): registro de recursos, Bundle, CapabilityStatement y casos de uso"
```

---

### Task 4: Lecturas por desplazamiento en `scheduling`

**Files:**
- Create: `backend/src/modules/scheduling/domain/ports/directory.ts`
- Create: `backend/src/modules/scheduling/infrastructure/prisma-scheduling-directory.ts`
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-practitioner-repository.ts:6` (exportar `mapPractitioner`)
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-healthcare-service-repository.ts:6` (exportar `mapService`)
- Test: `backend/tests/db/fhir-directorio.test.ts`

**Interfaces:**
- Consumes: `OffsetPage`, `OffsetWindow` de `shared/domain/pagination.ts`; entidades `Practitioner`, `HealthcareService`, `Schedule`, `Slot`, `Appointment`, `HermesIdentifier`, `SlotStatus`, `AppointmentStatus` de `scheduling/domain/entities.ts`; `mapSchedule`, `mapSlot`, `mapAppointment` ya exportados; `PrismaExecutor`.
- Produces (de `scheduling/domain/ports/directory.ts`):
  - `type TimeBound = { op: "ge" | "gt" | "le" | "lt"; at: Date }`
  - `type MasterSearch = OffsetWindow & { tenantId: TenantId; identifier: HermesIdentifier | null; active: boolean | null }`
  - `type ScheduleSearch = MasterSearch & { practitionerId: string | null; healthcareServiceId: string | null }`
  - `type SlotSearch = OffsetWindow & { tenantId: TenantId; identifier: HermesIdentifier | null; scheduleId: string | null; status: SlotStatus | null; start: readonly TimeBound[] }`
  - `type AppointmentSearch = OffsetWindow & { tenantId: TenantId; identifier: HermesIdentifier | null; medicalRecordId: string | null; slotId: string | null; status: AppointmentStatus | null; start: readonly TimeBound[] }`
  - `type AppointmentWithActors = Appointment & { practitionerId: string; healthcareServiceId: string }`
  - `type SchedulingDirectory` con `getPractitioner`, `searchPractitioners`, `getHealthcareService`, `searchHealthcareServices`, `getSchedule`, `searchSchedules`, `getSlot`, `searchSlots`, `getAppointment`, `searchAppointments`.
  - `createPrismaSchedulingDirectory(db: PrismaExecutor): SchedulingDirectory`.

- [ ] **Step 1: Escribir el test (falla)**

Crea `backend/tests/db/fhir-directorio.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SchedulingDirectory } from "@/modules/scheduling/domain/ports/directory";
import { createPrismaSchedulingDirectory } from "@/modules/scheduling/infrastructure/prisma-scheduling-directory";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();
const WINDOW = { offset: 0, limit: 50 };

describe("fhir-conformance: lecturas por desplazamiento de scheduling", () => {
  let a: TenantDomainSeed;
  let b: TenantDomainSeed;
  let tenantA: TenantId;
  let directory: SchedulingDirectory;

  beforeEach(async () => {
    await truncateAll(prisma);
    a = await seedTenantDomain(prisma, "a");
    b = await seedTenantDomain(prisma, "b");
    tenantA = toTenantId(a.tenantId);
    directory = createPrismaSchedulingDirectory(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lee por id solo dentro del tenant", async () => {
    expect((await directory.getPractitioner(tenantA, a.practitionerId))?.id).toBe(a.practitionerId);
    expect(await directory.getPractitioner(tenantA, b.practitionerId)).toBeNull();
    expect(await directory.getHealthcareService(tenantA, b.serviceId)).toBeNull();
    expect(await directory.getSchedule(tenantA, b.scheduleId)).toBeNull();
    expect(await directory.getSlot(tenantA, b.freeSlotId)).toBeNull();
    expect(await directory.getAppointment(tenantA, b.appointmentId)).toBeNull();
  });

  it("busca maestros por identificador Hermes y por active", async () => {
    const all = await directory.searchPractitioners({
      tenantId: tenantA,
      identifier: null,
      active: null,
      ...WINDOW,
    });
    expect(all).toMatchObject({ total: 1, data: [{ id: a.practitionerId }] });

    const byIdentifier = await directory.searchHealthcareServices({
      tenantId: tenantA,
      identifier: { system: HERMES_SYSTEM.service, value: "S-a" },
      active: null,
      ...WINDOW,
    });
    expect(byIdentifier.data.map((row) => row.id)).toEqual([a.serviceId]);

    const foreign = await directory.searchHealthcareServices({
      tenantId: tenantA,
      identifier: { system: HERMES_SYSTEM.service, value: "S-b" },
      active: null,
      ...WINDOW,
    });
    expect(foreign).toEqual({ data: [], total: 0 });

    const inactive = await directory.searchPractitioners({
      tenantId: tenantA,
      identifier: null,
      active: false,
      ...WINDOW,
    });
    expect(inactive.total).toBe(0);
  });

  it("busca agendas por profesional y por servicio", async () => {
    const base = { tenantId: tenantA, identifier: null, active: null, ...WINDOW };
    const byPractitioner = await directory.searchSchedules({
      ...base,
      practitionerId: a.practitionerId,
      healthcareServiceId: null,
    });
    expect(byPractitioner.data.map((row) => row.id)).toEqual([a.scheduleId]);

    const byForeignService = await directory.searchSchedules({
      ...base,
      practitionerId: null,
      healthcareServiceId: b.serviceId,
    });
    expect(byForeignService.total).toBe(0);
  });

  it("pagina cupos por inicio y devuelve el total", async () => {
    const base = { tenantId: tenantA, identifier: null, scheduleId: null, status: null, start: [] };
    const first = await directory.searchSlots({ ...base, offset: 0, limit: 1 });
    expect(first.total).toBe(2);
    expect(first.data.map((row) => row.id)).toEqual([a.freeSlotId]);

    const second = await directory.searchSlots({ ...base, offset: 1, limit: 1 });
    expect(second.data.map((row) => row.id)).toEqual([a.busySlotId]);

    const beyond = await directory.searchSlots({ ...base, offset: 5, limit: 1 });
    expect(beyond).toEqual({ data: [], total: 2 });
  });

  it("filtra cupos por estado, agenda y cotas de inicio", async () => {
    const base = { tenantId: tenantA, identifier: null, ...WINDOW };
    const free = await directory.searchSlots({
      ...base,
      scheduleId: a.scheduleId,
      status: "free",
      start: [],
    });
    expect(free.data.map((row) => row.id)).toEqual([a.freeSlotId]);

    const from15 = await directory.searchSlots({
      ...base,
      scheduleId: null,
      status: null,
      start: [
        { op: "ge", at: new Date("2026-06-15T15:00:00.000Z") },
        { op: "lt", at: new Date("2026-06-15T16:00:00.000Z") },
      ],
    });
    expect(from15.data.map((row) => row.id)).toEqual([a.busySlotId]);

    const strictlyAfter = await directory.searchSlots({
      ...base,
      scheduleId: null,
      status: null,
      start: [{ op: "gt", at: new Date("2026-06-15T15:00:00.000Z") }],
    });
    expect(strictlyAfter.total).toBe(0);

    const upTo = await directory.searchSlots({
      ...base,
      scheduleId: null,
      status: null,
      start: [{ op: "le", at: new Date("2026-06-15T14:00:00.000Z") }],
    });
    expect(upTo.data.map((row) => row.id)).toEqual([a.freeSlotId]);
  });

  it("la cita trae el profesional y el servicio de su agenda", async () => {
    expect(await directory.getAppointment(tenantA, a.appointmentId)).toMatchObject({
      id: a.appointmentId,
      slotId: a.busySlotId,
      practitionerId: a.practitionerId,
      healthcareServiceId: a.serviceId,
      status: "booked",
    });
  });

  it("filtra citas por paciente, cupo, estado y fecha", async () => {
    const base = {
      tenantId: tenantA,
      identifier: null,
      medicalRecordId: null,
      slotId: null,
      status: null,
      start: [],
      ...WINDOW,
    };
    const byPatient = await directory.searchAppointments({
      ...base,
      medicalRecordId: a.medicalRecordId,
      slotId: a.busySlotId,
      status: "booked",
    });
    expect(byPatient).toMatchObject({ total: 1, data: [{ id: a.appointmentId }] });

    expect((await directory.searchAppointments({ ...base, status: "cancelled" })).total).toBe(0);
    expect(
      (await directory.searchAppointments({ ...base, medicalRecordId: b.medicalRecordId })).total,
    ).toBe(0);
    expect(
      (
        await directory.searchAppointments({
          ...base,
          start: [{ op: "lt", at: new Date("2026-06-15T15:00:00.000Z") }],
        })
      ).total,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/fhir-directorio.test.ts`
Expected: FAIL, no resuelve `@/modules/scheduling/infrastructure/prisma-scheduling-directory`.

- [ ] **Step 3: El puerto**

Crea `backend/src/modules/scheduling/domain/ports/directory.ts`:

```ts
import type { OffsetPage, OffsetWindow } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  Appointment,
  AppointmentStatus,
  HealthcareService,
  HermesIdentifier,
  Practitioner,
  Schedule,
  Slot,
  SlotStatus,
} from "../entities";

/**
 * Lecturas por id y por desplazamiento con total. Las usa la superficie FHIR;
 * REST sigue con los repositorios por cursor de `repositories.ts`.
 * Un filtro en `null` no restringe. Varias cotas de inicio se combinan con AND.
 */

export type TimeBound = { readonly op: "ge" | "gt" | "le" | "lt"; readonly at: Date };

export type MasterSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier | null;
  readonly active: boolean | null;
};

export type ScheduleSearch = MasterSearch & {
  readonly practitionerId: string | null;
  readonly healthcareServiceId: string | null;
};

export type SlotSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier | null;
  readonly scheduleId: string | null;
  readonly status: SlotStatus | null;
  readonly start: readonly TimeBound[];
};

export type AppointmentSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier | null;
  readonly medicalRecordId: string | null;
  readonly slotId: string | null;
  readonly status: AppointmentStatus | null;
  readonly start: readonly TimeBound[];
};

/** Cita en firme con el profesional y el servicio de su agenda. */
export type AppointmentWithActors = Appointment & {
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
};

export type SchedulingDirectory = {
  getPractitioner(tenantId: TenantId, id: string): Promise<Practitioner | null>;
  searchPractitioners(search: MasterSearch): Promise<OffsetPage<Practitioner>>;
  getHealthcareService(tenantId: TenantId, id: string): Promise<HealthcareService | null>;
  searchHealthcareServices(search: MasterSearch): Promise<OffsetPage<HealthcareService>>;
  getSchedule(tenantId: TenantId, id: string): Promise<Schedule | null>;
  searchSchedules(search: ScheduleSearch): Promise<OffsetPage<Schedule>>;
  getSlot(tenantId: TenantId, id: string): Promise<Slot | null>;
  /** Orden: inicio ascendente, luego id. */
  searchSlots(search: SlotSearch): Promise<OffsetPage<Slot>>;
  getAppointment(tenantId: TenantId, id: string): Promise<AppointmentWithActors | null>;
  /** Orden: inicio ascendente, luego id. */
  searchAppointments(search: AppointmentSearch): Promise<OffsetPage<AppointmentWithActors>>;
};
```

- [ ] **Step 4: Exportar los dos mappers que faltan**

En `backend/src/modules/scheduling/infrastructure/prisma-practitioner-repository.ts` cambia `function mapPractitioner(row: {` por `export function mapPractitioner(row: {`.

En `backend/src/modules/scheduling/infrastructure/prisma-healthcare-service-repository.ts` cambia `function mapService(row: {` por `export function mapService(row: {`.

- [ ] **Step 5: El adaptador Prisma**

Crea `backend/src/modules/scheduling/infrastructure/prisma-scheduling-directory.ts`:

```ts
import type { OffsetWindow } from "@/modules/shared/domain/pagination";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { HermesIdentifier } from "../domain/entities";
import type {
  AppointmentSearch,
  AppointmentWithActors,
  MasterSearch,
  SchedulingDirectory,
  SlotSearch,
  TimeBound,
} from "../domain/ports/directory";
import { mapAppointment } from "./prisma-appointment-repository";
import { mapService } from "./prisma-healthcare-service-repository";
import { mapPractitioner } from "./prisma-practitioner-repository";
import { mapSchedule } from "./prisma-schedule-repository";
import { mapSlot } from "./prisma-slot-repository";

function byIdentifier(identifier: HermesIdentifier | null) {
  return identifier
    ? { identifierSystem: identifier.system, identifierValue: identifier.value }
    : {};
}

function startFilter(bound: TimeBound) {
  switch (bound.op) {
    case "ge":
      return { startAt: { gte: bound.at } };
    case "gt":
      return { startAt: { gt: bound.at } };
    case "le":
      return { startAt: { lte: bound.at } };
    case "lt":
      return { startAt: { lt: bound.at } };
  }
}

function windowOf(search: OffsetWindow) {
  return { skip: search.offset, take: search.limit };
}

function masterWhere(search: MasterSearch) {
  return {
    tenantId: search.tenantId,
    ...byIdentifier(search.identifier),
    ...(search.active === null ? {} : { active: search.active }),
  };
}

function slotWhere(search: SlotSearch) {
  return {
    tenantId: search.tenantId,
    ...byIdentifier(search.identifier),
    ...(search.scheduleId === null ? {} : { scheduleId: search.scheduleId }),
    ...(search.status === null ? {} : { status: search.status }),
    AND: search.start.map(startFilter),
  };
}

function appointmentWhere(search: AppointmentSearch) {
  return {
    tenantId: search.tenantId,
    ...byIdentifier(search.identifier),
    ...(search.medicalRecordId === null ? {} : { medicalRecordId: search.medicalRecordId }),
    ...(search.slotId === null ? {} : { slotId: search.slotId }),
    ...(search.status === null ? {} : { status: search.status }),
    AND: search.start.map(startFilter),
  };
}

const BY_START = [{ startAt: "asc" as const }, { id: "asc" as const }];
const WITH_ACTORS = {
  schedule: { select: { practitionerId: true, healthcareServiceId: true } },
} as const;

type AppointmentRow = Parameters<typeof mapAppointment>[0] & {
  schedule: { practitionerId: string; healthcareServiceId: string };
};

function mapWithActors(row: AppointmentRow): AppointmentWithActors {
  return {
    ...mapAppointment(row),
    practitionerId: row.schedule.practitionerId,
    healthcareServiceId: row.schedule.healthcareServiceId,
  };
}

function practitionerReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getPractitioner" | "searchPractitioners"> {
  return {
    async getPractitioner(tenantId, id) {
      const row = await db.practitioner.findFirst({ where: { tenantId, id } });
      return row ? mapPractitioner(row) : null;
    },
    async searchPractitioners(search) {
      const where = masterWhere(search);
      const [rows, total] = await Promise.all([
        db.practitioner.findMany({ where, orderBy: { id: "asc" }, ...windowOf(search) }),
        db.practitioner.count({ where }),
      ]);
      return { data: rows.map(mapPractitioner), total };
    },
  };
}

function serviceReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getHealthcareService" | "searchHealthcareServices"> {
  return {
    async getHealthcareService(tenantId, id) {
      const row = await db.healthcareService.findFirst({ where: { tenantId, id } });
      return row ? mapService(row) : null;
    },
    async searchHealthcareServices(search) {
      const where = masterWhere(search);
      const [rows, total] = await Promise.all([
        db.healthcareService.findMany({ where, orderBy: { id: "asc" }, ...windowOf(search) }),
        db.healthcareService.count({ where }),
      ]);
      return { data: rows.map(mapService), total };
    },
  };
}

function scheduleReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getSchedule" | "searchSchedules"> {
  return {
    async getSchedule(tenantId, id) {
      const row = await db.schedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },
    async searchSchedules(search) {
      const where = {
        ...masterWhere(search),
        ...(search.practitionerId === null ? {} : { practitionerId: search.practitionerId }),
        ...(search.healthcareServiceId === null
          ? {}
          : { healthcareServiceId: search.healthcareServiceId }),
      };
      const [rows, total] = await Promise.all([
        db.schedule.findMany({ where, orderBy: { id: "asc" }, ...windowOf(search) }),
        db.schedule.count({ where }),
      ]);
      return { data: rows.map(mapSchedule), total };
    },
  };
}

function slotReads(db: PrismaExecutor): Pick<SchedulingDirectory, "getSlot" | "searchSlots"> {
  return {
    async getSlot(tenantId, id) {
      const row = await db.slot.findFirst({ where: { tenantId, id } });
      return row ? mapSlot(row) : null;
    },
    async searchSlots(search) {
      const where = slotWhere(search);
      const [rows, total] = await Promise.all([
        db.slot.findMany({ where, orderBy: BY_START, ...windowOf(search) }),
        db.slot.count({ where }),
      ]);
      return { data: rows.map(mapSlot), total };
    },
  };
}

function appointmentReads(
  db: PrismaExecutor,
): Pick<SchedulingDirectory, "getAppointment" | "searchAppointments"> {
  return {
    async getAppointment(tenantId, id) {
      const row = await db.appointment.findFirst({ where: { tenantId, id }, include: WITH_ACTORS });
      return row ? mapWithActors(row) : null;
    },
    async searchAppointments(search) {
      const where = appointmentWhere(search);
      const [rows, total] = await Promise.all([
        db.appointment.findMany({
          where,
          include: WITH_ACTORS,
          orderBy: BY_START,
          ...windowOf(search),
        }),
        db.appointment.count({ where }),
      ]);
      return { data: rows.map(mapWithActors), total };
    },
  };
}

/** Lecturas por id y por desplazamiento; todas filtran por tenant. */
export function createPrismaSchedulingDirectory(db: PrismaExecutor): SchedulingDirectory {
  return {
    ...practitionerReads(db),
    ...serviceReads(db),
    ...scheduleReads(db),
    ...slotReads(db),
    ...appointmentReads(db),
  };
}
```

Si el typecheck rechaza `BY_START` por ser un arreglo mutable compartido, declara el `orderBy` en línea en cada llamada (`orderBy: [{ startAt: "asc" }, { id: "asc" }]`), como hace `prisma-slot-repository.ts`.

- [ ] **Step 6: Correr el test**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/fhir-directorio.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Typecheck, lint y fronteras**

Run: `npm --prefix backend run typecheck`
Expected: sin errores.

Run: `npm --prefix backend run lint`
Expected: sin errores en los archivos de la tarea.

Run: `npm --prefix backend exec -- vitest run --project unit tests/fronteras.test.ts`
Expected: PASS (el puerto nuevo de `scheduling/domain` no importa Prisma).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/scheduling/domain/ports/directory.ts backend/src/modules/scheduling/infrastructure/prisma-scheduling-directory.ts backend/src/modules/scheduling/infrastructure/prisma-practitioner-repository.ts backend/src/modules/scheduling/infrastructure/prisma-healthcare-service-repository.ts backend/tests/db/fhir-directorio.test.ts
git commit -m "feat(scheduling): lecturas por id y por desplazamiento con total"
```

---

### Task 5: Búsqueda por desplazamiento en `patients`

**Files:**
- Modify: `backend/src/modules/patients/domain/ports/repositories.ts` (añadir al final)
- Modify: `backend/src/modules/patients/infrastructure/prisma-medical-record-repository.ts:7` (exportar `mapRecord`)
- Create: `backend/src/modules/patients/infrastructure/prisma-medical-record-directory.ts`
- Test: `backend/tests/db/fhir-directorio-pacientes.test.ts`

**Interfaces:**
- Consumes: `OffsetPage`, `OffsetWindow`; `MedicalRecord`, `DocumentType` de `patients/domain/entities.ts`; `PrismaExecutor`.
- Produces:
  - `type MedicalRecordSearch = OffsetWindow & { tenantId: TenantId; identifier: { system: string; value: string } | null; document: { type: DocumentType; number: string } | null; preRegistered: boolean | null }`
  - `type MedicalRecordDirectory = { search(search: MedicalRecordSearch): Promise<OffsetPage<MedicalRecord>> }`
  - `createPrismaMedicalRecordDirectory(db: PrismaExecutor): MedicalRecordDirectory`
  - La lectura por id sigue siendo `MedicalRecordRepository.get(tenantId, id)`, que ya existe.

- [ ] **Step 1: Escribir el test (falla)**

Crea `backend/tests/db/fhir-directorio-pacientes.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MedicalRecordDirectory } from "@/modules/patients/domain/ports/repositories";
import { createPrismaMedicalRecordDirectory } from "@/modules/patients/infrastructure/prisma-medical-record-directory";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();

describe("fhir-conformance: busqueda de historias clinicas por desplazamiento", () => {
  let a: TenantDomainSeed;
  let b: TenantDomainSeed;
  let tenantA: TenantId;
  let directory: MedicalRecordDirectory;
  let preRegisteredId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    a = await seedTenantDomain(prisma, "a");
    b = await seedTenantDomain(prisma, "b");
    tenantA = toTenantId(a.tenantId);
    directory = createPrismaMedicalRecordDirectory(prisma);
    preRegisteredId = `${a.tenantId}-mr-pre`;
    await prisma.medicalRecord.create({
      data: {
        id: preRegisteredId,
        tenantId: a.tenantId,
        identifierSystem: "urn:ingenius:pre-registration",
        identifierValue: preRegisteredId,
        documentType: "TI",
        documentNumber: "555",
        givenNames: "Pre",
        familyNames: "Registro",
        birthDate: new Date("2010-03-04"),
        status: "pre_registered",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const base = () => ({
    tenantId: tenantA,
    identifier: null,
    document: null,
    preRegistered: null,
    offset: 0,
    limit: 50,
  });

  it("lista solo las del tenant, por id, con total", async () => {
    const page = await directory.search(base());
    expect(page.total).toBe(2);
    expect(page.data.map((row) => row.id)).toEqual([a.medicalRecordId, preRegisteredId].sort());
    expect(page.data.some((row) => row.id === b.medicalRecordId)).toBe(false);
  });

  it("pagina por desplazamiento", async () => {
    const second = await directory.search({ ...base(), offset: 1, limit: 1 });
    expect(second.total).toBe(2);
    expect(second.data).toHaveLength(1);
  });

  it("busca por identificador Hermes", async () => {
    const own = await directory.search({
      ...base(),
      identifier: { system: HERMES_SYSTEM.patient, value: "MR-a" },
    });
    expect(own.data.map((row) => row.id)).toEqual([a.medicalRecordId]);

    const foreign = await directory.search({
      ...base(),
      identifier: { system: HERMES_SYSTEM.patient, value: "MR-b" },
    });
    expect(foreign).toEqual({ data: [], total: 0 });
  });

  it("busca por documento", async () => {
    const own = await directory.search({ ...base(), document: { type: "TI", number: "555" } });
    expect(own.data.map((row) => row.id)).toEqual([preRegisteredId]);

    const wrongType = await directory.search({ ...base(), document: { type: "CC", number: "555" } });
    expect(wrongType.total).toBe(0);

    const foreign = await directory.search({
      ...base(),
      document: { type: "CC", number: b.documentNumber },
    });
    expect(foreign.total).toBe(0);
  });

  it("filtra los pre-registros", async () => {
    const pre = await directory.search({ ...base(), preRegistered: true });
    expect(pre.data.map((row) => row.id)).toEqual([preRegisteredId]);
    expect(pre.data[0]?.birthDate).toBe("2010-03-04");

    const confirmed = await directory.search({ ...base(), preRegistered: false });
    expect(confirmed.data.map((row) => row.id)).toEqual([a.medicalRecordId]);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/fhir-directorio-pacientes.test.ts`
Expected: FAIL, no resuelve `@/modules/patients/infrastructure/prisma-medical-record-directory`.

- [ ] **Step 3: El puerto**

En `backend/src/modules/patients/domain/ports/repositories.ts` cambia la primera línea de imports por:

```ts
import type { OffsetPage, OffsetWindow, Page } from "@/modules/shared/domain/pagination";
```

y añade al final del archivo:

```ts

/** Un filtro en `null` no restringe. `identifier` es el identificador Hermes. */
export type MedicalRecordSearch = OffsetWindow & {
  readonly tenantId: TenantId;
  readonly identifier: { readonly system: string; readonly value: string } | null;
  readonly document: { readonly type: DocumentType; readonly number: string } | null;
  readonly preRegistered: boolean | null;
};

/** Busqueda por desplazamiento con total. La usa la superficie FHIR. Orden: id. */
export type MedicalRecordDirectory = {
  search(search: MedicalRecordSearch): Promise<OffsetPage<MedicalRecord>>;
};
```

- [ ] **Step 4: Exportar `mapRecord`**

En `backend/src/modules/patients/infrastructure/prisma-medical-record-repository.ts` cambia `function mapRecord(row: {` por `export function mapRecord(row: {`.

- [ ] **Step 5: El adaptador**

Crea `backend/src/modules/patients/infrastructure/prisma-medical-record-directory.ts`:

```ts
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { MedicalRecordDirectory, MedicalRecordSearch } from "../domain/ports/repositories";
import { mapRecord } from "./prisma-medical-record-repository";

function statusWhere(preRegistered: boolean | null) {
  if (preRegistered === null) {
    return {};
  }
  return { status: preRegistered ? ("pre_registered" as const) : ("active" as const) };
}

function whereOf(search: MedicalRecordSearch) {
  return {
    tenantId: search.tenantId,
    ...(search.identifier
      ? { identifierSystem: search.identifier.system, identifierValue: search.identifier.value }
      : {}),
    ...(search.document
      ? { documentType: search.document.type, documentNumber: search.document.number }
      : {}),
    ...statusWhere(search.preRegistered),
  };
}

export function createPrismaMedicalRecordDirectory(db: PrismaExecutor): MedicalRecordDirectory {
  return {
    async search(search) {
      const where = whereOf(search);
      const [rows, total] = await Promise.all([
        db.medicalRecord.findMany({
          where,
          orderBy: { id: "asc" },
          skip: search.offset,
          take: search.limit,
        }),
        db.medicalRecord.count({ where }),
      ]);
      return { data: rows.map(mapRecord), total };
    },
  };
}
```

- [ ] **Step 6: Correr el test**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/fhir-directorio-pacientes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Typecheck y lint**

Run: `npm --prefix backend run typecheck`
Expected: sin errores.

Run: `npm --prefix backend run lint`
Expected: sin errores en los archivos de la tarea.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/patients/domain/ports/repositories.ts backend/src/modules/patients/infrastructure/prisma-medical-record-repository.ts backend/src/modules/patients/infrastructure/prisma-medical-record-directory.ts backend/tests/db/fhir-directorio-pacientes.test.ts
git commit -m "feat(patients): busqueda de historias clinicas por desplazamiento"
```

---

### Task 6: Superficie HTTP `/fhir` y cableado

**Files:**
- Modify: `backend/src/config/env.ts` (campo `fhirBaseUrl`)
- Create: `backend/src/http/fhir-route.ts`
- Create: `backend/src/http/fhir-dispatch.ts`
- Create: `backend/src/app/fhir/[[...path]]/route.ts`
- Create: `backend/src/composition/fhir-wiring.ts`
- Modify: `backend/src/composition-root.ts` (import, campo del `Container`, una línea en `getContainer`)
- Create: `backend/tests/helpers/fhir.ts`
- Modify: `backend/tests/roles.test.ts` (añadir un `describe` al final)
- Test: `backend/tests/db/fhir-conformance-http.test.ts`

**Interfaces:**
- Consumes: `createResourceHandlers`, `createReadResource`, `createSearchResources`, `createGetCapabilityStatement` (Tarea 3); `createPrismaSchedulingDirectory` (Tarea 4); `createPrismaMedicalRecordDirectory` (Tarea 5); `createPrismaMedicalRecordRepository` (existente, `get(tenantId, id)`); `ExpireDueRequests = (tenantId: TenantId) => Promise<void>` de `scheduling/application/appointment-request-queries.ts`; `getContainer().authenticate`, `requireRole`, `AuthError`, `NotFoundError`, `ValidationError`, `REQUEST_ID_HEADER`, `resolveRequestId`.
- Produces:
  - `AppConfig.fhirBaseUrl: string | null`.
  - De `http/fhir-route.ts`: `fhirResponse(body: unknown, status: number, requestId: string): NextResponse`, `toFhirError(error: unknown): FhirError`, `publicFhirRoute(request, handler: () => Promise<unknown> | unknown): Promise<NextResponse>`, `serviceFhirRoute(request, handler: (actor: Actor) => Promise<unknown>): Promise<NextResponse>`.
  - De `http/fhir-dispatch.ts`: `handleFhirRead(request: Request, path: readonly string[]): Promise<NextResponse>`, `handleFhirWrite(request: Request, path: readonly string[]): Promise<NextResponse>`.
  - De `composition/fhir-wiring.ts`: `fhirReads(prisma, config, expire)` que devuelve `{ fhir: { readResource: ReadResource; searchResources: SearchResources; getCapabilityStatement: GetCapabilityStatement } }`.
  - `Container.fhir`.
  - Helpers de prueba en `tests/helpers/fhir.ts`: `fhirGet(pathAndQuery: string, token?: string): Promise<{ response: Response; body: any }>`, `fhirSend(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, token?: string): Promise<{ response: Response; body: any }>`, `serviceToken(tenantId: string): Promise<string>`.

- [ ] **Step 1: Helper de pruebas**

Crea `backend/tests/helpers/fhir.ts`:

```ts
import { DELETE, GET, PATCH, POST, PUT } from "@/app/fhir/[[...path]]/route";
import { authedRequest, signToken } from "./token";

const WRITERS = { POST, PUT, PATCH, DELETE };

function segmentsOf(url: URL): string[] {
  return url.pathname
    .replace(/^\/fhir\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

function requestFor(url: URL, token: string | undefined, method: string): Request {
  return token ? authedRequest(url.toString(), token, { method }) : new Request(url, { method });
}

/** `GET /fhir/<pathAndQuery>` contra el handler real. */
export async function fhirGet(pathAndQuery: string, token?: string) {
  const url = new URL(`http://localhost/fhir/${pathAndQuery}`);
  const response = await GET(requestFor(url, token, "GET"), {
    params: Promise.resolve({ path: segmentsOf(url) }),
  });
  return { response, body: await response.json() };
}

export async function fhirSend(method: keyof typeof WRITERS, path: string, token?: string) {
  const url = new URL(`http://localhost/fhir/${path}`);
  const response = await WRITERS[method](requestFor(url, token, method), {
    params: Promise.resolve({ path: segmentsOf(url) }),
  });
  return { response, body: await response.json() };
}

export function serviceToken(tenantId: string): Promise<string> {
  return signToken({ role: "service", tenantId, subject: `hermes-${tenantId}` });
}
```

- [ ] **Step 2: Test de roles (falla)**

En `backend/tests/roles.test.ts` añade a los imports:

```ts
import { fhirGet, fhirSend, serviceToken } from "./helpers/fhir";
```

y al final del archivo:

```ts

describe("roles: /fhir", () => {
  const FHIR_MIME = "application/fhir+json";

  it("operator, admin y widget reciben 403 con OperationOutcome", async () => {
    for (const role of ["operator", "admin", "widget"] as const) {
      const token = await signToken({
        role,
        tenantId: "tenant-a",
        sessionId: role === "widget" ? "s-1" : undefined,
      });
      const { response, body } = await fhirGet("Patient", token);

      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue[0].code).toBe("forbidden");
      expect(body.error).toBeUndefined();
    }
  });

  it("sin token responde 401 login sin revelar la causa", async () => {
    const { response, body } = await fhirGet("Patient/mr-1");

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
    expect(body.issue[0]).toEqual({
      severity: "error",
      code: "login",
      diagnostics: "Credenciales ausentes o invalidas",
    });
  });

  it("un token expirado o de otro emisor responde 401 con el mismo mensaje", async () => {
    const expired = await signToken({ role: "service", tenantId: "tenant-a", expiresIn: "-1s" });
    const foreign = await signToken({ role: "service", tenantId: "tenant-a", issuer: "otro" });
    for (const token of [expired, foreign]) {
      const { response, body } = await fhirGet("Slot", token);
      expect(response.status).toBe(401);
      expect(body.issue[0].diagnostics).toBe("Credenciales ausentes o invalidas");
    }
  });

  it("sin rol service una ruta inexistente responde 401 o 403, nunca 404", async () => {
    const operator = await signToken({ role: "operator", tenantId: "tenant-a" });
    expect((await fhirGet("Inventado/x")).response.status).toBe(401);
    expect((await fhirGet("")).response.status).toBe(401);
    expect((await fhirGet("Inventado/x", operator)).response.status).toBe(403);
  });

  it("una escritura sin rol service responde 403, no 405", async () => {
    const operator = await signToken({ role: "operator", tenantId: "tenant-a" });
    const { response, body } = await fhirSend("PUT", "Patient/mr-1", operator);

    expect(response.status).toBe(403);
    expect(body.issue[0].code).toBe("forbidden");
    expect((await fhirSend("POST", "metadata")).response.status).toBe(401);
  });

  it("metadata responde 200 sin token", async () => {
    const { response, body } = await fhirGet("metadata");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
    expect(response.headers.get("X-Request-Id")).toEqual(expect.any(String));
    expect(body.resourceType).toBe("CapabilityStatement");
  });

  it("con rol service, un tipo desconocido responde 404 y una escritura 405", async () => {
    const token = await serviceToken("tenant-a");
    const unknown = await fhirGet("Inventado/x", token);
    expect(unknown.response.status).toBe(404);
    expect(unknown.body.issue[0].code).toBe("not-found");
    expect((await fhirGet("", token)).response.status).toBe(404);
    expect((await fhirGet("Patient/a/b", token)).response.status).toBe(404);

    const write = await fhirSend("PUT", "Patient/mr-1", token);
    expect(write.response.status).toBe(405);
    expect(write.response.headers.get("Allow")).toBe("GET");
    expect(write.body.issue[0].code).toBe("not-supported");
    expect((await fhirSend("DELETE", "Inventado/x", token)).response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Correr el test de roles y verlo fallar**

Run: `npm --prefix backend exec -- vitest run --project unit tests/roles.test.ts`
Expected: FAIL, no resuelve `@/app/fhir/[[...path]]/route`.

- [ ] **Step 4: `fhirBaseUrl` en la configuración**

En `backend/src/config/env.ts`, añade el campo al tipo `AppConfig`, después de `trustProxy`:

```ts
  /** Base publica de `/fhir` para los enlaces del Bundle. `null`: el origen de la peticion. */
  readonly fhirBaseUrl: string | null;
```

añade esta función antes de `loadConfig`:

```ts
function fhirBaseUrl(): string | null {
  const value = process.env.FHIR_BASE_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}
```

y en el objeto que devuelve `loadConfig`, después de `trustProxy`:

```ts
    fhirBaseUrl: fhirBaseUrl(),
```

- [ ] **Step 5: `fhir-route.ts`**

Crea `backend/src/http/fhir-route.ts`:

```ts
import { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { requireRole } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import { AuthError } from "@/modules/auth/domain/auth-error";
import {
  FhirError,
  fhirException,
  fhirForbidden,
  fhirInvalid,
  fhirLogin,
  fhirNotFound,
} from "@/modules/fhir/domain/fhir-error";
import { operationOutcome } from "@/modules/fhir/domain/operation-outcome";
import { FHIR_MIME } from "@/modules/fhir/domain/profiles";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

/**
 * Envoltorio de la superficie FHIR. No comparte nada con `errors.ts`: aqui todo
 * error es un `OperationOutcome` con `application/fhir+json`, nunca la envoltura REST.
 */

export function fhirResponse(body: unknown, status: number, requestId: string): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": FHIR_MIME,
      [REQUEST_ID_HEADER]: requestId,
      ...(status === 405 ? { Allow: "GET" } : {}),
    },
  });
}

function fromAuthError(error: AuthError): FhirError {
  if (error.reason === "unauthorized") {
    return fhirLogin();
  }
  return error.reason === "forbidden" ? fhirForbidden() : fhirNotFound();
}

/** Traduce el error del nucleo sin filtrar detalle interno. */
export function toFhirError(error: unknown): FhirError {
  if (error instanceof FhirError) {
    return error;
  }
  if (error instanceof AuthError) {
    return fromAuthError(error);
  }
  if (error instanceof NotFoundError) {
    return fhirNotFound();
  }
  if (error instanceof ValidationError) {
    return fhirInvalid(error.message);
  }
  return fhirException();
}

async function respond(request: Request, run: () => Promise<unknown>): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    return fhirResponse(await run(), 200, requestId);
  } catch (error) {
    const failure = toFhirError(error);
    return fhirResponse(
      operationOutcome(failure.code, failure.message),
      failure.status,
      requestId,
    );
  }
}

/** Ruta sin token. Solo `GET /fhir/metadata`. */
export function publicFhirRoute(
  request: Request,
  handler: () => Promise<unknown> | unknown,
): Promise<NextResponse> {
  return respond(request, async () => handler());
}

/** Autentica y exige `service` antes de tocar el handler: el enrutado va despues. */
export function serviceFhirRoute(
  request: Request,
  handler: (actor: Actor) => Promise<unknown>,
): Promise<NextResponse> {
  return respond(request, async () => {
    const actor = await getContainer().authenticate(request.headers.get("Authorization"));
    requireRole(actor, ["service"]);
    return handler(actor);
  });
}
```

- [ ] **Step 6: `fhir-dispatch.ts`**

Crea `backend/src/http/fhir-dispatch.ts`:

```ts
import type { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";
import { fhirMethodNotAllowed, fhirNotFound } from "@/modules/fhir/domain/fhir-error";
import { isResourceType } from "@/modules/fhir/domain/profiles";
import { publicFhirRoute, serviceFhirRoute } from "./fhir-route";

function isMetadata(path: readonly string[]): boolean {
  return path.length === 1 && path[0] === "metadata";
}

/** `GET /fhir/metadata`, `GET /fhir/{Tipo}` (busqueda) y `GET /fhir/{Tipo}/{id}` (lectura). */
export function handleFhirRead(request: Request, path: readonly string[]): Promise<NextResponse> {
  if (isMetadata(path)) {
    return publicFhirRoute(request, () => getContainer().fhir.getCapabilityStatement());
  }
  return serviceFhirRoute(request, async (actor) => {
    const { fhir, config } = getContainer();
    const [type, id, ...rest] = path;
    if (type === undefined || rest.length > 0) {
      throw fhirNotFound();
    }
    if (id !== undefined) {
      return fhir.readResource(actor.tenantId, type, id);
    }
    const url = new URL(request.url);
    return fhir.searchResources({
      tenantId: actor.tenantId,
      type,
      entries: [...url.searchParams.entries()],
      baseUrl: config.fhirBaseUrl ?? `${url.origin}/fhir`,
    });
  });
}

/** La 4.1 es solo lectura: recurso conocido -> 405; desconocido -> 404. */
export function handleFhirWrite(request: Request, path: readonly string[]): Promise<NextResponse> {
  return serviceFhirRoute(request, async () => {
    const [type] = path;
    throw type !== undefined && isResourceType(type) ? fhirMethodNotAllowed() : fhirNotFound();
  });
}
```

- [ ] **Step 7: La ruta comodín**

Crea `backend/src/app/fhir/[[...path]]/route.ts`:

```ts
import { handleFhirRead, handleFhirWrite } from "@/http/fhir-dispatch";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

export const GET = async (request: Request, context: RouteContext): Promise<Response> =>
  handleFhirRead(request, (await context.params).path ?? []);

const write = async (request: Request, context: RouteContext): Promise<Response> =>
  handleFhirWrite(request, (await context.params).path ?? []);

export const POST = write;
export const PUT = write;
export const PATCH = write;
export const DELETE = write;
```

- [ ] **Step 8: `fhir-wiring.ts`**

Crea `backend/src/composition/fhir-wiring.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createGetCapabilityStatement } from "../modules/fhir/application/get-capability-statement";
import { createReadResource } from "../modules/fhir/application/read-resource";
import { createResourceHandlers } from "../modules/fhir/application/resource-handlers";
import { createSearchResources } from "../modules/fhir/application/search-resources";
import type { FhirSources } from "../modules/fhir/domain/ports/sources";
import { createPrismaMedicalRecordDirectory } from "../modules/patients/infrastructure/prisma-medical-record-directory";
import { createPrismaMedicalRecordRepository } from "../modules/patients/infrastructure/prisma-medical-record-repository";
import type { ExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createPrismaSchedulingDirectory } from "../modules/scheduling/infrastructure/prisma-scheduling-directory";

/**
 * Cumple los puertos de lectura de `fhir` con `scheduling` y `patients`, para que
 * `fhir` no importe ninguno de los dos. Los registros pasan tal cual: las entidades
 * ya tienen la forma que `fhir` declara.
 */
function fhirSources(prisma: PrismaClient, expire: ExpireDueRequests): FhirSources {
  const directory = createPrismaSchedulingDirectory(prisma);
  const records = createPrismaMedicalRecordRepository(prisma);
  const recordDirectory = createPrismaMedicalRecordDirectory(prisma);
  return {
    Patient: {
      read: (tenantId, id) => records.get(tenantId, id),
      search: (tenantId, query) => recordDirectory.search({ tenantId, ...query }),
    },
    Practitioner: {
      read: (tenantId, id) => directory.getPractitioner(tenantId, id),
      search: (tenantId, query) => directory.searchPractitioners({ tenantId, ...query }),
    },
    HealthcareService: {
      read: (tenantId, id) => directory.getHealthcareService(tenantId, id),
      search: (tenantId, query) => directory.searchHealthcareServices({ tenantId, ...query }),
    },
    Schedule: {
      read: (tenantId, id) => directory.getSchedule(tenantId, id),
      search: (tenantId, query) => directory.searchSchedules({ tenantId, ...query }),
    },
    // Vencimiento al leer: Hermes nunca ve un apartado vencido como vigente.
    Slot: {
      async read(tenantId, id) {
        await expire(tenantId);
        return directory.getSlot(tenantId, id);
      },
      async search(tenantId, query) {
        await expire(tenantId);
        return directory.searchSlots({ tenantId, ...query });
      },
    },
    Appointment: {
      read: (tenantId, id) => directory.getAppointment(tenantId, id),
      search: (tenantId, query) => directory.searchAppointments({ tenantId, ...query }),
    },
  };
}

export function fhirReads(prisma: PrismaClient, config: AppConfig, expire: ExpireDueRequests) {
  const handlers = createResourceHandlers(fhirSources(prisma, expire));
  return {
    fhir: {
      readResource: createReadResource(handlers),
      searchResources: createSearchResources(handlers, config.appTimezone),
      getCapabilityStatement: createGetCapabilityStatement(),
    },
  };
}

export type FhirReads = ReturnType<typeof fhirReads>;
```

- [ ] **Step 9: Conectar el contenedor**

En `backend/src/composition-root.ts`:

1. Después de la línea `import { conversationWritePorts } from "./composition/conversation-wiring";` añade:

```ts
import { type FhirReads, fhirReads } from "./composition/fhir-wiring";
```

2. En el tipo `Container`, después de `readonly listInbox: PreAgendaReads["listInbox"];` añade:

```ts
  readonly fhir: FhirReads["fhir"];
```

3. En `getContainer`, después de `...widgetReads(prisma, config),` añade:

```ts
      ...fhirReads(prisma, config, preAgenda.expireDueRequests),
```

El archivo queda por debajo de 400 líneas (gana 3).

- [ ] **Step 10: Correr el test de roles**

Run: `npm --prefix backend exec -- vitest run --project unit tests/roles.test.ts`
Expected: PASS, incluidos los 7 tests de `roles: /fhir`.

- [ ] **Step 11: Test HTTP de conformidad (falla si algo no cuadra)**

Crea `backend/tests/db/fhir-conformance-http.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirGet, serviceToken } from "../helpers/fhir";
import { seedTenantDomain, type TenantDomainSeed, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const FHIR_MIME = "application/fhir+json";
const PRE_TAG = encodeURIComponent("urn:ingenius:patient-tag|pre-registered");

type Entry = { resource: { id: string; status?: string } };

function idsOf(body: { entry: Entry[] }): string[] {
  return body.entry.map((entry) => entry.resource.id);
}

describe("fhir-conformance: lectura por HTTP", () => {
  let seed: TenantDomainSeed;
  let token: string;
  let lateSlotId: string;
  let preRegisteredId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await seedTenantDomain(prisma, "a");
    token = await serviceToken(seed.tenantId);
    // 22:00 del 15 de junio en Bogota; ya es 16 de junio en UTC.
    lateSlotId = `${seed.tenantId}-slot-late`;
    await prisma.slot.create({
      data: {
        id: lateSlotId,
        tenantId: seed.tenantId,
        identifierSystem: "urn:hermes:slot",
        identifierValue: "SL-LATE-a",
        scheduleId: seed.scheduleId,
        startAt: new Date("2026-06-16T03:00:00.000Z"),
        endAt: new Date("2026-06-16T03:30:00.000Z"),
        status: "free",
      },
    });
    preRegisteredId = `${seed.tenantId}-mr-pre`;
    await prisma.medicalRecord.create({
      data: {
        id: preRegisteredId,
        tenantId: seed.tenantId,
        identifierSystem: "urn:ingenius:pre-registration",
        identifierValue: preRegisteredId,
        documentType: "TI",
        documentNumber: "555",
        givenNames: "Pre",
        familyNames: "Registro",
        birthDate: new Date("2010-03-04"),
        status: "pre_registered",
      },
    });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  function seedIds(): Record<string, string> {
    return {
      Patient: seed.medicalRecordId,
      Practitioner: seed.practitionerId,
      HealthcareService: seed.serviceId,
      Schedule: seed.scheduleId,
      Slot: seed.freeSlotId,
      Appointment: seed.appointmentId,
    };
  }

  /** Valor valido para cada parametro declarado. Falla si el registro crece sin actualizar la prueba. */
  function sampleValue(type: string, name: string): string {
    const samples: Record<string, string> = {
      identifier: "urn:hermes:x|no-existe",
      _tag: "urn:ingenius:patient-tag|pre-registered",
      active: "true",
      status: type === "Slot" ? "free" : "booked",
      start: "ge2026-06-15",
      date: "ge2026-06-15",
      schedule: `Schedule/${seed.scheduleId}`,
      patient: `Patient/${seed.medicalRecordId}`,
      slot: `Slot/${seed.busySlotId}`,
      actor: `Practitioner/${seed.practitionerId}`,
    };
    const value = samples[name];
    if (value === undefined) {
      throw new Error(`Sin valor de muestra para ${type}.${name}`);
    }
    return value;
  }

  it("lee cada recurso por id con application/fhir+json", async () => {
    for (const [type, id] of Object.entries(seedIds())) {
      const { response, body } = await fhirGet(`${type}/${id}`, token);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
      expect(response.headers.get("X-Request-Id")).toEqual(expect.any(String));
      expect(body).toMatchObject({ resourceType: type, id });
    }
  });

  it("el paciente no expone campos internos y el pre-registro va marcado", async () => {
    const confirmed = await fhirGet(`Patient/${seed.medicalRecordId}`, token);
    expect(confirmed.body.meta).toBeUndefined();
    expect(confirmed.body).not.toHaveProperty("tenantId");

    const pre = await fhirGet(`Patient/${preRegisteredId}`, token);
    expect(pre.body.meta.tag).toEqual([
      { system: "urn:ingenius:patient-tag", code: "pre-registered" },
    ]);
  });

  it("busca cada recurso y devuelve un Bundle searchset", async () => {
    for (const type of Object.keys(seedIds())) {
      const { response, body } = await fhirGet(type, token);
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ resourceType: "Bundle", type: "searchset" });
      expect(body.total).toBe(body.entry.length);
      expect(body.entry[0].fullUrl).toBe(`http://localhost/fhir/${type}/${body.entry[0].resource.id}`);
    }
  });

  it("Patient: busca por identificador Hermes, por documento y por _tag", async () => {
    const hermes = await fhirGet(
      `Patient?identifier=${encodeURIComponent("urn:hermes:patient|MR-a")}`,
      token,
    );
    expect(idsOf(hermes.body)).toEqual([seed.medicalRecordId]);

    const document = await fhirGet(
      `Patient?identifier=${encodeURIComponent(`urn:ingenius:document:CC|${seed.documentNumber}`)}`,
      token,
    );
    expect(idsOf(document.body)).toEqual([seed.medicalRecordId]);

    const tagged = await fhirGet(`Patient?_tag=${PRE_TAG}`, token);
    expect(idsOf(tagged.body)).toEqual([preRegisteredId]);
  });

  it("Slot: filtra por agenda, estado y rango de inicio", async () => {
    const free = await fhirGet(`Slot?schedule=Schedule/${seed.scheduleId}&status=free`, token);
    expect(idsOf(free.body)).toEqual([seed.freeSlotId, lateSlotId]);

    const busy = await fhirGet("Slot?status=busy", token);
    expect(idsOf(busy.body)).toEqual([seed.busySlotId]);

    const range = await fhirGet(
      `Slot?start=${encodeURIComponent("ge2026-06-15T14:30:00Z")}&start=${encodeURIComponent("lt2026-06-15T16:00:00Z")}`,
      token,
    );
    expect(idsOf(range.body)).toEqual([seed.busySlotId]);
  });

  it("una fecha sin hora es el dia en APP_TIMEZONE", async () => {
    const june15 = await fhirGet("Slot?start=2026-06-15", token);
    expect(idsOf(june15.body)).toEqual([seed.freeSlotId, seed.busySlotId, lateSlotId]);

    const june16 = await fhirGet("Slot?start=eq2026-06-16", token);
    expect(june16.body.total).toBe(0);
  });

  it("Schedule y Appointment: filtran por referencias", async () => {
    const schedules = await fhirGet(`Schedule?actor=HealthcareService/${seed.serviceId}`, token);
    expect(idsOf(schedules.body)).toEqual([seed.scheduleId]);

    const appointments = await fhirGet(
      `Appointment?patient=Patient/${seed.medicalRecordId}&slot=Slot/${seed.busySlotId}&status=booked&date=2026-06-15`,
      token,
    );
    expect(idsOf(appointments.body)).toEqual([seed.appointmentId]);
    expect(appointments.body.entry[0].resource.participant).toHaveLength(3);
  });

  it("pagina con _count y _offset, total y enlaces", async () => {
    const first = await fhirGet("Slot?status=free&_count=1", token);
    expect(first.body.total).toBe(2);
    expect(idsOf(first.body)).toEqual([seed.freeSlotId]);
    expect(first.body.link).toEqual([
      { relation: "self", url: "http://localhost/fhir/Slot?status=free&_count=1&_offset=0" },
      { relation: "next", url: "http://localhost/fhir/Slot?status=free&_count=1&_offset=1" },
    ]);

    const second = await fhirGet("Slot?status=free&_count=1&_offset=1", token);
    expect(idsOf(second.body)).toEqual([lateSlotId]);
    expect(second.body.link.map((link: { relation: string }) => link.relation)).toEqual([
      "self",
      "previous",
    ]);

    const clamped = await fhirGet("Slot?_count=500", token);
    expect(clamped.body.link[0].url).toBe("http://localhost/fhir/Slot?_count=200&_offset=0");
  });

  it("con FHIR_BASE_URL los enlaces y fullUrl usan esa base y conservan los filtros", async () => {
    process.env.FHIR_BASE_URL = "https://api.clinica.test/fhir/";
    resetContainer();
    try {
      const { body } = await fhirGet("Slot?status=free&_count=1", token);
      expect(body.link[1]).toEqual({
        relation: "next",
        url: "https://api.clinica.test/fhir/Slot?status=free&_count=1&_offset=1",
      });
      expect(body.entry[0].fullUrl).toBe(`https://api.clinica.test/fhir/Slot/${seed.freeSlotId}`);
    } finally {
      delete process.env.FHIR_BASE_URL;
      resetContainer();
    }
  });

  it("los errores son OperationOutcome con application/fhir+json", async () => {
    const cases: Array<[string, number, string]> = [
      ["Patient/no-existe", 404, "not-found"],
      ["Task", 404, "not-found"],
      ["Slot?name=x", 400, "not-supported"],
      ["Slot?tenant_id=tenant-b", 400, "not-supported"],
      ["Patient?identifier=MR-a", 400, "invalid"],
      ["Slot?_count=0", 400, "invalid"],
      ["Slot?_offset=-1", 400, "invalid"],
      ["Slot?start=2026-02-31", 400, "invalid"],
      ["Slot?status=free&status=busy", 400, "invalid"],
      ["Slot?schedule=sin-tipo", 400, "invalid"],
      [`Patient?_tag=${encodeURIComponent("urn:x|otro")}`, 400, "invalid"],
    ];
    for (const [path, status, code] of cases) {
      const { response, body } = await fhirGet(path, token);
      expect([path, response.status]).toEqual([path, status]);
      expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue).toEqual([
        { severity: "error", code, diagnostics: expect.any(String) },
      ]);
      expect(body.error).toBeUndefined();
    }
  });

  it("metadata coincide con lo que existe", async () => {
    const { body: metadata } = await fhirGet("metadata");
    const declared: Array<{
      type: string;
      interaction: Array<{ code: string }>;
      searchParam: Array<{ name: string }>;
    }> = metadata.rest[0].resource;

    expect(declared.map((resource) => resource.type).sort()).toEqual(Object.keys(seedIds()).sort());

    for (const resource of declared) {
      expect(resource.interaction.map((interaction) => interaction.code)).toEqual([
        "read",
        "search-type",
      ]);
      const read = await fhirGet(`${resource.type}/${seedIds()[resource.type]}`, token);
      expect([resource.type, "read", read.response.status]).toEqual([resource.type, "read", 200]);

      for (const param of resource.searchParam) {
        const value = encodeURIComponent(sampleValue(resource.type, param.name));
        const search = await fhirGet(`${resource.type}?${param.name}=${value}`, token);
        expect([resource.type, param.name, search.response.status]).toEqual([
          resource.type,
          param.name,
          200,
        ]);
      }

      const undeclared = await fhirGet(`${resource.type}?no-declarado=x`, token);
      expect(undeclared.response.status).toBe(400);
    }

    // Un parametro declarado solo para otro recurso tampoco se acepta.
    expect((await fhirGet("Practitioner?schedule=Schedule/x", token)).response.status).toBe(400);
    expect((await fhirGet("Patient?active=true", token)).response.status).toBe(400);
  });
});
```

- [ ] **Step 12: Correr el test HTTP**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/fhir-conformance-http.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 13: Suites completas, typecheck y lint**

Run: `npm --prefix backend run typecheck`
Expected: sin errores.

Run: `npm --prefix backend run lint`
Expected: sin errores en los archivos de la tarea.

Run: `npm --prefix backend test`
Expected: PASS toda la suite `unit` (incluidas `contrato-api`, `fronteras`, `roles` y `sin-ia`).

- [ ] **Step 14: Commit**

```bash
git add backend/src/config/env.ts backend/src/http/fhir-route.ts backend/src/http/fhir-dispatch.ts "backend/src/app/fhir/[[...path]]/route.ts" backend/src/composition/fhir-wiring.ts backend/src/composition-root.ts backend/tests/helpers/fhir.ts backend/tests/roles.test.ts backend/tests/db/fhir-conformance-http.test.ts
git commit -m "feat(fhir): superficie /fhir de lectura con metadata y OperationOutcome"
```

---

### Task 7: Aislamiento por tenant y vencimiento al leer sobre `/fhir`

Estas pruebas fijan dos garantías que el código de las Tareas 4 a 6 ya debe cumplir. Si alguna falla, el defecto está en el archivo que se indica en cada paso y se corrige ahí, no en la prueba.

**Files:**
- Test: `backend/tests/db/aislamiento-tenant-fhir.test.ts`
- Test: `backend/tests/db/fhir-vencimiento.test.ts`

**Interfaces:**
- Consumes: `fhirGet`, `serviceToken` de `tests/helpers/fhir.ts`; `seedTenantDomain`, `testPrisma`, `truncateAll`, `HERMES_SYSTEM` de `tests/db/support.ts`; `seedWorld`, `slotAt`, `createRequest`, `clockAt`, `ACTOR`, `HOUR_MS` de `tests/db/pre-agenda-support.ts`.

- [ ] **Step 1: Test de aislamiento**

Crea `backend/tests/db/aislamiento-tenant-fhir.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirGet, serviceToken } from "../helpers/fhir";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();

function idsByType(seed: TenantDomainSeed): Record<string, string[]> {
  return {
    Patient: [seed.medicalRecordId],
    Practitioner: [seed.practitionerId],
    HealthcareService: [seed.serviceId],
    Schedule: [seed.scheduleId],
    Slot: [seed.freeSlotId, seed.busySlotId],
    Appointment: [seed.appointmentId],
  };
}

describe("aislamiento-tenant: /fhir no filtra datos ajenos", () => {
  let a: TenantDomainSeed;
  let b: TenantDomainSeed;
  let tokenA: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    a = await seedTenantDomain(prisma, "a");
    b = await seedTenantDomain(prisma, "b");
    tokenA = await serviceToken(a.tenantId);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("leer por id un recurso de otro tenant responde 404 not-found", async () => {
    for (const [type, ids] of Object.entries(idsByType(b))) {
      for (const id of ids) {
        const { response, body } = await fhirGet(`${type}/${id}`, tokenA);
        expect([type, response.status]).toEqual([type, 404]);
        expect(body.issue[0].code).toBe("not-found");
      }
    }
  });

  it("el 404 de un recurso ajeno es identico al de uno inexistente", async () => {
    const foreign = await fhirGet(`Patient/${b.medicalRecordId}`, tokenA);
    const missing = await fhirGet("Patient/no-existe", tokenA);
    expect(foreign.body).toEqual(missing.body);
  });

  it("cada busqueda devuelve solo los recursos del tenant del token", async () => {
    for (const [type, ids] of Object.entries(idsByType(a))) {
      const { body } = await fhirGet(type, tokenA);
      const found: string[] = body.entry.map((entry: { resource: { id: string } }) => entry.resource.id);
      expect([type, found.sort()]).toEqual([type, [...ids].sort()]);
      expect(body.total).toBe(ids.length);
    }
  });

  it("buscar por el identificador Hermes de otro tenant no encuentra nada", async () => {
    const searches: Array<[string, string, string]> = [
      ["Patient", HERMES_SYSTEM.patient, "MR-b"],
      ["Practitioner", HERMES_SYSTEM.practitioner, "P-b"],
      ["HealthcareService", HERMES_SYSTEM.service, "S-b"],
      ["Schedule", HERMES_SYSTEM.schedule, "SCH-b"],
      ["Slot", HERMES_SYSTEM.slot, "SL-FREE-b"],
      ["Appointment", HERMES_SYSTEM.appointment, "AP-b"],
    ];
    for (const [type, system, value] of searches) {
      const { response, body } = await fhirGet(
        `${type}?identifier=${encodeURIComponent(`${system}|${value}`)}`,
        tokenA,
      );
      expect(response.status).toBe(200);
      expect([type, body.total, body.entry]).toEqual([type, 0, []]);
    }
  });

  it("buscar por el documento de un paciente ajeno no encuentra nada", async () => {
    const { body } = await fhirGet(
      `Patient?identifier=${encodeURIComponent(`urn:ingenius:document:CC|${b.documentNumber}`)}`,
      tokenA,
    );
    expect(body.total).toBe(0);
  });

  it("filtrar por la referencia a un recurso ajeno devuelve vacio", async () => {
    const searches = [
      `Slot?schedule=Schedule/${b.scheduleId}`,
      `Schedule?actor=Practitioner/${b.practitionerId}`,
      `Schedule?actor=HealthcareService/${b.serviceId}`,
      `Appointment?patient=Patient/${b.medicalRecordId}`,
      `Appointment?slot=Slot/${b.busySlotId}`,
    ];
    for (const path of searches) {
      const { response, body } = await fhirGet(path, tokenA);
      expect([path, response.status, body.total]).toEqual([path, 200, 0]);
    }
  });

  it("el tenant no se puede inyectar por query ni por header", async () => {
    const byQuery = await fhirGet(`Slot?tenant_id=${b.tenantId}`, tokenA);
    expect(byQuery.response.status).toBe(400);

    const { GET } = await import("@/app/fhir/[[...path]]/route");
    const response = await GET(
      new Request("http://localhost/fhir/Practitioner", {
        headers: { Authorization: `Bearer ${tokenA}`, "X-Tenant-Id": b.tenantId },
      }),
      { params: Promise.resolve({ path: ["Practitioner"] }) },
    );
    const body = await response.json();
    expect(body.entry.map((entry: { resource: { id: string } }) => entry.resource.id)).toEqual([
      a.practitionerId,
    ]);
  });
});
```

- [ ] **Step 2: Correr el test de aislamiento**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/aislamiento-tenant-fhir.test.ts`
Expected: PASS, 7 tests. Si falla una lectura o búsqueda, falta `tenantId` en un `where` de `prisma-scheduling-directory.ts` (Tarea 4) o `prisma-medical-record-directory.ts` (Tarea 5).

- [ ] **Step 3: Test de vencimiento al leer**

Crea `backend/tests/db/fhir-vencimiento.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirGet, serviceToken } from "../helpers/fhir";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

describe("fhir-conformance: vencimiento al leer en Slot", () => {
  let world: World;
  let token: string;
  let expiredSlotId: string;
  let liveSlotId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    const start = new Date(Date.now() + 48 * HOUR_MS);
    start.setUTCMinutes(0, 0, 0);
    world = await seedWorld(prisma, "v", start);
    token = await serviceToken(world.tenantId);
    liveSlotId = slotAt(world, 1);
    expiredSlotId = slotAt(world, 0);
    const command = {
      kind: "book" as const,
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      actor: ACTOR,
    };
    // Primero la vigente; despues la vencida con el reloj cinco horas atras
    // (el apartado dura 240 minutos), para que crearla no venza nada.
    await createRequest(prisma, clockAt(new Date()), { ...command, slotId: liveSlotId });
    await createRequest(prisma, clockAt(new Date(Date.now() - 5 * HOUR_MS)), {
      ...command,
      slotId: expiredSlotId,
    });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("parte de dos cupos apartados en la base", async () => {
    const slots = await prisma.slot.findMany({ where: { id: { in: [expiredSlotId, liveSlotId] } } });
    expect(slots.map((slot) => slot.status)).toEqual(["busy_tentative", "busy_tentative"]);
  });

  it("leer por id el cupo de un apartado vencido lo devuelve free", async () => {
    const expired = await fhirGet(`Slot/${expiredSlotId}`, token);
    expect(expired.body.status).toBe("free");

    const live = await fhirGet(`Slot/${liveSlotId}`, token);
    expect(live.body.status).toBe("busy-tentative");

    const request = await prisma.appointmentRequest.findFirstOrThrow({
      where: { slotId: expiredSlotId },
    });
    expect(request.status).toBe("expired");
  });

  it("buscar cupos tambien vence antes de responder", async () => {
    const tentative = await fhirGet("Slot?status=busy-tentative", token);
    expect(tentative.body.entry.map((entry: { resource: { id: string } }) => entry.resource.id)).toEqual([
      liveSlotId,
    ]);

    const free = await fhirGet(`Slot?status=free&schedule=Schedule/${world.scheduleId}`, token);
    expect(
      free.body.entry.map((entry: { resource: { id: string } }) => entry.resource.id),
    ).toContain(expiredSlotId);
  });

  it("no hay ningun Appointment propuesto para la solicitud vencida", async () => {
    const { body } = await fhirGet(`Appointment?slot=Slot/${expiredSlotId}`, token);
    expect(body.total).toBe(0);
  });
});
```

- [ ] **Step 4: Correr el test de vencimiento**

Run: `npm --prefix backend exec -- vitest run --project db tests/db/fhir-vencimiento.test.ts`
Expected: PASS, 4 tests. Si el cupo vencido sale `busy-tentative`, falta el `await expire(tenantId)` en la fuente `Slot` de `composition/fhir-wiring.ts` (Tarea 6).

- [ ] **Step 5: Lint y commit**

Run: `npm --prefix backend run lint`
Expected: sin errores en los dos archivos.

```bash
git add backend/tests/db/aislamiento-tenant-fhir.test.ts backend/tests/db/fhir-vencimiento.test.ts
git commit -m "test(fhir): aislamiento por tenant y vencimiento al leer sobre /fhir"
```

---

### Task 8: Documentación, política y puertas de cierre

**Files:**
- Modify: `GOBERNANZA.md` (§2.2 y §3)
- Modify: `README.md` (estado, variables, mapa del código, suites)
- Modify: `backend/AGENTS.md` (mapa, «Las dos superficies», sección FHIR nueva)
- Modify: `.env.example`, `backend/.env.example`, `docker-compose.yml`
- Modify: `docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md` (línea de estado)

No se tocan `CLAUDE.md`, `ROADMAP.md`, `PRODUCT.md` ni `docs/brief.md`.

- [ ] **Step 1: `GOBERNANZA.md` §2.2**

Después del párrafo que empieza con «`conversation` solo importa `shared`, `auth` y `verification/domain`» añade un párrafo nuevo:

```markdown

`fhir` solo importa `shared` y `auth`, y ningún módulo importa `fhir`. Declara sus propios
puertos de lectura (`fhir/domain/ports/sources.ts`) y `composition/fhir-wiring.ts` los cumple
con `scheduling` y `patients`. No tiene `infrastructure/`: no hace I/O propio.
```

- [ ] **Step 2: `GOBERNANZA.md` §3**

En la tabla de superficies, cambia la fila de FHIR por:

```markdown
| FHIR R4 `/fhir` | Hermes (solo rol `service`, en lectura y escritura) | `OperationOutcome` con `application/fhir+json` |
```

En §3.1, al final de la lista de reglas, añade:

```markdown
- `/fhir` es exclusivo del rol `service`. `operator`, `admin` y `widget` reciben `403`, también
  en lectura. La única ruta pública es `GET /fhir/metadata`.
- Autenticación y rol se comprueban **antes** de enrutar: sin token `service`, ninguna ruta de
  `/fhir` responde `404`, para que no se pueda sondear qué recursos existen.
- El registro de recursos (`fhir/domain/registry.ts`) es la única fuente de qué se puede leer
  y buscar: de ahí salen la validación de parámetros y `metadata`.
- Un parámetro de búsqueda que el recurso no declara responde `400`; no se ignora.
```

- [ ] **Step 3: `README.md`**

1. Cambia el bloque de estado (las líneas que empiezan con `> Estado:`) por:

```markdown
> Estado: Fases 1, 2 y 3 cerradas. La Fase 4 (FHIR e integración con Hermes) va en cuatro
> sub-proyectos: la 4.1 deja `/fhir` en solo lectura (`read` y `search` de `Patient`,
> `Practitioner`, `HealthcareService`, `Schedule`, `Slot` y `Appointment`, más
> `GET /fhir/metadata`). Siguen la 4.2 (escritura de maestros), la 4.3 (pre-agenda por FHIR) y
> la 4.4 (simulador por FHIR).
```

2. En la tabla de variables, después de la fila de `TRUST_PROXY`, añade:

```markdown
| `FHIR_BASE_URL` | backend | Base pública de `/fhir` (p. ej. `https://api.clinica.com/fhir`) para los enlaces y `fullUrl` de los `Bundle`. Opcional: sin ella se usa el origen de la petición, que detrás de un proxy puede ser interno |
```

3. En el «Mapa del código», después de la línea de `src/http/`, añade:

```
  src/app/fhir/[[...path]]/   # unica ruta de /fhir; despacha contra el registro de recursos
  src/modules/fhir/           # perfiles, mappers, busqueda y registro FHIR (sin infrastructure)
```

4. En la tabla «Suites actuales», después de la fila de `sin-ia`, añade:

```markdown
| `fhir-conformance` | Forma R4 de los recursos, búsqueda y paginación, `OperationOutcome`, `metadata` igual a lo implementado y vencimiento al leer en `Slot` |
```

5. Después de la sección de variables y antes de «Mapa del código», añade:

````markdown
## FHIR

`/fhir` es la superficie de Hermes: R4, solo JSON y solo rol `service`. En la 4.1 es de
lectura.

```bash
curl http://localhost:3001/fhir/metadata                 # publico: que existe
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/fhir/Slot?status=free&start=ge2026-06-15&_count=20"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/fhir/Patient/<id>
```

El token `service` se emite por `/api/platform/v1/tokens` (o `npm --prefix backend run token:dev`
en local). Los errores son `OperationOutcome` con `application/fhir+json`; un parámetro de
búsqueda no declarado en `metadata` responde `400`.
````

- [ ] **Step 4: `backend/AGENTS.md`**

1. En el bloque «Dónde va cada cosa», cambia la línea de `src/http/` y añade la de `src/app/fhir`:

```
src/app/fhir/[[...path]]/ Única ruta de /fhir. Despacha contra el registro de recursos.
src/http/                 Glue de los adaptadores HTTP: envoltura de errores REST, X-Request-Id,
                          envoltorios de ruta (REST y FHIR), fuente del OpenAPI. No es dominio.
```

2. Cambia la sección «Las dos superficies» por:

```markdown
## Las dos superficies

`/api/v1` responde errores como `{ error: { code, message, request_id, details } }` con
cabecera `X-Request-Id`. `/fhir` responde `OperationOutcome` con `application/fhir+json`
(`src/http/fhir-route.ts`). **Nunca se mezclan:** `fhir-route.ts` no importa `errors.ts`.

## Al añadir un recurso o un parámetro de búsqueda FHIR

1. Los literales (systems, tags, value sets) van en `src/modules/fhir/domain/profiles.ts` y en
   ningún otro archivo.
2. Un mapper por recurso en `src/modules/fhir/domain/mappers/`; no se unifican.
3. Declara el recurso y sus parámetros en `src/modules/fhir/domain/registry.ts`. De ahí salen
   la validación de parámetros y `GET /fhir/metadata`: no se edita `metadata` por separado.
4. `fhir` no importa `scheduling` ni `patients`: añade el puerto en
   `fhir/domain/ports/sources.ts` y cúmplelo en `src/composition/fhir-wiring.ts`.
5. La suite `fhir-conformance` recorre `metadata` y exige un valor de muestra por parámetro
   (`tests/db/fhir-conformance-http.test.ts`, función `sampleValue`).
```

- [ ] **Step 5: Ejemplos de entorno y compose**

En `.env.example` (raíz) y en `backend/.env.example`, después de la línea `TRUST_PROXY=false`, añade:

```
# Base publica de /fhir para los enlaces de los Bundle. Vacia: el origen de la peticion.
FHIR_BASE_URL=
```

En `docker-compose.yml`, en el `environment` del backend, después de la línea `TRUST_PROXY: ${TRUST_PROXY:-false}`, añade con la misma sangría:

```yaml
      FHIR_BASE_URL: ${FHIR_BASE_URL:-}
```

- [ ] **Step 6: Estado de la spec**

En `docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md` cambia `> Estado: **en diseño**.` por:

```markdown
> Estado: **implementada** en la rama `fase-4-1-fhir-base-lectura`, pendiente de merge.
```

- [ ] **Step 7: Puertas de cierre**

Run: `npm run typecheck`
Expected: sin errores en backend ni frontend.

Run: `npm --prefix backend run lint`
Expected: sin errores.

Run: `npm --prefix backend test`
Expected: PASS toda la suite `unit`.

Run: `npm --prefix backend run test:db`
Expected: PASS toda la suite `db`, incluidos `fhir-directorio`, `fhir-directorio-pacientes`, `fhir-conformance-http`, `aislamiento-tenant-fhir` y `fhir-vencimiento`.

Run: `git status --short`
Expected: solo los archivos de esta tarea por commitear, más `CLAUDE.md`, `PRODUCT.md`, `ROADMAP.md` y `docs/brief.md` modificados por el usuario (no se añaden). `backend/openapi.json` sin cambios.

Run: `wc -l backend/src/composition-root.ts backend/src/modules/fhir/domain/*.ts backend/src/modules/scheduling/infrastructure/prisma-scheduling-directory.ts`
Expected: ningún archivo por encima de 400 líneas.

- [ ] **Step 8: Commit**

```bash
git add GOBERNANZA.md README.md backend/AGENTS.md .env.example backend/.env.example docker-compose.yml docs/superpowers/specs/2026-10-13-fase-4-1-fhir-base-lectura-design.md
git commit -m "docs: politica y guia de la superficie /fhir (Fase 4.1)"
```
