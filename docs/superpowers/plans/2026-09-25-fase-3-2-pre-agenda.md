# Fase 3.2 — Pre-agenda: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solicitudes de agenda (`book` · `reschedule` · `cancel`) con apartado atómico de cupo, vencimiento al leer, tope de pendientes y una bandeja del simulador que las aprueba o rechaza dejando `public` y `hermes_sim` coherentes.

**Architecture:** Se amplía el módulo `scheduling` con una entidad `AppointmentRequest`, funciones puras de dominio, un puerto `PreAgendaStore` (se usa dentro de la transacción del llamador) y casos de uso de creación, resolución, vencimiento y lectura. El simulador declara su propio puerto `ChatbotRequestsGateway`; `composition/pre-agenda-wiring.ts` lo cumple llamando en proceso a los casos de uso de `scheduling`. En la Fase 4 ese adaptador se cambia por un cliente FHIR.

**Tech Stack:** Next.js 16 (route handlers), Prisma 7 + Postgres (adaptador `@prisma/adapter-pg`), Vitest 5 (proyectos `unit` y `db`), Biome 2, orval.

**Spec:** `docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md`

## Global Constraints

- Sin IA: ninguna dependencia ni import de LLM, embeddings, vectores o n8n.
- Hermes es la fuente de verdad: el chatbot nunca crea una cita `booked` salvo dentro de `resolveAppointmentRequest` con un identificador que da Hermes.
- `tenant_id` solo del claim del JWT. Recurso de otro tenant → `404`, nunca `403`.
- Toda escritura HTTP exige `Idempotency-Key` persistida en base de datos (`idempotentRoute`).
- `audit_events` registra el hecho, nunca valores; ningún dato clínico en la bandeja.
- `domain` y `application` no importan `next`, `@prisma/client`, `node:*` ni `react`.
- `scheduling` no importa `bot-config`; `hermes-simulator` solo importa `shared` y `auth` de otros módulos; ningún módulo del chatbot importa `hermes-simulator`.
- `process.env` solo en `backend/src/config/env.ts`.
- Clean Code: complejidad cognitiva ≤ 15, ≤ 40 líneas por función (sin blancos), ≤ 400 líneas por archivo de lógica, 0 ciclos. `composition-root.ts` va por 369 líneas: todo cableado nuevo va en `composition/pre-agenda-wiring.ts`; `hermes-simulator/infrastructure/prisma-stores.ts` va por 396: el almacén de la bandeja es un archivo nuevo.
- Código, rutas y campos en inglés; comentarios y mensajes en español.
- `openapi.json` y `openapi-sim.json` son generados: se edita `src/http/openapi*.ts` y se corre `npm --prefix backend run openapi:generate`; el cliente del frontend se regenera con `npm --prefix frontend run api:generate`, nunca a mano.
- Params nuevos de `bot-config`: `request_hold_minutes` 240 (15–4320) y `max_pending_requests_per_patient` 2 (1–5).
- `expires_at = min(now + request_hold_minutes, start_at del cupo)`; en `cancel`, `now + request_hold_minutes`.
- El tope cuenta solo solicitudes `book` y `reschedule` vivas (`pending` y `expires_at > now`) por historia clínica.
- Motivos de `409 conflict` (`details.reason`): `slot_unavailable`, `pending_limit_reached`, `appointment_change_pending`, `request_not_pending`, `patient_not_in_hermes`, `appointment_not_in_hermes`. Sin códigos de error nuevos.
- **Rama `fase-3-2-pre-agenda`.** Commitear solo los archivos de cada tarea con `git add <rutas>`; nunca `git add -A`, `git stash`, `git checkout --` ni `reset`. No hacer merge a `main` ni abrir PR: lo hace el usuario.

## Refinamientos sobre la spec

La Tarea 1 los deja escritos en la spec (§13). Salen de leer el código al planificar:

1. **Sin `PreAgendaUnitOfWork` propio.** Toda escritura ya corre dentro de `withWriteTransaction` y Prisma no anida transacciones interactivas. `PreAgendaStore` se construye sobre el ejecutor de esa transacción y el caso de uso empieza con `lockMedicalRecord` (`SELECT … FOR UPDATE`).
2. **Un solo `expireDue(tenantId, now, scope?)`** con `scope` `{ slotId }` o `{ appointmentId }` en vez de `expireDueOnSlot` / `expireDueOnAppointment`.
3. **Resolver una solicitud vencida** responde `409 request_not_pending` (`details.status = "expired"`) sin persistir el vencimiento: el error revierte la transacción y la siguiente lectura la vence.
4. **Bandeja en una sola transacción.** En la 3.2 la escritura de `hermes_sim` y `resolveAppointmentRequest` comparten la transacción de `withWriteTransaction`; si el chatbot responde `request_not_pending`, la reversión deshace lo escrito en `hermes_sim` sin compensación manual. En la Fase 4 (HTTP) hará falta compensar.
5. **Errores añadidos:** `appointment_not_in_hermes` (el simulador no conoce la cita a cancelar o reprogramar) y cita de otro paciente del mismo tenant → `404` (no revela que existe).
6. **FK compuestas opcionales.** Prisma 7 acepta `slot Slot? @relation(fields: [tenantId, slotId], …)`; se usan con `onDelete: Restrict`. `appointments` gana `@@unique([tenantId, id])` para poder referenciarla.

## Review Focus

- **Dos resoluciones simultáneas de la misma solicitud** (doble clic en la bandeja con claves distintas): se espera una `approved` y la otra `409 request_not_pending`, con una sola cita creada. Test en la Tarea 4.
- **Apartado vencido pero aún `pending` en la base**: otro paciente pide ese cupo; se espera que la creación venza el apartado viejo y aparte el cupo para el nuevo, sin `slot_unavailable`. Test en la Tarea 3.
- **Reprogramar hacia un cupo ocupado**: se espera `409 slot_unavailable` y la cita original intacta, sin solicitud creada. Test en la Tarea 3.
- **La bandeja nunca muestra solicitudes vencidas**: con una vencida y una viva, `GET /inbox` devuelve solo la viva y la vencida queda `expired` con su cupo `free`. Test en la Tarea 5.
- **Cursor manipulado en la bandeja**: se espera `422 validation_failed`, nunca `500`. Test en la Tarea 6.

---

### Task 1: Esquema, migración y refinamientos de la spec

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_fase3_2_pre_agenda/migration.sql` (generada y ampliada)
- Modify: `backend/prisma/seed/write-chatbot.ts:17-24` (borrar solicitudes antes que citas y cupos)
- Create: `backend/tests/db/pre-agenda-support.ts`
- Create: `backend/tests/db/pre-agenda-esquema.test.ts`
- Modify: `docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md` (§13 nueva)

**Interfaces:**
- Produces: modelo Prisma `AppointmentRequest` (`db.appointmentRequest`), enums `AppointmentRequestKind`, `AppointmentRequestStatus`, `ResolutionReason`; helpers de prueba `seedWorld(prisma, slug, start, options?) → World`, `slotAt(world, i) → string`, `extraPatients(prisma, world, n) → string[]`, `HOUR_MS`.

- [ ] **Step 1: Añadir enums y modelo al esquema**

En `backend/prisma/schema.prisma`, después del enum `DocumentType` (schema `public`), añade:

```prisma
enum AppointmentRequestKind {
  book
  reschedule
  cancel

  @@map("appointment_request_kind")
  @@schema("public")
}

enum AppointmentRequestStatus {
  pending
  approved
  rejected
  expired

  @@map("appointment_request_status")
  @@schema("public")
}

enum ResolutionReason {
  slot_unavailable
  declined

  @@map("resolution_reason")
  @@schema("public")
}
```

Después del modelo `Appointment`, añade:

```prisma
// Solicitud de agenda originada por el chatbot. La resuelve Hermes; el chatbot nunca
// confirma por su cuenta. CHECK de forma e indices unicos parciales en la migracion.
model AppointmentRequest {
  id                     String                   @id
  tenantId               String                   @map("tenant_id")
  kind                   AppointmentRequestKind
  status                 AppointmentRequestStatus @default(pending)
  medicalRecordId        String                   @map("medical_record_id")
  slotId                 String?                  @map("slot_id")
  appointmentId          String?                  @map("appointment_id")
  expiresAt              DateTime                 @map("expires_at") @db.Timestamptz(3)
  resolutionReason       ResolutionReason?        @map("resolution_reason")
  resultingAppointmentId String?                  @map("resulting_appointment_id")
  createdAt              DateTime                 @map("created_at") @db.Timestamptz(3)
  resolvedAt             DateTime?                @map("resolved_at") @db.Timestamptz(3)

  tenant               Tenant        @relation(fields: [tenantId], references: [id])
  medicalRecord        MedicalRecord @relation(fields: [tenantId, medicalRecordId], references: [tenantId, id])
  slot                 Slot?         @relation(fields: [tenantId, slotId], references: [tenantId, id], onDelete: Restrict)
  appointment          Appointment?  @relation("RequestTarget", fields: [tenantId, appointmentId], references: [tenantId, id], onDelete: Restrict)
  resultingAppointment Appointment?  @relation("RequestResult", fields: [tenantId, resultingAppointmentId], references: [tenantId, id], onDelete: Restrict)

  @@unique([tenantId, id])
  @@index([tenantId, status, expiresAt])
  @@index([tenantId, medicalRecordId, status])
  @@map("appointment_requests")
  @@schema("public")
}
```

Relaciones inversas:
- `model Tenant`: añade `appointmentRequests AppointmentRequest[]` junto a `appointments Appointment[]`.
- `model Slot`: añade `appointmentRequests AppointmentRequest[]` después de `appointments Appointment[]`.
- `model MedicalRecord`: añade `appointmentRequests AppointmentRequest[]` después de `appointments Appointment[]`.
- `model Appointment`: añade, después de `slot Slot @relation(...)`:

```prisma
  changeRequests AppointmentRequest[] @relation("RequestTarget")
  originRequests AppointmentRequest[] @relation("RequestResult")
```

  y, antes de `@@unique([tenantId, identifierSystem, identifierValue])`, `@@unique([tenantId, id])`.

- [ ] **Step 2: Validar y generar la migración**

Run: `npm --prefix backend exec prisma validate` → Expected: `The schema at prisma\schema.prisma is valid`.
Run: `npm --prefix backend exec prisma migrate dev -- --create-only --name fase3_2_pre_agenda` (usa `backend/.env`; Postgres local arriba).
Expected: se crea `backend/prisma/migrations/<timestamp>_fase3_2_pre_agenda/migration.sql`.

- [ ] **Step 3: Añadir CHECK e índices parciales al final de la migración**

Al final del `migration.sql` generado, añade:

```sql
-- Forma de cada tipo de solicitud.
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_kind_shape_check" CHECK (
  ("kind" = 'book' AND "slot_id" IS NOT NULL AND "appointment_id" IS NULL)
  OR ("kind" = 'reschedule' AND "slot_id" IS NOT NULL AND "appointment_id" IS NOT NULL)
  OR ("kind" = 'cancel' AND "slot_id" IS NULL AND "appointment_id" IS NOT NULL)
);
-- El motivo acompana solo al rechazo.
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_reason_check"
  CHECK (("resolution_reason" IS NOT NULL) = ("status" = 'rejected'));
-- Una sola solicitud viva por cupo y por cita: dos solicitudes concurrentes no pueden quedar pendientes sobre lo mismo.
CREATE UNIQUE INDEX "appointment_requests_one_pending_per_slot"
  ON "appointment_requests"("tenant_id", "slot_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "appointment_requests_one_pending_per_appointment"
  ON "appointment_requests"("tenant_id", "appointment_id") WHERE "status" = 'pending';
```

Run: `npm --prefix backend exec prisma migrate dev` → Expected: aplica la migración sin proponer otra; `npm --prefix backend run db:generate` → cliente regenerado.

- [ ] **Step 4: Borrar solicitudes antes que citas en el seed**

En `backend/prisma/seed/write-chatbot.ts`, dentro de `deleteExisting`, antes de `await tx.appointment.deleteMany(...)`:

```ts
  await tx.appointmentRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
```

y en el comentario de la función cambia `Orden de FK: citas -> cupos` por `Orden de FK: solicitudes -> citas -> cupos`.

- [ ] **Step 5: Crear el soporte de pruebas de la pre-agenda**

Create `backend/tests/db/pre-agenda-support.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import { HERMES_SYSTEM, insertTenant } from "./support";

export const HOUR_MS = 3_600_000;

export type World = {
  readonly slug: string;
  readonly tenantId: TenantId;
  readonly start: Date;
  readonly scheduleId: string;
  /** Cupos libres a start, start+1h, start+2h... (identificador `SL-<slug>-<i>`). */
  readonly freeSlotIds: readonly string[];
  /** Cupo ocupado por la cita en firme (identificador `SL-<slug>-booked`). */
  readonly bookedSlotId: string;
  /** Cita en firme (identificador `AP-<slug>`). */
  readonly appointmentId: string;
  /** Historia clinica (identificador `MR-<slug>`). */
  readonly medicalRecordId: string;
};

function at(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * HOUR_MS);
}

function slotTimes(start: Date, index: number) {
  return { startAt: at(start, index), endAt: at(start, index + 0.5) };
}

async function seedChatbot(prisma: PrismaClient, world: World, freeSlots: number): Promise<void> {
  const { tenantId, slug, start } = world;
  await prisma.practitioner.create({
    data: { id: `${tenantId}-prac`, tenantId, identifierSystem: HERMES_SYSTEM.practitioner, identifierValue: `P-${slug}`, name: `Prof ${slug}` },
  });
  await prisma.healthcareService.create({
    data: { id: `${tenantId}-svc`, tenantId, identifierSystem: HERMES_SYSTEM.service, identifierValue: `S-${slug}`, name: `Serv ${slug}` },
  });
  await prisma.schedule.create({
    data: { id: world.scheduleId, tenantId, identifierSystem: HERMES_SYSTEM.schedule, identifierValue: `SCH-${slug}`, practitionerId: `${tenantId}-prac`, healthcareServiceId: `${tenantId}-svc` },
  });
  for (let i = 0; i < freeSlots; i++) {
    await prisma.slot.create({
      data: { id: `${tenantId}-slot-${i}`, tenantId, identifierSystem: HERMES_SYSTEM.slot, identifierValue: `SL-${slug}-${i}`, scheduleId: world.scheduleId, status: "free", ...slotTimes(start, i) },
    });
  }
  await prisma.slot.create({
    data: { id: world.bookedSlotId, tenantId, identifierSystem: HERMES_SYSTEM.slot, identifierValue: `SL-${slug}-booked`, scheduleId: world.scheduleId, status: "busy", ...slotTimes(start, freeSlots) },
  });
  await prisma.medicalRecord.create({
    data: { id: world.medicalRecordId, tenantId, identifierSystem: HERMES_SYSTEM.patient, identifierValue: `MR-${slug}`, documentType: "CC", documentNumber: `1000${slug}`, givenNames: `Nombre ${slug}`, familyNames: `Apellido ${slug}`, birthDate: new Date("1990-01-15"), status: "active" },
  });
  await prisma.appointment.create({
    data: { id: world.appointmentId, tenantId, identifierSystem: HERMES_SYSTEM.appointment, identifierValue: `AP-${slug}`, medicalRecordId: world.medicalRecordId, scheduleId: world.scheduleId, slotId: world.bookedSlotId, status: "booked", ...slotTimes(start, freeSlots) },
  });
}

async function seedSimulator(prisma: PrismaClient, world: World, freeSlots: number): Promise<void> {
  const { tenantId, slug, start } = world;
  const sim = `sim-${tenantId}`;
  await prisma.simPractitioner.create({
    data: { id: `${sim}-prac`, tenantId, identifierSystem: HERMES_SYSTEM.practitioner, identifierValue: `P-${slug}`, name: `Prof ${slug}` },
  });
  await prisma.simHealthcareService.create({
    data: { id: `${sim}-svc`, tenantId, identifierSystem: HERMES_SYSTEM.service, identifierValue: `S-${slug}`, name: `Serv ${slug}` },
  });
  await prisma.simSchedule.create({
    data: { id: `${sim}-sched`, tenantId, identifierSystem: HERMES_SYSTEM.schedule, identifierValue: `SCH-${slug}`, practitionerId: `${sim}-prac`, healthcareServiceId: `${sim}-svc` },
  });
  for (let i = 0; i < freeSlots; i++) {
    await prisma.simSlot.create({
      data: { id: `${sim}-slot-${i}`, tenantId, identifierSystem: HERMES_SYSTEM.slot, identifierValue: `SL-${slug}-${i}`, scheduleId: `${sim}-sched`, status: "free", ...slotTimes(start, i) },
    });
  }
  await prisma.simSlot.create({
    data: { id: `${sim}-slot-booked`, tenantId, identifierSystem: HERMES_SYSTEM.slot, identifierValue: `SL-${slug}-booked`, scheduleId: `${sim}-sched`, status: "busy", ...slotTimes(start, freeSlots) },
  });
  await prisma.simPatient.create({
    data: { id: `${sim}-pat`, tenantId, identifierSystem: HERMES_SYSTEM.patient, identifierValue: `MR-${slug}`, documentType: "CC", documentNumber: `1000${slug}`, givenNames: `Nombre ${slug}`, familyNames: `Apellido ${slug}`, birthDate: new Date("1990-01-15"), status: "active" },
  });
  await prisma.simAppointment.create({
    data: { id: `${sim}-appt`, tenantId, identifierSystem: HERMES_SYSTEM.appointment, identifierValue: `AP-${slug}`, patientId: `${sim}-pat`, scheduleId: `${sim}-sched`, slotId: `${sim}-slot-booked`, status: "booked", ...slotTimes(start, freeSlots) },
  });
}

/** Mundo coherente: los mismos maestros en public y en hermes_sim, con los mismos identificadores. */
export async function seedWorld(
  prisma: PrismaClient,
  slug: string,
  start: Date,
  options: { freeSlots?: number } = {},
): Promise<World> {
  const freeSlots = options.freeSlots ?? 3;
  const tenantId = toTenantId(await insertTenant(prisma, slug));
  const world: World = {
    slug,
    tenantId,
    start,
    scheduleId: `${tenantId}-sched`,
    freeSlotIds: Array.from({ length: freeSlots }, (_, i) => `${tenantId}-slot-${i}`),
    bookedSlotId: `${tenantId}-slot-booked`,
    appointmentId: `${tenantId}-appt`,
    medicalRecordId: `${tenantId}-mr`,
  };
  await seedChatbot(prisma, world, freeSlots);
  await seedSimulator(prisma, world, freeSlots);
  return world;
}

/** Id del cupo libre i-esimo; falla si el mundo no tiene tantos. */
export function slotAt(world: World, index: number): string {
  const id = world.freeSlotIds[index];
  if (id === undefined) {
    throw new Error(`El mundo ${world.slug} no tiene cupo libre ${index}`);
  }
  return id;
}

/** Historias clinicas adicionales (solo en public) para pruebas de concurrencia. */
export async function extraPatients(prisma: PrismaClient, world: World, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${world.tenantId}-mr-x${i}`;
    await prisma.medicalRecord.create({
      data: { id, tenantId: world.tenantId, identifierSystem: HERMES_SYSTEM.patient, identifierValue: `MR-${world.slug}-x${i}`, documentType: "CC", documentNumber: `2000${i}${world.slug}`, givenNames: `Extra ${i}`, familyNames: "Prueba", birthDate: new Date("1991-02-01"), status: "active" },
    });
    ids.push(id);
  }
  return ids;
}
```

Si Biome parte las líneas largas al formatear, déjalo: `npm --prefix backend exec biome format --write tests/db/pre-agenda-support.ts`.

- [ ] **Step 6: Escribir las pruebas del esquema**

Create `backend/tests/db/pre-agenda-esquema.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedWorld, slotAt, type World } from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const START = new Date("2026-06-15T14:00:00.000Z");
const EXPIRES = new Date("2026-06-15T12:00:00.000Z");
const CREATED = new Date("2026-06-15T08:00:00.000Z");

function request(world: World, id: string, overrides: Record<string, unknown>) {
  return prisma.appointmentRequest.create({
    data: {
      id,
      tenantId: world.tenantId,
      kind: "book",
      medicalRecordId: world.medicalRecordId,
      slotId: slotAt(world, 0),
      expiresAt: EXPIRES,
      createdAt: CREATED,
      ...overrides,
    },
  });
}

describe("pre-agenda: esquema de appointment_requests", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll(prisma);
    world = await seedWorld(prisma, "a", START);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dos solicitudes pendientes no pueden apartar el mismo cupo", async () => {
    await request(world, "r1", {});
    await expect(request(world, "r2", {})).rejects.toThrow();
  });

  it("una resuelta no bloquea una nueva pendiente sobre el mismo cupo", async () => {
    await request(world, "r1", { status: "expired", resolvedAt: EXPIRES });
    await expect(request(world, "r2", {})).resolves.toMatchObject({ id: "r2" });
  });

  it("una cita admite una sola solicitud de cambio pendiente", async () => {
    const cancel = { kind: "cancel", slotId: null, appointmentId: world.appointmentId };
    await request(world, "r1", cancel);
    await expect(
      request(world, "r2", { kind: "reschedule", appointmentId: world.appointmentId }),
    ).rejects.toThrow();
  });

  it("rechaza formas invalidas por tipo", async () => {
    await expect(request(world, "r1", { kind: "cancel", appointmentId: world.appointmentId })).rejects.toThrow();
    await expect(request(world, "r2", { kind: "book", appointmentId: world.appointmentId })).rejects.toThrow();
    await expect(request(world, "r3", { kind: "reschedule" })).rejects.toThrow();
  });

  it("el motivo solo acompana al rechazo", async () => {
    await expect(request(world, "r1", { status: "rejected" })).rejects.toThrow();
    await expect(request(world, "r2", { resolutionReason: "declined" })).rejects.toThrow();
    await expect(
      request(world, "r3", { status: "rejected", resolutionReason: "declined", resolvedAt: EXPIRES }),
    ).resolves.toMatchObject({ id: "r3" });
  });

  it("no referencia cupos de otro tenant", async () => {
    const other = await seedWorld(prisma, "b", START);
    await expect(request(world, "r1", { slotId: slotAt(other, 0) })).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm --prefix backend exec vitest run --project db tests/db/pre-agenda-esquema.test.ts`
Expected: PASS (6 tests). Si falla «no referencia cupos de otro tenant», la FK compuesta no se creó: revisa el Step 1.

Run: `npm --prefix backend exec vitest run --project db tests/db/simetria-seed.test.ts`
Expected: PASS (el seed sigue borrando en orden de FK).

- [ ] **Step 8: Documentar los refinamientos en la spec**

Al final de `docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md`, añade:

```markdown
## 13. Refinamientos al planificar

Salen de leer el código al escribir el plan (`docs/superpowers/plans/2026-09-25-fase-3-2-pre-agenda.md`);
mandan sobre el texto anterior donde choquen.

1. **Sin `PreAgendaUnitOfWork` propio.** Toda escritura ya corre dentro de `withWriteTransaction` y Prisma
   no anida transacciones interactivas. `PreAgendaStore` se construye sobre el ejecutor de esa
   transacción y la creación empieza con `lockMedicalRecord` (`SELECT … FOR UPDATE`).
2. **Un solo `expireDue(tenantId, now, scope?)`**, con `scope` `{ slotId }` o `{ appointmentId }`, en
   vez de `expireDueOnSlot` / `expireDueOnAppointment`. `RequestExpirer` es ese método.
3. **Resolver una solicitud vencida** responde `409 request_not_pending` con `details.status = "expired"`
   sin persistir el vencimiento: el error revierte la transacción y la siguiente lectura la vence.
4. **Bandeja en una sola transacción.** En la 3.2 la escritura de `hermes_sim` y
   `resolveAppointmentRequest` comparten la transacción; si el chatbot responde `request_not_pending`,
   la reversión deshace lo escrito en `hermes_sim` sin compensación manual. En la Fase 4 (HTTP) hará
   falta compensar.
5. **Errores añadidos:** `409 appointment_not_in_hermes` (el simulador no conoce la cita a cancelar o
   reprogramar) y cita de otro paciente del mismo tenant → `404`.
6. **FK compuestas opcionales** con `onDelete: Restrict`; `appointments` gana `@@unique([tenantId, id])`.
```

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/prisma/seed/write-chatbot.ts backend/tests/db/pre-agenda-support.ts backend/tests/db/pre-agenda-esquema.test.ts docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md
git commit -m "feat(scheduling): tabla appointment_requests con apartado unico por cupo y cita"
```

---

### Task 2: Dominio de la solicitud y parámetros de `bot-config`

**Files:**
- Create: `backend/src/modules/scheduling/domain/appointment-request.ts`
- Modify: `backend/src/modules/bot-config/domain/bot-config.ts` (`PARAM_SPECS`)
- Create: `backend/tests/dominio/pre-agenda.test.ts`
- Modify: `backend/tests/dominio/bot-config.test.ts:21-26` y el test «los rangos de los params coinciden con la spec»

**Interfaces:**
- Consumes: `Slot`, `Schedule`, `Appointment`, `SlotStatus`, `AppointmentStatus`, `HermesIdentifier` de `scheduling/domain/entities.ts`.
- Produces:
  - Tipos `AppointmentRequestKind`, `AppointmentRequestStatus`, `ResolutionReason`, `PreAgendaConflictReason`, `AppointmentRequest`, `Resolution`, `SlotChange`, `AppointmentChange`, `ResolutionEffects`.
  - `preAgendaConflict(reason, message, extra?) → ConflictError`
  - `computeExpiresAt(now: Date, holdMinutes: number, slotStart: Date | null) → Date`
  - `isLive(request: Pick<AppointmentRequest, "status" | "expiresAt">, now: Date) → boolean`
  - `assertSlotBookable(slot: Slot, schedule: Schedule, now: Date) → void`
  - `assertAppointmentChangeable(appointment: Appointment, medicalRecordId: string, now: Date) → void`
  - `assertBelowPendingCap(liveHolds: number, max: number) → void`
  - `resolutionEffects(request: Pick<AppointmentRequest, "kind" | "slotId" | "appointmentId">, targetSlotId: string | null, outcome: "approved" | "released") → ResolutionEffects`
  - `PARAM_SPECS.request_hold_minutes`, `PARAM_SPECS.max_pending_requests_per_patient`.

- [ ] **Step 1: Escribir las pruebas del dominio**

Create `backend/tests/dominio/pre-agenda.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertAppointmentChangeable,
  assertBelowPendingCap,
  assertSlotBookable,
  computeExpiresAt,
  isLive,
  resolutionEffects,
} from "@/modules/scheduling/domain/appointment-request";
import type { Appointment, Schedule, Slot } from "@/modules/scheduling/domain/entities";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const ID = { system: "urn:hermes:slot", value: "S1" };

const slot = (overrides: Partial<Slot> = {}): Slot => ({
  id: "slot-1",
  tenantId: "t",
  identifier: ID,
  scheduleId: "sched-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "free",
  ...overrides,
});

const schedule = (active = true): Schedule => ({
  id: "sched-1",
  tenantId: "t",
  identifier: ID,
  practitionerId: "p",
  healthcareServiceId: "s",
  active,
});

const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: "appt-1",
  tenantId: "t",
  identifier: ID,
  medicalRecordId: "mr-1",
  scheduleId: "sched-1",
  slotId: "slot-old",
  startAt: new Date("2026-06-16T14:00:00.000Z"),
  endAt: new Date("2026-06-16T14:30:00.000Z"),
  status: "booked",
  ...overrides,
});

describe("dominio: pre-agenda", () => {
  it("el apartado dura el plazo del tenant", () => {
    expect(computeExpiresAt(NOW, 240, new Date("2026-06-16T00:00:00.000Z"))).toEqual(
      new Date("2026-06-15T12:00:00.000Z"),
    );
  });

  it("el apartado nunca sobrevive al inicio del cupo", () => {
    const start = new Date("2026-06-15T09:00:00.000Z");
    expect(computeExpiresAt(NOW, 240, start)).toEqual(start);
  });

  it("sin cupo (cancelacion) vence solo por plazo", () => {
    expect(computeExpiresAt(NOW, 15, null)).toEqual(new Date("2026-06-15T08:15:00.000Z"));
  });

  it("viva = pendiente y antes del vencimiento", () => {
    const expiresAt = new Date("2026-06-15T09:00:00.000Z");
    expect(isLive({ status: "pending", expiresAt }, NOW)).toBe(true);
    expect(isLive({ status: "pending", expiresAt }, expiresAt)).toBe(false);
    expect(isLive({ status: "approved", expiresAt }, NOW)).toBe(false);
  });

  it("cupo libre, futuro y de agenda activa es apartable", () => {
    expect(() => assertSlotBookable(slot(), schedule(), NOW)).not.toThrow();
  });

  it("cupo de agenda inactiva o ya empezado es 422", () => {
    expect(() => assertSlotBookable(slot(), schedule(false), NOW)).toThrow(ValidationError);
    expect(() => assertSlotBookable(slot({ startAt: NOW }), schedule(), NOW)).toThrow(ValidationError);
  });

  it("cupo no libre es 409 slot_unavailable", () => {
    for (const status of ["busy", "busy_tentative", "busy_unavailable"] as const) {
      expect(() => assertSlotBookable(slot({ status }), schedule(), NOW)).toThrow(
        expect.objectContaining({ details: { reason: "slot_unavailable" } }),
      );
    }
  });

  it("cita en firme, futura y del paciente es modificable", () => {
    expect(() => assertAppointmentChangeable(appointment(), "mr-1", NOW)).not.toThrow();
  });

  it("cita de otro paciente es 404; cancelada o pasada es 422", () => {
    expect(() => assertAppointmentChangeable(appointment(), "mr-2", NOW)).toThrow(NotFoundError);
    expect(() =>
      assertAppointmentChangeable(appointment({ status: "cancelled" }), "mr-1", NOW),
    ).toThrow(ValidationError);
    expect(() =>
      assertAppointmentChangeable(appointment({ startAt: NOW }), "mr-1", NOW),
    ).toThrow(ValidationError);
  });

  it("el tope de pendientes es 409 pending_limit_reached", () => {
    expect(() => assertBelowPendingCap(1, 2)).not.toThrow();
    expect(() => assertBelowPendingCap(2, 2)).toThrow(ConflictError);
    expect(() => assertBelowPendingCap(2, 2)).toThrow(
      expect.objectContaining({ details: { reason: "pending_limit_reached", max: 2 } }),
    );
  });

  it("efectos de book", () => {
    const book = { kind: "book", slotId: "new", appointmentId: null } as const;
    expect(resolutionEffects(book, null, "approved")).toEqual({
      slots: [{ slotId: "new", status: "busy" }],
      appointments: [],
      bookedSlotId: "new",
    });
    expect(resolutionEffects(book, null, "released")).toEqual({
      slots: [{ slotId: "new", status: "free" }],
      appointments: [],
      bookedSlotId: null,
    });
  });

  it("efectos de reschedule", () => {
    const reschedule = { kind: "reschedule", slotId: "new", appointmentId: "appt" } as const;
    expect(resolutionEffects(reschedule, "old", "approved")).toEqual({
      slots: [
        { slotId: "old", status: "free" },
        { slotId: "new", status: "busy" },
      ],
      appointments: [{ appointmentId: "appt", status: "cancelled" }],
      bookedSlotId: "new",
    });
    expect(resolutionEffects(reschedule, "old", "released")).toEqual({
      slots: [{ slotId: "new", status: "free" }],
      appointments: [],
      bookedSlotId: null,
    });
  });

  it("efectos de cancel", () => {
    const cancel = { kind: "cancel", slotId: null, appointmentId: "appt" } as const;
    expect(resolutionEffects(cancel, "old", "approved")).toEqual({
      slots: [{ slotId: "old", status: "free" }],
      appointments: [{ appointmentId: "appt", status: "cancelled" }],
      bookedSlotId: null,
    });
    expect(resolutionEffects(cancel, "old", "released")).toEqual({
      slots: [],
      appointments: [],
      bookedSlotId: null,
    });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm --prefix backend exec vitest run tests/dominio/pre-agenda.test.ts`
Expected: FAIL — no se puede resolver `@/modules/scheduling/domain/appointment-request`.

- [ ] **Step 3: Implementar el dominio**

Create `backend/src/modules/scheduling/domain/appointment-request.ts`:

```ts
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type {
  Appointment,
  AppointmentStatus,
  HermesIdentifier,
  Schedule,
  Slot,
  SlotStatus,
} from "./entities";

export type AppointmentRequestKind = "book" | "reschedule" | "cancel";
export type AppointmentRequestStatus = "pending" | "approved" | "rejected" | "expired";
export type ResolutionReason = "slot_unavailable" | "declined";

/** Motivos de `409 conflict` (`details.reason`). Estables: el motor conversacional los ramifica. */
export type PreAgendaConflictReason =
  | "slot_unavailable"
  | "pending_limit_reached"
  | "appointment_change_pending"
  | "request_not_pending";

/** Solicitud originada por el chatbot. Hermes la resuelve; el chatbot nunca confirma. */
export type AppointmentRequest = {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: AppointmentRequestKind;
  readonly status: AppointmentRequestStatus;
  readonly medicalRecordId: string;
  readonly slotId: string | null;
  readonly appointmentId: string | null;
  readonly expiresAt: Date;
  readonly resolutionReason: ResolutionReason | null;
  readonly resultingAppointmentId: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
};

/** Decision de Hermes. En `cancel` el identificador se ignora. */
export type Resolution =
  | { readonly outcome: "approved"; readonly appointmentIdentifier: HermesIdentifier }
  | { readonly outcome: "rejected"; readonly reason: ResolutionReason };

export type SlotChange = { readonly slotId: string; readonly status: SlotStatus };
export type AppointmentChange = {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
};

/** Cambios sobre cupos y citas al resolver; `bookedSlotId` es el cupo de la cita nueva. */
export type ResolutionEffects = {
  readonly slots: readonly SlotChange[];
  readonly appointments: readonly AppointmentChange[];
  readonly bookedSlotId: string | null;
};

const MINUTE_MS = 60_000;

export function preAgendaConflict(
  reason: PreAgendaConflictReason,
  message: string,
  extra: Record<string, unknown> = {},
): ConflictError {
  return new ConflictError(message, { reason, ...extra });
}

/** Plazo del tenant, recortado al inicio del cupo: un apartado nunca sobrevive a la cita. */
export function computeExpiresAt(now: Date, holdMinutes: number, slotStart: Date | null): Date {
  const byHold = new Date(now.getTime() + holdMinutes * MINUTE_MS);
  return slotStart !== null && slotStart < byHold ? slotStart : byHold;
}

/** Viva = pendiente y antes del vencimiento, este o no marcada ya como vencida. */
export function isLive(
  request: Pick<AppointmentRequest, "status" | "expiresAt">,
  now: Date,
): boolean {
  return request.status === "pending" && now < request.expiresAt;
}

export function assertSlotBookable(slot: Slot, schedule: Schedule, now: Date): void {
  if (!schedule.active) {
    throw new ValidationError("La agenda del cupo no esta activa", { field: "slot_id" });
  }
  if (slot.startAt <= now) {
    throw new ValidationError("El cupo ya empezo", { field: "slot_id" });
  }
  if (slot.status !== "free") {
    throw preAgendaConflict("slot_unavailable", "El cupo no esta libre");
  }
}

/** La cita de otro paciente se trata como inexistente: no se revela que existe. */
export function assertAppointmentChangeable(
  appointment: Appointment,
  medicalRecordId: string,
  now: Date,
): void {
  if (appointment.medicalRecordId !== medicalRecordId) {
    throw new NotFoundError();
  }
  if (appointment.status !== "booked") {
    throw new ValidationError("La cita no esta en firme", { field: "appointment_id" });
  }
  if (appointment.startAt <= now) {
    throw new ValidationError("La cita ya empezo", { field: "appointment_id" });
  }
}

export function assertBelowPendingCap(liveHolds: number, max: number): void {
  if (liveHolds >= max) {
    throw preAgendaConflict("pending_limit_reached", "Tope de solicitudes pendientes alcanzado", {
      max,
    });
  }
}

/** `released` cubre rechazo y vencimiento: los dos solo liberan el apartado. */
export function resolutionEffects(
  request: Pick<AppointmentRequest, "kind" | "slotId" | "appointmentId">,
  targetSlotId: string | null,
  outcome: "approved" | "released",
): ResolutionEffects {
  if (outcome === "released") {
    const slots = request.slotId ? [{ slotId: request.slotId, status: "free" as const }] : [];
    return { slots, appointments: [], bookedSlotId: null };
  }
  const freed = targetSlotId ? [{ slotId: targetSlotId, status: "free" as const }] : [];
  const held = request.slotId ? [{ slotId: request.slotId, status: "busy" as const }] : [];
  const cancelled = request.appointmentId
    ? [{ appointmentId: request.appointmentId, status: "cancelled" as const }]
    : [];
  return { slots: [...freed, ...held], appointments: cancelled, bookedSlotId: request.slotId };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm --prefix backend exec vitest run tests/dominio/pre-agenda.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Parámetros nuevos de `bot-config`, primero la prueba**

En `backend/tests/dominio/bot-config.test.ts`, en «sin sobrescrituras devuelve los predeterminados», el objeto esperado de `config.params` pasa a ser:

```ts
    expect(config.params).toEqual({
      widget_session_ttl_minutes: 30,
      widget_sessions_per_ip_per_minute: 10,
      widget_key_grace_hours: 24,
      kb_max_results: 3,
      request_hold_minutes: 240,
      max_pending_requests_per_patient: 2,
    });
```

En «los rangos de los params coinciden con la spec», añade al final del cuerpo:

```ts
    expect(PARAM_SPECS.request_hold_minutes).toEqual({ default: 240, min: 15, max: 4320 });
    expect(PARAM_SPECS.max_pending_requests_per_patient).toEqual({ default: 2, min: 1, max: 5 });
```

y en la tabla de casos invalidos (la que contiene `[{ params: { kb_max_results: 11 } }, "params.kb_max_results"]`) añade:

```ts
    [{ params: { request_hold_minutes: 14 } }, "params.request_hold_minutes"],
    [{ params: { max_pending_requests_per_patient: 6 } }, "params.max_pending_requests_per_patient"],
```

Run: `npm --prefix backend exec vitest run tests/dominio/bot-config.test.ts`
Expected: FAIL en los tres puntos tocados.

- [ ] **Step 6: Añadir los parámetros**

En `backend/src/modules/bot-config/domain/bot-config.ts`, `PARAM_SPECS` queda:

```ts
export const PARAM_SPECS = {
  widget_session_ttl_minutes: { default: 30, min: 5, max: 120 },
  widget_sessions_per_ip_per_minute: { default: 10, min: 1, max: 100 },
  widget_key_grace_hours: { default: 24, min: 0, max: 168 },
  kb_max_results: { default: 3, min: 1, max: 10 },
  request_hold_minutes: { default: 240, min: 15, max: 4320 },
  max_pending_requests_per_patient: { default: 2, min: 1, max: 5 },
} as const;
```

Run: `npm --prefix backend exec vitest run tests/dominio/bot-config.test.ts tests/dominio/pre-agenda.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/scheduling/domain/appointment-request.ts backend/src/modules/bot-config/domain/bot-config.ts backend/tests/dominio/pre-agenda.test.ts backend/tests/dominio/bot-config.test.ts
git commit -m "feat(scheduling): reglas puras de la pre-agenda y parametros de apartado"
```

---

### Task 3: Almacén Prisma y creación de solicitudes

**Files:**
- Create: `backend/src/modules/scheduling/domain/ports/pre-agenda.ts`
- Create: `backend/src/modules/scheduling/infrastructure/prisma-pre-agenda-store.ts`
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-slot-repository.ts:6` (`export function mapSlot`)
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-schedule-repository.ts:6` (`export function mapSchedule`)
- Modify: `backend/src/modules/scheduling/infrastructure/prisma-appointment-repository.ts:6` (`export function mapAppointment`)
- Create: `backend/src/modules/scheduling/application/create-appointment-request.ts`
- Modify: `backend/tests/db/pre-agenda-support.ts` (helpers de casos de uso)
- Create: `backend/tests/db/pre-agenda-crear.test.ts`

**Interfaces:**
- Consumes: todo lo de la Tarea 2; `AuditActor` (`shared/domain/audit-event.ts`), `AuditLog`, `Clock`, `IdGenerator`, `TenantId`, `PrismaExecutor`, `isUniqueViolation`.
- Produces:
  - Puertos (`domain/ports/pre-agenda.ts`): `NewAppointmentRequest`, `NewAppointment`, `RequestResolutionPatch`, `ExpiryScope`, `RequestExpirer`, `PreAgendaStore`, `PreAgendaPolicyValues`, `PreAgendaPolicy`, `RequestPartyRef`, `RequestPatient`, `AppointmentRequestView`, `AppointmentRequestFilter`, `AppointmentRequestReader`.
  - `createPrismaRequestExpirer(db: PrismaExecutor): RequestExpirer`
  - `createPrismaPreAgendaStore(db: PrismaExecutor): PreAgendaStore`
  - `mapRequest(row: AppointmentRequestRow): AppointmentRequest`
  - `CreateAppointmentRequestCommand`, `CreateAppointmentRequestDeps`, `CreateAppointmentRequest`, `createCreateAppointmentRequest(deps)`.
  - Test helpers: `DEFAULT_POLICY`, `ACTOR`, `clockAt(at) → MutableClock`, `createRequest(prisma, clock, cmd, policy?)`.

- [ ] **Step 1: Declarar los puertos**

Create `backend/src/modules/scheduling/domain/ports/pre-agenda.ts`:

```ts
import type { Page } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  AppointmentRequest,
  AppointmentRequestKind,
  AppointmentRequestStatus,
  ResolutionReason,
} from "../appointment-request";
import type {
  Appointment,
  AppointmentStatus,
  HermesIdentifier,
  Schedule,
  Slot,
  SlotStatus,
} from "../entities";

export type NewAppointmentRequest = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly kind: AppointmentRequestKind;
  readonly medicalRecordId: string;
  readonly slotId: string | null;
  readonly appointmentId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
};

export type NewAppointment = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly identifier: HermesIdentifier;
  readonly medicalRecordId: string;
  readonly scheduleId: string;
  readonly slotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type RequestResolutionPatch = {
  readonly status: Exclude<AppointmentRequestStatus, "pending">;
  readonly resolutionReason: ResolutionReason | null;
  readonly resultingAppointmentId: string | null;
  readonly resolvedAt: Date;
};

/** Alcance del vencimiento: todo el tenant o solo lo que toca un cupo o una cita. */
export type ExpiryScope = { readonly slotId: string } | { readonly appointmentId: string };

export type RequestExpirer = {
  /** Vence las pendientes con `expires_at <= now` y devuelve a `free` sus cupos apartados. */
  expireDue(tenantId: TenantId, now: Date, scope?: ExpiryScope): Promise<void>;
};

/**
 * Operaciones de la pre-agenda. Se construye sobre la transaccion del llamador
 * (`withWriteTransaction`): los bloqueos `FOR UPDATE` duran lo que ella.
 */
export type PreAgendaStore = RequestExpirer & {
  /** Bloquea la historia clinica; `false` si no existe en el tenant. */
  lockMedicalRecord(tenantId: TenantId, medicalRecordId: string): Promise<boolean>;
  getSlot(tenantId: TenantId, id: string): Promise<Slot | null>;
  getSchedule(tenantId: TenantId, id: string): Promise<Schedule | null>;
  getAppointment(tenantId: TenantId, id: string): Promise<Appointment | null>;
  /** Solicitudes `book`/`reschedule` vivas del paciente. */
  countLiveHolds(tenantId: TenantId, medicalRecordId: string, now: Date): Promise<number>;
  /** `free` -> `busy_tentative` solo si sigue libre. `false` si otro lo tomo antes. */
  holdSlot(tenantId: TenantId, slotId: string): Promise<boolean>;
  /** Traduce los indices unicos parciales a `appointment_change_pending` / `slot_unavailable`. */
  insertRequest(row: NewAppointmentRequest): Promise<AppointmentRequest>;
  /** Bloquea la solicitud; `null` si no existe en el tenant. */
  getRequestForUpdate(tenantId: TenantId, id: string): Promise<AppointmentRequest | null>;
  setSlotStatus(tenantId: TenantId, slotId: string, status: SlotStatus): Promise<void>;
  insertAppointment(row: NewAppointment): Promise<void>;
  setAppointmentStatus(tenantId: TenantId, id: string, status: AppointmentStatus): Promise<void>;
  markResolved(
    tenantId: TenantId,
    id: string,
    patch: RequestResolutionPatch,
  ): Promise<AppointmentRequest>;
};

export type PreAgendaPolicyValues = {
  readonly holdMinutes: number;
  readonly maxPendingHolds: number;
};

/** Lo cumple `bot-config` en el composition root; `scheduling` no lo importa. */
export type PreAgendaPolicy = {
  read(tenantId: TenantId): Promise<PreAgendaPolicyValues>;
};

export type RequestPartyRef = {
  readonly identifier: HermesIdentifier;
  readonly startAt: Date;
  readonly endAt: Date;
};

/** Datos de identificacion del paciente; ningun dato clinico. */
export type RequestPatient = {
  readonly identifier: HermesIdentifier;
  readonly documentType: string;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
};

export type AppointmentRequestView = AppointmentRequest & {
  readonly patient: RequestPatient;
  readonly slot: RequestPartyRef | null;
  readonly appointment: RequestPartyRef | null;
  readonly resultingAppointment: { readonly identifier: HermesIdentifier } | null;
};

export type AppointmentRequestFilter = {
  readonly tenantId: TenantId;
  readonly status?: AppointmentRequestStatus;
  readonly cursor?: string | null;
  readonly limit: number;
};

export type AppointmentRequestReader = {
  list(filter: AppointmentRequestFilter): Promise<Page<AppointmentRequestView>>;
  get(tenantId: TenantId, id: string): Promise<AppointmentRequestView | null>;
};
```

- [ ] **Step 2: Exportar los mappers existentes**

En `prisma-slot-repository.ts`, `prisma-schedule-repository.ts` y `prisma-appointment-repository.ts`, cambia `function mapSlot(` / `function mapSchedule(` / `function mapAppointment(` por `export function …(`. Nada más.

- [ ] **Step 3: Implementar el almacén Prisma**

Create `backend/src/modules/scheduling/infrastructure/prisma-pre-agenda-store.ts`:

```ts
import { type AppointmentRequest as AppointmentRequestRow, Prisma } from "@prisma/client";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { isUniqueViolation } from "@/modules/shared/infrastructure/prisma-errors";
import { type AppointmentRequest, preAgendaConflict } from "../domain/appointment-request";
import type {
  ExpiryScope,
  NewAppointmentRequest,
  PreAgendaStore,
  RequestExpirer,
} from "../domain/ports/pre-agenda";
import { mapAppointment } from "./prisma-appointment-repository";
import { mapSchedule } from "./prisma-schedule-repository";
import { mapSlot } from "./prisma-slot-repository";

export function mapRequest(row: AppointmentRequestRow): AppointmentRequest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    status: row.status,
    medicalRecordId: row.medicalRecordId,
    slotId: row.slotId,
    appointmentId: row.appointmentId,
    expiresAt: row.expiresAt,
    resolutionReason: row.resolutionReason,
    resultingAppointmentId: row.resultingAppointmentId,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

function scopeFilter(scope: ExpiryScope | undefined): Prisma.Sql {
  if (!scope) {
    return Prisma.empty;
  }
  return "slotId" in scope
    ? Prisma.sql`AND "slot_id" = ${scope.slotId}`
    : Prisma.sql`AND "appointment_id" = ${scope.appointmentId}`;
}

/** Un solo UPDATE por conjunto: vence pendientes y libera sus cupos apartados. */
export function createPrismaRequestExpirer(db: PrismaExecutor): RequestExpirer {
  return {
    async expireDue(tenantId, now, scope) {
      await db.$executeRaw`
        WITH expired AS (
          UPDATE "public"."appointment_requests"
          SET "status" = 'expired', "resolved_at" = ${now}
          WHERE "tenant_id" = ${tenantId} AND "status" = 'pending' AND "expires_at" <= ${now}
          ${scopeFilter(scope)}
          RETURNING "slot_id"
        )
        UPDATE "public"."slots" SET "status" = 'free', "updated_at" = ${now}
        WHERE "tenant_id" = ${tenantId} AND "status" = 'busy_tentative'
          AND "id" IN (SELECT "slot_id" FROM expired WHERE "slot_id" IS NOT NULL)`;
    },
  };
}

function preAgendaReads(db: PrismaExecutor) {
  return {
    async lockMedicalRecord(tenantId: TenantId, medicalRecordId: string) {
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."medical_records"
        WHERE "tenant_id" = ${tenantId} AND "id" = ${medicalRecordId} FOR UPDATE`;
      return rows.length === 1;
    },
    async getSlot(tenantId: TenantId, id: string) {
      const row = await db.slot.findFirst({ where: { tenantId, id } });
      return row ? mapSlot(row) : null;
    },
    async getSchedule(tenantId: TenantId, id: string) {
      const row = await db.schedule.findFirst({ where: { tenantId, id } });
      return row ? mapSchedule(row) : null;
    },
    async getAppointment(tenantId: TenantId, id: string) {
      const row = await db.appointment.findFirst({ where: { tenantId, id } });
      return row ? mapAppointment(row) : null;
    },
    countLiveHolds(tenantId: TenantId, medicalRecordId: string, now: Date) {
      return db.appointmentRequest.count({
        where: {
          tenantId,
          medicalRecordId,
          status: "pending",
          kind: { in: ["book", "reschedule"] },
          expiresAt: { gt: now },
        },
      });
    },
    async getRequestForUpdate(tenantId: TenantId, id: string) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."appointment_requests"
        WHERE "tenant_id" = ${tenantId} AND "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        return null;
      }
      return mapRequest(await db.appointmentRequest.findFirstOrThrow({ where: { tenantId, id } }));
    },
  };
}

async function insertRequest(db: PrismaExecutor, row: NewAppointmentRequest) {
  try {
    return mapRequest(await db.appointmentRequest.create({ data: { ...row, status: "pending" } }));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // El cupo ya lo apartamos con holdSlot: el unico choque posible es la cita.
    throw row.appointmentId
      ? preAgendaConflict("appointment_change_pending", "La cita ya tiene un cambio pendiente")
      : preAgendaConflict("slot_unavailable", "El cupo ya esta apartado");
  }
}

function preAgendaWrites(db: PrismaExecutor) {
  return {
    async holdSlot(tenantId: TenantId, slotId: string) {
      const result = await db.slot.updateMany({
        where: { tenantId, id: slotId, status: "free" },
        data: { status: "busy_tentative" },
      });
      return result.count === 1;
    },
    insertRequest: (row: NewAppointmentRequest) => insertRequest(db, row),
    async setSlotStatus(tenantId: TenantId, slotId: string, status: Parameters<PreAgendaStore["setSlotStatus"]>[2]) {
      await db.slot.updateMany({ where: { tenantId, id: slotId }, data: { status } });
    },
    async insertAppointment(row: Parameters<PreAgendaStore["insertAppointment"]>[0]) {
      await db.appointment.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifier.system,
          identifierValue: row.identifier.value,
          medicalRecordId: row.medicalRecordId,
          scheduleId: row.scheduleId,
          slotId: row.slotId,
          startAt: row.startAt,
          endAt: row.endAt,
          status: "booked",
        },
      });
    },
    async setAppointmentStatus(tenantId: TenantId, id: string, status: Parameters<PreAgendaStore["setAppointmentStatus"]>[2]) {
      await db.appointment.updateMany({ where: { tenantId, id }, data: { status } });
    },
    async markResolved(tenantId: TenantId, id: string, patch: Parameters<PreAgendaStore["markResolved"]>[2]) {
      await db.appointmentRequest.updateMany({ where: { tenantId, id }, data: patch });
      return mapRequest(await db.appointmentRequest.findFirstOrThrow({ where: { tenantId, id } }));
    },
  };
}

export function createPrismaPreAgendaStore(db: PrismaExecutor): PreAgendaStore {
  return { ...createPrismaRequestExpirer(db), ...preAgendaReads(db), ...preAgendaWrites(db) };
}
```

- [ ] **Step 4: Escribir el caso de uso de creación**

Create `backend/src/modules/scheduling/application/create-appointment-request.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import {
  type AppointmentRequest,
  assertAppointmentChangeable,
  assertBelowPendingCap,
  assertSlotBookable,
  computeExpiresAt,
  preAgendaConflict,
} from "../domain/appointment-request";
import type { Appointment, Slot } from "../domain/entities";
import type { PreAgendaPolicy, PreAgendaStore } from "../domain/ports/pre-agenda";

type CommandBase = {
  readonly tenantId: TenantId;
  readonly medicalRecordId: string;
  readonly actor: AuditActor;
};

/** Contrato estable para el motor conversacional (3.3). */
export type CreateAppointmentRequestCommand =
  | (CommandBase & { readonly kind: "book"; readonly slotId: string })
  | (CommandBase & {
      readonly kind: "reschedule";
      readonly appointmentId: string;
      readonly slotId: string;
    })
  | (CommandBase & { readonly kind: "cancel"; readonly appointmentId: string });

export type CreateAppointmentRequestDeps = {
  readonly store: PreAgendaStore;
  readonly policy: PreAgendaPolicy;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

export type CreateAppointmentRequest = (
  command: CreateAppointmentRequestCommand,
) => Promise<AppointmentRequest>;

async function changeableAppointment(
  store: PreAgendaStore,
  command: CommandBase & { readonly appointmentId: string },
  now: Date,
): Promise<Appointment> {
  await store.expireDue(command.tenantId, now, { appointmentId: command.appointmentId });
  const appointment = await store.getAppointment(command.tenantId, command.appointmentId);
  if (!appointment) {
    throw new NotFoundError();
  }
  assertAppointmentChangeable(appointment, command.medicalRecordId, now);
  return appointment;
}

async function bookableSlot(
  store: PreAgendaStore,
  tenantId: TenantId,
  slotId: string,
  target: Appointment | null,
  now: Date,
): Promise<Slot> {
  await store.expireDue(tenantId, now, { slotId });
  const slot = await store.getSlot(tenantId, slotId);
  if (!slot) {
    throw new NotFoundError();
  }
  if (target && target.slotId === slot.id) {
    throw new ValidationError("El cupo nuevo es el de la cita actual", { field: "slot_id" });
  }
  const schedule = await store.getSchedule(tenantId, slot.scheduleId);
  if (!schedule) {
    throw new NotFoundError();
  }
  assertSlotBookable(slot, schedule, now);
  return slot;
}

async function holdWithinCap(
  store: PreAgendaStore,
  command: CommandBase,
  slotId: string,
  maxPendingHolds: number,
  now: Date,
): Promise<void> {
  const liveHolds = await store.countLiveHolds(command.tenantId, command.medicalRecordId, now);
  assertBelowPendingCap(liveHolds, maxPendingHolds);
  if (!(await store.holdSlot(command.tenantId, slotId))) {
    throw preAgendaConflict("slot_unavailable", "El cupo ya no esta libre");
  }
}

/**
 * Crea una solicitud y, si aparta cupo, lo pasa a `busy_tentative` en la misma transaccion.
 * El bloqueo de la historia clinica serializa las solicitudes de un paciente (tope exacto);
 * el UPDATE condicional del cupo resuelve la carrera entre pacientes.
 */
export function createCreateAppointmentRequest(
  deps: CreateAppointmentRequestDeps,
): CreateAppointmentRequest {
  return async (command) => {
    const now = deps.clock.now();
    if (!(await deps.store.lockMedicalRecord(command.tenantId, command.medicalRecordId))) {
      throw new NotFoundError();
    }
    const policy = await deps.policy.read(command.tenantId);
    const target =
      command.kind === "book" ? null : await changeableAppointment(deps.store, command, now);
    const slot =
      command.kind === "cancel"
        ? null
        : await bookableSlot(deps.store, command.tenantId, command.slotId, target, now);
    if (slot) {
      await holdWithinCap(deps.store, command, slot.id, policy.maxPendingHolds, now);
    }
    const request = await deps.store.insertRequest({
      id: deps.ids.next(),
      tenantId: command.tenantId,
      kind: command.kind,
      medicalRecordId: command.medicalRecordId,
      slotId: slot?.id ?? null,
      appointmentId: target?.id ?? null,
      expiresAt: computeExpiresAt(now, policy.holdMinutes, slot?.startAt ?? null),
      createdAt: now,
    });
    await deps.audit.record({
      tenantId: command.tenantId,
      ...command.actor,
      action: "appointment_request.created",
      resourceType: "appointment_request",
      resourceId: request.id,
      occurredAt: now,
    });
    return request;
  };
}
```

- [ ] **Step 5: Helpers de prueba de los casos de uso**

Añade al final de `backend/tests/db/pre-agenda-support.ts` (y sus imports arriba):

```ts
import {
  type CreateAppointmentRequestCommand,
  createCreateAppointmentRequest,
} from "@/modules/scheduling/application/create-appointment-request";
import type { PreAgendaPolicyValues } from "@/modules/scheduling/domain/ports/pre-agenda";
import { createPrismaPreAgendaStore } from "@/modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
```

```ts
export const DEFAULT_POLICY: PreAgendaPolicyValues = { holdMinutes: 240, maxPendingHolds: 2 };
export const ACTOR = { actorSubject: "chat-prueba", actorRole: "widget", requestId: "req-prueba" };
/** Holgura para transacciones concurrentes en las pruebas de carrera. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 };

export type MutableClock = Clock & { set(at: Date): void };

export function clockAt(at: Date): MutableClock {
  let current = at;
  return {
    now: () => current,
    set: (next) => {
      current = next;
    },
  };
}

export function preAgendaDeps(db: PrismaExecutor, clock: Clock) {
  return {
    store: createPrismaPreAgendaStore(db),
    ids: uuidV7Generator,
    clock,
    audit: createPrismaAuditLog(db, uuidV7Generator),
  };
}

export function createRequest(
  prisma: PrismaClient,
  clock: Clock,
  command: CreateAppointmentRequestCommand,
  policy: PreAgendaPolicyValues = DEFAULT_POLICY,
) {
  return prisma.$transaction(
    (tx) =>
      createCreateAppointmentRequest({
        ...preAgendaDeps(tx, clock),
        policy: { read: async () => policy },
      })(command),
    TX_OPTIONS,
  );
}
```

- [ ] **Step 6: Escribir las pruebas de creación**

Create `backend/tests/db/pre-agenda-crear.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import {
  ACTOR,
  clockAt,
  createRequest,
  extraPatients,
  type MutableClock,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const START = new Date("2026-06-15T14:00:00.000Z");
const T0 = new Date("2026-06-15T08:00:00.000Z");

function book(world: World, slotId: string, medicalRecordId = world.medicalRecordId) {
  return { kind: "book", tenantId: world.tenantId, medicalRecordId, slotId, actor: ACTOR } as const;
}

async function slotStatus(id: string) {
  return (await prisma.slot.findUniqueOrThrow({ where: { id } })).status;
}

describe("pre-agenda: creacion de solicitudes", () => {
  let world: World;
  let clock: MutableClock;

  beforeEach(async () => {
    await truncateAll(prisma);
    world = await seedWorld(prisma, "a", START, { freeSlots: 5 });
    clock = clockAt(T0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("book aparta el cupo y vence con el plazo del tenant", async () => {
    const request = await createRequest(prisma, clock, book(world, slotAt(world, 0)));
    expect(request).toMatchObject({ kind: "book", status: "pending", appointmentId: null });
    expect(request.expiresAt).toEqual(new Date("2026-06-15T12:00:00.000Z"));
    expect(await slotStatus(slotAt(world, 0))).toBe("busy_tentative");
    expect(await prisma.auditEvent.count({ where: { action: "appointment_request.created" } })).toBe(1);
  });

  it("el vencimiento se recorta al inicio del cupo", async () => {
    const request = await createRequest(prisma, clock, book(world, slotAt(world, 0)), {
      holdMinutes: 480,
      maxPendingHolds: 2,
    });
    expect(request.expiresAt).toEqual(START);
  });

  it("10 pacientes sobre el mismo cupo: exactamente una solicitud", async () => {
    const patients = await extraPatients(prisma, world, 10);
    const results = await Promise.allSettled(
      patients.map((mr) => createRequest(prisma, clock, book(world, slotAt(world, 0), mr))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const failure of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
      expect(failure.reason).toMatchObject({ details: { reason: "slot_unavailable" } });
    }
    expect(await prisma.appointmentRequest.count()).toBe(1);
    expect(await slotStatus(slotAt(world, 0))).toBe("busy_tentative");
  });

  it("5 solicitudes del mismo paciente con tope 2: exactamente dos", async () => {
    const results = await Promise.allSettled(
      world.freeSlotIds.map((slotId) => createRequest(prisma, clock, book(world, slotId))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const failure of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
      expect(failure.reason).toMatchObject({ details: { reason: "pending_limit_reached" } });
    }
    expect(await prisma.slot.count({ where: { status: "busy_tentative" } })).toBe(2);
  });

  it("las cancelaciones no cuentan para el tope", async () => {
    const policy = { holdMinutes: 240, maxPendingHolds: 1 };
    await createRequest(prisma, clock, book(world, slotAt(world, 0)), policy);
    const cancel = await createRequest(
      prisma,
      clock,
      { kind: "cancel", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId, appointmentId: world.appointmentId, actor: ACTOR },
      policy,
    );
    expect(cancel).toMatchObject({ kind: "cancel", slotId: null });
  });

  it("un apartado vencido sin marcar no bloquea a otro paciente", async () => {
    const [other] = await extraPatients(prisma, world, 1);
    const first = await createRequest(prisma, clock, book(world, slotAt(world, 0)));
    clock.set(new Date("2026-06-15T12:30:00.000Z"));
    const second = await createRequest(prisma, clock, book(world, slotAt(world, 0), other));
    expect(second.status).toBe("pending");
    expect(
      (await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe("expired");
    expect(await slotStatus(slotAt(world, 0))).toBe("busy_tentative");
  });

  it("reprogramar aparta el cupo nuevo y referencia la cita", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: slotAt(world, 1),
      actor: ACTOR,
    });
    expect(request).toMatchObject({ appointmentId: world.appointmentId, slotId: slotAt(world, 1) });
    expect(await slotStatus(slotAt(world, 1))).toBe("busy_tentative");
  });

  it("reprogramar hacia un cupo ocupado es slot_unavailable y no deja rastro", async () => {
    await createRequest(prisma, clock, book(world, slotAt(world, 0)));
    const attempt = createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: slotAt(world, 0),
      actor: ACTOR,
    });
    await expect(attempt).rejects.toMatchObject({ details: { reason: "slot_unavailable" } });
    expect(await prisma.appointmentRequest.count({ where: { appointmentId: world.appointmentId } })).toBe(0);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status).toBe("booked");
  });

  it("reprogramar al mismo cupo de la cita es 422", async () => {
    const attempt = createRequest(prisma, clock, {
      kind: "reschedule",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      slotId: world.bookedSlotId,
      actor: ACTOR,
    });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
  });

  it("un segundo cambio sobre la misma cita es appointment_change_pending", async () => {
    const cancel = {
      kind: "cancel",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId,
      actor: ACTOR,
    } as const;
    await createRequest(prisma, clock, cancel);
    await expect(createRequest(prisma, clock, cancel)).rejects.toMatchObject({
      details: { reason: "appointment_change_pending" },
    });
  });

  it("cupo ya empezado es 422", async () => {
    clock.set(START);
    await expect(createRequest(prisma, clock, book(world, slotAt(world, 0)))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("cupo, paciente o cita de otro tenant es 404", async () => {
    const other = await seedWorld(prisma, "b", START);
    await expect(createRequest(prisma, clock, book(world, slotAt(other, 0)))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createRequest(prisma, clock, book(world, slotAt(world, 0), other.medicalRecordId)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createRequest(prisma, clock, {
        kind: "cancel",
        tenantId: world.tenantId,
        medicalRecordId: world.medicalRecordId,
        appointmentId: other.appointmentId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la cita de otro paciente del mismo tenant es 404", async () => {
    const [other] = await extraPatients(prisma, world, 1);
    await expect(
      createRequest(prisma, clock, {
        kind: "cancel",
        tenantId: world.tenantId,
        medicalRecordId: other,
        appointmentId: world.appointmentId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 7: Correr y ajustar hasta verde**

Run: `npm --prefix backend exec vitest run --project db tests/db/pre-agenda-crear.test.ts`
Expected: PASS (13 tests). Si «10 pacientes…» falla con error de pool o `Transaction API error`, confirma que `createRequest` pasa `TX_OPTIONS`.

Run: `npm --prefix backend run typecheck` → Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/scheduling/domain/ports/pre-agenda.ts backend/src/modules/scheduling/infrastructure/prisma-pre-agenda-store.ts backend/src/modules/scheduling/infrastructure/prisma-slot-repository.ts backend/src/modules/scheduling/infrastructure/prisma-schedule-repository.ts backend/src/modules/scheduling/infrastructure/prisma-appointment-repository.ts backend/src/modules/scheduling/application/create-appointment-request.ts backend/tests/db/pre-agenda-support.ts backend/tests/db/pre-agenda-crear.test.ts
git commit -m "feat(scheduling): creacion de solicitudes con apartado atomico y tope por paciente"
```

---

### Task 4: Resolución, vencimiento al leer y lecturas

**Files:**
- Create: `backend/src/modules/scheduling/application/resolve-appointment-request.ts`
- Create: `backend/src/modules/scheduling/application/appointment-request-queries.ts`
- Create: `backend/src/modules/scheduling/infrastructure/prisma-appointment-request-reader.ts`
- Modify: `backend/src/modules/scheduling/application/list-availability.ts`
- Modify: `backend/src/modules/scheduling/application/list-schedule-slots.ts`
- Create: `backend/src/composition/pre-agenda-wiring.ts`
- Modify: `backend/src/composition-root.ts` (`schedulingReads`, `Container`, `getContainer`)
- Modify: `backend/tests/dominio/scheduling.test.ts:79,108` y `backend/tests/dominio/scheduling-lists.test.ts:121,138,164`
- Modify: `backend/tests/db/pre-agenda-support.ts` (`resolveRequest`)
- Create: `backend/tests/db/pre-agenda-resolver.test.ts`

**Interfaces:**
- Consumes: Tareas 2 y 3.
- Produces:
  - `ResolveAppointmentRequestInput = { tenantId: TenantId; requestId: string; resolution: Resolution; actor: AuditActor }`, `ResolveAppointmentRequestDeps = { store; ids; clock; audit }`, `ResolveAppointmentRequest`, `createResolveAppointmentRequest(deps)`.
  - `ExpireDueRequests = (tenantId: TenantId) => Promise<void>`, `createExpireDueRequests({ expirer, clock })`.
  - `ListAppointmentRequests`, `createListAppointmentRequests({ reader, expire })` con entrada `AppointmentRequestFilter`.
  - `GetAppointmentRequest = (tenantId: TenantId, id: string) => Promise<AppointmentRequestView>`, `createGetAppointmentRequest({ reader, expire })`.
  - `createPrismaAppointmentRequestReader(db): AppointmentRequestReader`.
  - `createListAvailability(slots, tenantSettings, expire)` y `createListScheduleSlots(schedules, slots, tenantSettings, expire)`: tercer/cuarto argumento nuevo.
  - `composition/pre-agenda-wiring.ts`: `preAgendaReads(prisma) → { expireDueRequests }`, tipo `PreAgendaReads`.
  - Test helper `resolveRequest(prisma, clock, input)`.

- [ ] **Step 1: Escribir las pruebas de resolución y lectura**

Añade a `backend/tests/db/pre-agenda-support.ts`:

```ts
import {
  createResolveAppointmentRequest,
  type ResolveAppointmentRequestInput,
} from "@/modules/scheduling/application/resolve-appointment-request";
```

```ts
export function resolveRequest(
  prisma: PrismaClient,
  clock: Clock,
  input: ResolveAppointmentRequestInput,
) {
  return prisma.$transaction(
    (tx) => createResolveAppointmentRequest(preAgendaDeps(tx, clock))(input),
    TX_OPTIONS,
  );
}
```

Create `backend/tests/db/pre-agenda-resolver.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getAvailability } from "@/app/api/v1/availability/route";
import { resetContainer } from "@/composition-root";
import {
  createExpireDueRequests,
  createListAppointmentRequests,
} from "@/modules/scheduling/application/appointment-request-queries";
import { createPrismaAppointmentRequestReader } from "@/modules/scheduling/infrastructure/prisma-appointment-request-reader";
import { createPrismaRequestExpirer } from "@/modules/scheduling/infrastructure/prisma-pre-agenda-store";
import { authedRequest, signToken } from "../helpers/token";
import {
  ACTOR,
  clockAt,
  createRequest,
  type MutableClock,
  resolveRequest,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { HERMES_SYSTEM, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const START = new Date("2026-06-15T14:00:00.000Z");
const T0 = new Date("2026-06-15T08:00:00.000Z");
const HERMES_APPT = { system: HERMES_SYSTEM.appointment, value: "AP-hermes-1" };
const APPROVE = { outcome: "approved", appointmentIdentifier: HERMES_APPT } as const;
const DECLINE = { outcome: "rejected", reason: "declined" } as const;

describe("pre-agenda: resolucion y vencimiento", () => {
  let world: World;
  let clock: MutableClock;

  const status = async (id: string) => (await prisma.slot.findUniqueOrThrow({ where: { id } })).status;
  const appt = async (id: string) => (await prisma.appointment.findUniqueOrThrow({ where: { id } })).status;
  const book = (slotId: string) =>
    createRequest(prisma, clock, { kind: "book", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId, slotId, actor: ACTOR });
  const reschedule = (slotId: string) =>
    createRequest(prisma, clock, { kind: "reschedule", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId, appointmentId: world.appointmentId, slotId, actor: ACTOR });
  const cancel = () =>
    createRequest(prisma, clock, { kind: "cancel", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId, appointmentId: world.appointmentId, actor: ACTOR });
  const resolve = (requestId: string, resolution: typeof APPROVE | typeof DECLINE) =>
    resolveRequest(prisma, clock, { tenantId: world.tenantId, requestId, resolution, actor: ACTOR });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    world = await seedWorld(prisma, "a", START);
    clock = clockAt(T0);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("book aprobado: cupo busy y cita booked con el identificador de Hermes", async () => {
    const request = await book(slotAt(world, 0));
    const resolved = await resolve(request.id, APPROVE);
    expect(resolved.status).toBe("approved");
    expect(await status(slotAt(world, 0))).toBe("busy");
    const created = await prisma.appointment.findUniqueOrThrow({ where: { id: resolved.resultingAppointmentId ?? "" } });
    expect(created).toMatchObject({ status: "booked", slotId: slotAt(world, 0), identifierValue: "AP-hermes-1" });
  });

  it("book rechazado: cupo libre y motivo guardado", async () => {
    const request = await book(slotAt(world, 0));
    const resolved = await resolve(request.id, DECLINE);
    expect(resolved).toMatchObject({ status: "rejected", resolutionReason: "declined", resultingAppointmentId: null });
    expect(await status(slotAt(world, 0))).toBe("free");
  });

  it("reschedule aprobado: cita vieja cancelada y cita nueva en el cupo nuevo", async () => {
    const request = await reschedule(slotAt(world, 1));
    const resolved = await resolve(request.id, APPROVE);
    expect(await appt(world.appointmentId)).toBe("cancelled");
    expect(await status(world.bookedSlotId)).toBe("free");
    expect(await status(slotAt(world, 1))).toBe("busy");
    expect(await appt(resolved.resultingAppointmentId ?? "")).toBe("booked");
  });

  it("reschedule rechazado: cupo nuevo libre y cita vieja intacta", async () => {
    const request = await reschedule(slotAt(world, 1));
    await resolve(request.id, DECLINE);
    expect(await status(slotAt(world, 1))).toBe("free");
    expect(await appt(world.appointmentId)).toBe("booked");
    expect(await status(world.bookedSlotId)).toBe("busy");
  });

  it("cancel aprobado: cita cancelada y su cupo libre", async () => {
    const request = await cancel();
    const resolved = await resolve(request.id, APPROVE);
    expect(resolved.resultingAppointmentId).toBeNull();
    expect(await appt(world.appointmentId)).toBe("cancelled");
    expect(await status(world.bookedSlotId)).toBe("free");
  });

  it("cancel rechazado: nada cambia", async () => {
    const request = await cancel();
    await resolve(request.id, DECLINE);
    expect(await appt(world.appointmentId)).toBe("booked");
    expect(await status(world.bookedSlotId)).toBe("busy");
  });

  it("resolver una vencida es request_not_pending con status expired", async () => {
    const request = await book(slotAt(world, 0));
    clock.set(new Date("2026-06-15T12:00:00.000Z"));
    await expect(resolve(request.id, APPROVE)).rejects.toMatchObject({
      details: { reason: "request_not_pending", status: "expired" },
    });
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("resolver dos veces es request_not_pending", async () => {
    const request = await book(slotAt(world, 0));
    await resolve(request.id, APPROVE);
    await expect(resolve(request.id, DECLINE)).rejects.toMatchObject({
      details: { reason: "request_not_pending", status: "approved" },
    });
  });

  it("dos resoluciones simultaneas: una gana y se crea una sola cita", async () => {
    const request = await book(slotAt(world, 0));
    const results = await Promise.allSettled([resolve(request.id, APPROVE), resolve(request.id, APPROVE)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.appointment.count()).toBe(2);
  });

  it("resolver una solicitud de otro tenant es 404", async () => {
    const other = await seedWorld(prisma, "b", START);
    const request = await book(slotAt(world, 0));
    await expect(
      resolveRequest(prisma, clock, { tenantId: other.tenantId, requestId: request.id, resolution: APPROVE, actor: ACTOR }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("el vencimiento por conjunto marca expired y libera solo apartados", async () => {
    const request = await book(slotAt(world, 0));
    clock.set(new Date("2026-06-15T12:00:00.000Z"));
    await createExpireDueRequests({ expirer: createPrismaRequestExpirer(prisma), clock })(world.tenantId);
    const row = await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ status: "expired" });
    expect(row.resolvedAt).toEqual(new Date("2026-06-15T12:00:00.000Z"));
    expect(await status(slotAt(world, 0))).toBe("free");
    expect(await status(world.bookedSlotId)).toBe("busy");
  });

  it("la lista devuelve vistas con identificadores y pagina por cursor", async () => {
    await book(slotAt(world, 0));
    await cancel();
    const list = createListAppointmentRequests({
      reader: createPrismaAppointmentRequestReader(prisma),
      expire: async () => {},
    });
    const first = await list({ tenantId: world.tenantId, status: "pending", limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({
      kind: "book",
      patient: { identifier: { value: "MR-a" }, documentNumber: "1000a" },
      slot: { identifier: { value: "SL-a-0" } },
      appointment: null,
    });
    const second = await list({ tenantId: world.tenantId, status: "pending", limit: 1, cursor: first.nextCursor });
    expect(second.data[0]).toMatchObject({ kind: "cancel", appointment: { identifier: { value: "AP-a" } } });
    expect(second.nextCursor).toBeNull();
  });

  it("GET /availability vence apartados antes de responder", async () => {
    await book(slotAt(world, 0));
    const token = await signToken({ role: "operator", tenantId: world.tenantId });
    const response = await getAvailability(
      authedRequest("http://localhost/api/v1/availability?from=2026-06-15&to=2026-06-16", token),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((slot: { id: string }) => slot.id)).toContain(slotAt(world, 0));
    expect(await status(slotAt(world, 0))).toBe("free");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm --prefix backend exec vitest run --project db tests/db/pre-agenda-resolver.test.ts`
Expected: FAIL — no existen `resolve-appointment-request`, `appointment-request-queries` ni el lector.

- [ ] **Step 3: Implementar la resolución**

Create `backend/src/modules/scheduling/application/resolve-appointment-request.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import {
  type AppointmentRequest,
  isLive,
  preAgendaConflict,
  type Resolution,
  type ResolutionEffects,
  resolutionEffects,
} from "../domain/appointment-request";
import type { HermesIdentifier } from "../domain/entities";
import type { PreAgendaStore } from "../domain/ports/pre-agenda";

export type ResolveAppointmentRequestInput = {
  readonly tenantId: TenantId;
  readonly requestId: string;
  readonly resolution: Resolution;
  readonly actor: AuditActor;
};

export type ResolveAppointmentRequestDeps = {
  readonly store: PreAgendaStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

export type ResolveAppointmentRequest = (
  input: ResolveAppointmentRequestInput,
) => Promise<AppointmentRequest>;

async function applyEffects(store: PreAgendaStore, tenantId: TenantId, effects: ResolutionEffects) {
  for (const change of effects.slots) {
    await store.setSlotStatus(tenantId, change.slotId, change.status);
  }
  for (const change of effects.appointments) {
    await store.setAppointmentStatus(tenantId, change.appointmentId, change.status);
  }
}

async function bookAppointment(
  deps: ResolveAppointmentRequestDeps,
  request: AppointmentRequest,
  tenantId: TenantId,
  slotId: string,
  identifier: HermesIdentifier,
): Promise<string> {
  const slot = await deps.store.getSlot(tenantId, slotId);
  if (!slot) {
    throw new NotFoundError();
  }
  const id = deps.ids.next();
  await deps.store.insertAppointment({
    id,
    tenantId,
    identifier,
    medicalRecordId: request.medicalRecordId,
    scheduleId: slot.scheduleId,
    slotId,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
  return id;
}

/**
 * Hermes resuelve la solicitud. Hoy lo invoca la bandeja del simulador; en la Fase 4,
 * el `PUT` FHIR. Vencida o ya resuelta -> `request_not_pending`.
 */
export function createResolveAppointmentRequest(
  deps: ResolveAppointmentRequestDeps,
): ResolveAppointmentRequest {
  return async (input) => {
    const now = deps.clock.now();
    const request = await deps.store.getRequestForUpdate(input.tenantId, input.requestId);
    if (!request) {
      throw new NotFoundError();
    }
    if (!isLive(request, now)) {
      const status = request.status === "pending" ? "expired" : request.status;
      throw preAgendaConflict("request_not_pending", "La solicitud ya no esta pendiente", { status });
    }
    const { resolution } = input;
    const target = request.appointmentId
      ? await deps.store.getAppointment(input.tenantId, request.appointmentId)
      : null;
    const approved = resolution.outcome === "approved";
    const effects = resolutionEffects(request, target?.slotId ?? null, approved ? "approved" : "released");
    await applyEffects(deps.store, input.tenantId, effects);
    const resultingAppointmentId =
      resolution.outcome === "approved" && effects.bookedSlotId
        ? await bookAppointment(deps, request, input.tenantId, effects.bookedSlotId, resolution.appointmentIdentifier)
        : null;
    const resolved = await deps.store.markResolved(input.tenantId, request.id, {
      status: approved ? "approved" : "rejected",
      resolutionReason: resolution.outcome === "rejected" ? resolution.reason : null,
      resultingAppointmentId,
      resolvedAt: now,
    });
    await deps.audit.record({
      tenantId: input.tenantId,
      ...input.actor,
      action: `appointment_request.${resolved.status}`,
      resourceType: "appointment_request",
      resourceId: request.id,
      occurredAt: now,
    });
    return resolved;
  };
}
```

Si Biome marca la función devuelta por encima de 40 líneas, extrae el bloque desde `const target` hasta `resultingAppointmentId` a `async function applyResolution(deps, input, request): Promise<string | null>` en el mismo archivo.

- [ ] **Step 4: Implementar vencimiento y lecturas**

Create `backend/src/modules/scheduling/application/appointment-request-queries.ts`:

```ts
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page } from "@/modules/shared/domain/pagination";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  AppointmentRequestFilter,
  AppointmentRequestReader,
  AppointmentRequestView,
  RequestExpirer,
} from "../domain/ports/pre-agenda";

/** Vencimiento al leer; el barrido de la Fase 5 llamara a este mismo caso de uso. */
export type ExpireDueRequests = (tenantId: TenantId) => Promise<void>;

export function createExpireDueRequests(deps: {
  readonly expirer: RequestExpirer;
  readonly clock: Clock;
}): ExpireDueRequests {
  return (tenantId) => deps.expirer.expireDue(tenantId, deps.clock.now());
}

type QueryDeps = {
  readonly reader: AppointmentRequestReader;
  readonly expire: ExpireDueRequests;
};

export type ListAppointmentRequests = (
  filter: AppointmentRequestFilter,
) => Promise<Page<AppointmentRequestView>>;

export function createListAppointmentRequests(deps: QueryDeps): ListAppointmentRequests {
  return async (filter) => {
    if (filter.cursor) {
      decodeCursor(filter.cursor);
    }
    await deps.expire(filter.tenantId);
    return deps.reader.list(filter);
  };
}

export type GetAppointmentRequest = (
  tenantId: TenantId,
  id: string,
) => Promise<AppointmentRequestView>;

export function createGetAppointmentRequest(deps: QueryDeps): GetAppointmentRequest {
  return async (tenantId, id) => {
    await deps.expire(tenantId);
    const view = await deps.reader.get(tenantId, id);
    if (!view) {
      throw new NotFoundError();
    }
    return view;
  };
}
```

Create `backend/src/modules/scheduling/infrastructure/prisma-appointment-request-reader.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { decodeCursor, toPage } from "@/modules/shared/domain/pagination";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type {
  AppointmentRequestReader,
  AppointmentRequestView,
  RequestPartyRef,
} from "../domain/ports/pre-agenda";
import { mapRequest } from "./prisma-pre-agenda-store";

const VIEW_INCLUDE = {
  medicalRecord: true,
  slot: true,
  appointment: true,
  resultingAppointment: true,
} as const satisfies Prisma.AppointmentRequestInclude;

type ViewRow = Prisma.AppointmentRequestGetPayload<{ include: typeof VIEW_INCLUDE }>;

type IdentifiedRow = { identifierSystem: string; identifierValue: string };

function identifierOf(row: IdentifiedRow) {
  return { system: row.identifierSystem, value: row.identifierValue };
}

function partyRef(row: (IdentifiedRow & { startAt: Date; endAt: Date }) | null): RequestPartyRef | null {
  return row ? { identifier: identifierOf(row), startAt: row.startAt, endAt: row.endAt } : null;
}

function mapView(row: ViewRow): AppointmentRequestView {
  return {
    ...mapRequest(row),
    patient: {
      identifier: identifierOf(row.medicalRecord),
      documentType: row.medicalRecord.documentType,
      documentNumber: row.medicalRecord.documentNumber,
      givenNames: row.medicalRecord.givenNames,
      familyNames: row.medicalRecord.familyNames,
    },
    slot: partyRef(row.slot),
    appointment: partyRef(row.appointment),
    resultingAppointment: row.resultingAppointment
      ? { identifier: identifierOf(row.resultingAppointment) }
      : null,
  };
}

/** Cursor (created_at ASC, id ASC). */
function afterCreatedAt(cursor: string | null | undefined) {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  const createdAt = new Date(position.key);
  return { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: position.id } }] };
}

export function createPrismaAppointmentRequestReader(db: PrismaExecutor): AppointmentRequestReader {
  return {
    async list(filter) {
      const rows = await db.appointmentRequest.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.status ? { status: filter.status } : {}),
          ...afterCreatedAt(filter.cursor),
        },
        include: VIEW_INCLUDE,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return toPage(rows.map(mapView), filter.limit, (view) => ({
        key: view.createdAt.toISOString(),
        id: view.id,
      }));
    },
    async get(tenantId, id) {
      const row = await db.appointmentRequest.findFirst({ where: { tenantId, id }, include: VIEW_INCLUDE });
      return row ? mapView(row) : null;
    },
  };
}
```

- [ ] **Step 5: Vencer antes de listar disponibilidad y cupos**

En `list-availability.ts`: importa `import type { ExpireDueRequests } from "./appointment-request-queries";`, cambia la firma a

```ts
export function createListAvailability(
  slots: SlotRepository,
  tenantSettings: TenantSettingsRepository,
  expire: ExpireDueRequests,
): ListAvailability {
```

y, justo antes de `return slots.listAvailability({`, añade `await expire(input.tenantId);`.

En `list-schedule-slots.ts`: mismo import; la firma gana `expire: ExpireDueRequests` como cuarto parámetro y, antes de `return slots.listBySchedule({`, `await expire(input.tenantId);`.

En `backend/tests/dominio/scheduling.test.ts` (líneas 79 y 108) y `backend/tests/dominio/scheduling-lists.test.ts` (líneas 121, 138 y 164) añade `noExpiry` como último argumento de cada `createListAvailability(...)` / `createListScheduleSlots(...)`, con `const noExpiry = async () => {};` declarado tras los imports de cada archivo.

- [ ] **Step 6: Cablear el vencimiento en el composition root**

Create `backend/src/composition/pre-agenda-wiring.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { createExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createPrismaRequestExpirer } from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import { systemClock } from "../modules/shared/infrastructure/system-clock";

/**
 * Cableado de la pre-agenda (3.2) y de la bandeja del simulador. Vive aparte para no
 * empujar `composition-root.ts` por encima del limite de lineas por archivo de logica.
 */

export function preAgendaReads(prisma: PrismaClient) {
  return {
    expireDueRequests: createExpireDueRequests({
      expirer: createPrismaRequestExpirer(prisma),
      clock: systemClock,
    }),
  };
}

export type PreAgendaReads = ReturnType<typeof preAgendaReads>;
```

En `backend/src/composition-root.ts`:
- Import: `import { type PreAgendaReads, preAgendaReads } from "./composition/pre-agenda-wiring";` y `import type { ExpireDueRequests } from "./modules/scheduling/application/appointment-request-queries";`.
- `Container` gana `readonly expireDueRequests: PreAgendaReads["expireDueRequests"];`.
- `schedulingReads(prisma: PrismaClient, expire: ExpireDueRequests)`: pasa `expire` como último argumento de `createListAvailability(slots, tenantSettings, expire)` y `createListScheduleSlots(schedules, slots, tenantSettings, expire)`.
- En `getContainer`, antes de `container = {`: `const preAgenda = preAgendaReads(prisma);`; dentro, `...preAgenda,` y `...schedulingReads(prisma, preAgenda.expireDueRequests),`.

- [ ] **Step 7: Correr y ver que pasa**

Run: `npm --prefix backend exec vitest run --project db tests/db/pre-agenda-resolver.test.ts`
Expected: PASS (13 tests).
Run: `npm --prefix backend test` → Expected: PASS (unidad, incluidas `scheduling` y `scheduling-lists`).
Run: `npm --prefix backend run typecheck` → Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/scheduling backend/src/composition/pre-agenda-wiring.ts backend/src/composition-root.ts backend/tests/dominio/scheduling.test.ts backend/tests/dominio/scheduling-lists.test.ts backend/tests/db/pre-agenda-support.ts backend/tests/db/pre-agenda-resolver.test.ts
git commit -m "feat(scheduling): resolucion por Hermes, vencimiento al leer y lectura de solicitudes"
```

---

### Task 5: Bandeja del simulador

**Files:**
- Create: `backend/src/modules/hermes-simulator/domain/inbox.ts`
- Create: `backend/src/modules/hermes-simulator/domain/ports/inbox.ts`
- Create: `backend/src/modules/hermes-simulator/application/inbox.ts`
- Create: `backend/src/modules/hermes-simulator/infrastructure/prisma-inbox-store.ts`
- Modify: `backend/src/composition/pre-agenda-wiring.ts`
- Modify: `backend/src/composition-root.ts` (`WritePorts`, `Container`, `buildWritePorts`)
- Create: `backend/src/http/serializers-sim-inbox.ts`
- Create: `backend/src/app/api/sim/v1/inbox/route.ts`
- Create: `backend/src/app/api/sim/v1/inbox/[id]/approve/route.ts`
- Create: `backend/src/app/api/sim/v1/inbox/[id]/reject/route.ts`
- Create: `backend/tests/dominio/bandeja-simulador.test.ts`
- Create: `backend/tests/db/pre-agenda-bandeja.test.ts`
- Modify: `backend/tests/db/pre-agenda-support.ts` (`inboxPost`)

**Interfaces:**
- Consumes: Tareas 3 y 4 (`createCreateAppointmentRequest`, `createResolveAppointmentRequest`, `createListAppointmentRequests`, `createGetAppointmentRequest`, `createExpireDueRequests`, `createPrismaPreAgendaStore`, `createPrismaRequestExpirer`, `createPrismaAppointmentRequestReader`, `AppointmentRequestView`, `PreAgendaPolicy`), `createReadBotParams` de `bot-config`.
- Produces:
  - `InboxIdentifier`, `InboxRequest`, `InboxResolution` (simulador).
  - `ChatbotRequestsGateway = { listPending(filter: { tenantId: string; cursor: string | null; limit: number }): Promise<Page<InboxRequest>>; get(tenantId: string, id: string): Promise<InboxRequest>; resolve(input: { tenantId: string; requestId: string; resolution: InboxResolution; actor: AuditActor }): Promise<InboxRequest> }`.
  - `SimInboxStore` y `createPrismaSimInboxStore(db)`.
  - `InboxCommand = { tenantId: string; requestId: string; actor: AuditActor }`; `createListInbox({ gateway })`, `createApproveInboxRequest({ gateway, store, ids })`, `createRejectInboxRequest({ gateway })`; `SIM_APPOINTMENT_SYSTEM`.
  - En el contenedor: `Container.listInbox`; en `WritePorts`: `createAppointmentRequest`, `resolveAppointmentRequest`, `approveInboxRequest`, `rejectInboxRequest`.
  - `inboxRequestJson(row: InboxRequest)`.
  - Rutas `GET /api/sim/v1/inbox`, `POST /api/sim/v1/inbox/{id}/approve`, `POST /api/sim/v1/inbox/{id}/reject`.

- [ ] **Step 1: Tipos y puertos del simulador**

Create `backend/src/modules/hermes-simulator/domain/inbox.ts`:

```ts
/** Lo que el simulador ve de una solicitud: solo identificadores de Hermes, como por FHIR. */
export type InboxIdentifier = { readonly system: string; readonly value: string };

export type InboxRef = {
  readonly identifier: InboxIdentifier;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type InboxRequest = {
  readonly id: string;
  readonly kind: "book" | "reschedule" | "cancel";
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly resolutionReason: "slot_unavailable" | "declined" | null;
  readonly patient: {
    readonly identifier: InboxIdentifier;
    readonly documentType: string;
    readonly documentNumber: string;
    readonly givenNames: string;
    readonly familyNames: string;
  };
  readonly slot: InboxRef | null;
  readonly appointment: InboxRef | null;
  readonly resultingAppointment: { readonly identifier: InboxIdentifier } | null;
};

export type InboxResolution =
  | { readonly outcome: "approved"; readonly appointmentIdentifier: InboxIdentifier }
  | { readonly outcome: "rejected"; readonly reason: "slot_unavailable" | "declined" };
```

Create `backend/src/modules/hermes-simulator/domain/ports/inbox.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { Page } from "@/modules/shared/domain/pagination";
import type { InboxIdentifier, InboxRequest, InboxResolution } from "../inbox";

/**
 * El chatbot visto desde Hermes. En la 3.2 lo cumple el composition root en proceso;
 * en la Fase 4, un cliente FHIR con token `service`.
 */
export type ChatbotRequestsGateway = {
  listPending(filter: {
    readonly tenantId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<Page<InboxRequest>>;
  /** Lanza `NotFoundError` si no existe en el tenant. */
  get(tenantId: string, id: string): Promise<InboxRequest>;
  resolve(input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly resolution: InboxResolution;
    readonly actor: AuditActor;
  }): Promise<InboxRequest>;
};

export type SimSlotStatus = "free" | "busy" | "busy_tentative" | "busy_unavailable";

export type SimSlotRef = {
  readonly id: string;
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: SimSlotStatus;
};

export type NewSimAppointment = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: InboxIdentifier;
  readonly patientId: string;
  readonly scheduleId: string;
  readonly slotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type SimInboxStore = {
  findPatientId(tenantId: string, identifier: InboxIdentifier): Promise<string | null>;
  /** Bloquea el cupo del simulador (`FOR UPDATE`). */
  lockSlot(tenantId: string, identifier: InboxIdentifier): Promise<SimSlotRef | null>;
  findAppointment(
    tenantId: string,
    identifier: InboxIdentifier,
  ): Promise<{ readonly id: string; readonly slotId: string } | null>;
  setSlotStatus(tenantId: string, id: string, status: SimSlotStatus): Promise<void>;
  cancelAppointment(tenantId: string, id: string): Promise<void>;
  createAppointment(row: NewSimAppointment): Promise<void>;
};
```

- [ ] **Step 2: Pruebas unitarias de la decisión de Hermes**

Create `backend/tests/dominio/bandeja-simulador.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createApproveInboxRequest } from "@/modules/hermes-simulator/application/inbox";
import type { InboxRequest } from "@/modules/hermes-simulator/domain/inbox";
import type { ChatbotRequestsGateway, SimInboxStore } from "@/modules/hermes-simulator/domain/ports/inbox";
import { ConflictError } from "@/modules/shared/domain/conflict-error";

const ACTOR = { actorSubject: "admin", actorRole: "admin", requestId: "r" };
const ID = (value: string) => ({ system: "urn:test", value });
const WHEN = { startAt: new Date("2026-06-15T14:00:00Z"), endAt: new Date("2026-06-15T14:30:00Z") };

const request = (overrides: Partial<InboxRequest> = {}): InboxRequest => ({
  id: "req-1",
  kind: "book",
  status: "pending",
  createdAt: new Date("2026-06-15T08:00:00Z"),
  expiresAt: new Date("2026-06-15T12:00:00Z"),
  resolutionReason: null,
  patient: { identifier: ID("MR"), documentType: "CC", documentNumber: "1", givenNames: "A", familyNames: "B" },
  slot: { identifier: ID("SL"), ...WHEN },
  appointment: null,
  resultingAppointment: null,
  ...overrides,
});

function fakes(pending: InboxRequest, slotStatus: "free" | "busy" = "free") {
  const gateway: ChatbotRequestsGateway = {
    listPending: vi.fn(),
    get: vi.fn(async () => pending),
    resolve: vi.fn(async ({ resolution }) => ({
      ...pending,
      status: (resolution.outcome === "approved" ? "approved" : "rejected") as InboxRequest["status"],
    })),
  };
  const store: SimInboxStore = {
    findPatientId: vi.fn(async () => "sim-pat"),
    lockSlot: vi.fn(async () => ({ id: "sim-slot", scheduleId: "sim-sched", status: slotStatus, ...WHEN })),
    findAppointment: vi.fn(async () => ({ id: "sim-appt", slotId: "sim-old" })),
    setSlotStatus: vi.fn(async () => {}),
    cancelAppointment: vi.fn(async () => {}),
    createAppointment: vi.fn(async () => {}),
  };
  let n = 0;
  const approve = createApproveInboxRequest({ gateway, store, ids: { next: () => `id-${n++}` } });
  return { gateway, store, approve };
}

const command = { tenantId: "t", requestId: "req-1", actor: ACTOR };

describe("hermes-simulador: decision de la bandeja", () => {
  it("cupo libre: Hermes crea su cita y aprueba con su identificador", async () => {
    const { gateway, store, approve } = fakes(request());
    await approve(command);
    expect(store.setSlotStatus).toHaveBeenCalledWith("t", "sim-slot", "busy");
    expect(store.createAppointment).toHaveBeenCalledOnce();
    expect(gateway.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: { outcome: "approved", appointmentIdentifier: { system: "urn:hermes:appointment", value: "AP-id-0" } } }),
    );
  });

  it("cupo ocupado en Hermes: rechaza por slot_unavailable sin escribir nada", async () => {
    const { gateway, store, approve } = fakes(request(), "busy");
    await approve(command);
    expect(store.setSlotStatus).not.toHaveBeenCalled();
    expect(store.createAppointment).not.toHaveBeenCalled();
    expect(gateway.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: { outcome: "rejected", reason: "slot_unavailable" } }),
    );
  });

  it("paciente desconocido para Hermes: 409 antes de escribir", async () => {
    const { store, approve } = fakes(request());
    vi.mocked(store.findPatientId).mockResolvedValue(null);
    await expect(approve(command)).rejects.toMatchObject({ details: { reason: "patient_not_in_hermes" } });
    expect(store.setSlotStatus).not.toHaveBeenCalled();
  });

  it("solicitud no pendiente: 409 request_not_pending", async () => {
    const { approve } = fakes(request({ status: "expired" }));
    await expect(approve(command)).rejects.toMatchObject({ details: { reason: "request_not_pending", status: "expired" } });
  });

  it("reschedule: cancela la cita vieja de Hermes y reserva el cupo nuevo", async () => {
    const { store, approve } = fakes(request({ kind: "reschedule", appointment: { identifier: ID("AP"), ...WHEN } }));
    await approve(command);
    expect(store.cancelAppointment).toHaveBeenCalledWith("t", "sim-appt");
    expect(store.setSlotStatus).toHaveBeenCalledWith("t", "sim-old", "free");
    expect(store.setSlotStatus).toHaveBeenCalledWith("t", "sim-slot", "busy");
  });

  it("cita desconocida para Hermes: 409 appointment_not_in_hermes", async () => {
    const { store, approve } = fakes(request({ kind: "cancel", slot: null, appointment: { identifier: ID("AP"), ...WHEN } }));
    vi.mocked(store.findAppointment).mockResolvedValue(null);
    await expect(approve(command)).rejects.toBeInstanceOf(ConflictError);
  });

  it("si el chatbot rechaza la resolucion, el error se propaga (la transaccion revierte)", async () => {
    const { gateway, approve } = fakes(request());
    vi.mocked(gateway.resolve).mockRejectedValue(new ConflictError("vencida", { reason: "request_not_pending" }));
    await expect(approve(command)).rejects.toMatchObject({ details: { reason: "request_not_pending" } });
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/bandeja-simulador.test.ts`
Expected: FAIL — no existe `hermes-simulator/application/inbox`.

- [ ] **Step 3: Casos de uso de la bandeja**

Create `backend/src/modules/hermes-simulator/application/inbox.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { InboxIdentifier, InboxRequest, InboxResolution } from "../domain/inbox";
import type { ChatbotRequestsGateway, SimInboxStore } from "../domain/ports/inbox";

export const SIM_APPOINTMENT_SYSTEM = "urn:hermes:appointment";

export type InboxCommand = {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actor: AuditActor;
};

type ApproveDeps = {
  readonly gateway: ChatbotRequestsGateway;
  readonly store: SimInboxStore;
  readonly ids: IdGenerator;
};

export function createListInbox(deps: { readonly gateway: ChatbotRequestsGateway }) {
  return (filter: { tenantId: string; cursor: string | null; limit: number }) =>
    deps.gateway.listPending(filter);
}

async function cancelInHermes(store: SimInboxStore, tenantId: string, identifier: InboxIdentifier) {
  const appointment = await store.findAppointment(tenantId, identifier);
  if (!appointment) {
    throw new ConflictError("Hermes no conoce la cita", { reason: "appointment_not_in_hermes" });
  }
  await store.cancelAppointment(tenantId, appointment.id);
  await store.setSlotStatus(tenantId, appointment.slotId, "free");
}

/** Hermes reserva si su cupo sigue libre; si no, decide rechazar por `slot_unavailable`. */
async function bookInHermes(
  deps: ApproveDeps,
  tenantId: string,
  request: InboxRequest,
  patientId: string,
): Promise<InboxResolution> {
  const slot = request.slot ? await deps.store.lockSlot(tenantId, request.slot.identifier) : null;
  if (!slot || slot.status !== "free") {
    return { outcome: "rejected", reason: "slot_unavailable" };
  }
  if (request.appointment) {
    await cancelInHermes(deps.store, tenantId, request.appointment.identifier);
  }
  await deps.store.setSlotStatus(tenantId, slot.id, "busy");
  const identifier = { system: SIM_APPOINTMENT_SYSTEM, value: `AP-${deps.ids.next()}` };
  await deps.store.createAppointment({
    id: deps.ids.next(),
    tenantId,
    identifier,
    patientId,
    scheduleId: slot.scheduleId,
    slotId: slot.id,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
  return { outcome: "approved", appointmentIdentifier: identifier };
}

async function decide(deps: ApproveDeps, tenantId: string, request: InboxRequest, patientId: string) {
  if (request.kind !== "cancel") {
    return bookInHermes(deps, tenantId, request, patientId);
  }
  if (!request.appointment) {
    throw new ConflictError("Hermes no conoce la cita", { reason: "appointment_not_in_hermes" });
  }
  await cancelInHermes(deps.store, tenantId, request.appointment.identifier);
  const approved: InboxResolution = {
    outcome: "approved",
    appointmentIdentifier: request.appointment.identifier,
  };
  return approved;
}

/**
 * Primero escribe Hermes (fuente de verdad) y despues resuelve en el chatbot. En la 3.2 ambos
 * comparten transaccion: si el chatbot rechaza, la reversion deshace lo escrito en hermes_sim.
 */
export function createApproveInboxRequest(deps: ApproveDeps) {
  return async (command: InboxCommand): Promise<InboxRequest> => {
    const request = await deps.gateway.get(command.tenantId, command.requestId);
    if (request.status !== "pending") {
      throw new ConflictError("La solicitud ya no esta pendiente", {
        reason: "request_not_pending",
        status: request.status,
      });
    }
    const patientId = await deps.store.findPatientId(command.tenantId, request.patient.identifier);
    if (!patientId) {
      throw new ConflictError("Hermes no conoce al paciente", { reason: "patient_not_in_hermes" });
    }
    const resolution = await decide(deps, command.tenantId, request, patientId);
    return deps.gateway.resolve({ ...command, resolution });
  };
}

export function createRejectInboxRequest(deps: { readonly gateway: ChatbotRequestsGateway }) {
  return (command: InboxCommand): Promise<InboxRequest> =>
    deps.gateway.resolve({ ...command, resolution: { outcome: "rejected", reason: "declined" } });
}
```

Run: `npm --prefix backend exec vitest run tests/dominio/bandeja-simulador.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 4: Almacén Prisma del simulador**

Create `backend/src/modules/hermes-simulator/infrastructure/prisma-inbox-store.ts`:

```ts
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { SimInboxStore } from "../domain/ports/inbox";

export function createPrismaSimInboxStore(db: PrismaExecutor): SimInboxStore {
  return {
    async findPatientId(tenantId, identifier) {
      const row = await db.simPatient.findFirst({
        where: { tenantId, identifierSystem: identifier.system, identifierValue: identifier.value },
        select: { id: true },
      });
      return row?.id ?? null;
    },
    async lockSlot(tenantId, identifier) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "hermes_sim"."slots"
        WHERE "tenant_id" = ${tenantId} AND "identifier_system" = ${identifier.system}
          AND "identifier_value" = ${identifier.value}
        FOR UPDATE`;
      const id = locked[0]?.id;
      if (!id) {
        return null;
      }
      const row = await db.simSlot.findFirstOrThrow({ where: { tenantId, id } });
      return { id: row.id, scheduleId: row.scheduleId, startAt: row.startAt, endAt: row.endAt, status: row.status };
    },
    async findAppointment(tenantId, identifier) {
      const row = await db.simAppointment.findFirst({
        where: { tenantId, identifierSystem: identifier.system, identifierValue: identifier.value },
        select: { id: true, slotId: true },
      });
      return row ?? null;
    },
    async setSlotStatus(tenantId, id, status) {
      await db.simSlot.updateMany({ where: { tenantId, id }, data: { status } });
    },
    async cancelAppointment(tenantId, id) {
      await db.simAppointment.updateMany({ where: { tenantId, id }, data: { status: "cancelled" } });
    },
    async createAppointment(row) {
      await db.simAppointment.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          identifierSystem: row.identifier.system,
          identifierValue: row.identifier.value,
          patientId: row.patientId,
          scheduleId: row.scheduleId,
          slotId: row.slotId,
          startAt: row.startAt,
          endAt: row.endAt,
          status: "booked",
        },
      });
    },
  };
}
```

- [ ] **Step 5: Cableado completo**

Reemplaza `backend/src/composition/pre-agenda-wiring.ts` por:

```ts
import type { PrismaClient } from "@prisma/client";
import { createReadBotParams } from "../modules/bot-config/application/widget-access";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import {
  createApproveInboxRequest,
  createListInbox,
  createRejectInboxRequest,
} from "../modules/hermes-simulator/application/inbox";
import type { InboxRequest } from "../modules/hermes-simulator/domain/inbox";
import type { ChatbotRequestsGateway } from "../modules/hermes-simulator/domain/ports/inbox";
import { createPrismaSimInboxStore } from "../modules/hermes-simulator/infrastructure/prisma-inbox-store";
import {
  createExpireDueRequests,
  createGetAppointmentRequest,
  createListAppointmentRequests,
} from "../modules/scheduling/application/appointment-request-queries";
import { createCreateAppointmentRequest } from "../modules/scheduling/application/create-appointment-request";
import {
  createResolveAppointmentRequest,
  type ResolveAppointmentRequest,
} from "../modules/scheduling/application/resolve-appointment-request";
import type {
  AppointmentRequestView,
  PreAgendaPolicy,
} from "../modules/scheduling/domain/ports/pre-agenda";
import { createPrismaAppointmentRequestReader } from "../modules/scheduling/infrastructure/prisma-appointment-request-reader";
import {
  createPrismaPreAgendaStore,
  createPrismaRequestExpirer,
} from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import { toTenantId } from "../modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "../modules/shared/infrastructure/prisma-audit-log";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";

/**
 * Cableado de la pre-agenda (3.2) y de la bandeja del simulador. Vive aparte para no
 * empujar `composition-root.ts` por encima del limite de lineas por archivo de logica.
 */

export function preAgendaPolicy(db: PrismaExecutor): PreAgendaPolicy {
  const readParams = createReadBotParams(createPrismaBotConfigRepository(db));
  return {
    async read(tenantId) {
      const params = await readParams(tenantId);
      return {
        holdMinutes: params.request_hold_minutes,
        maxPendingHolds: params.max_pending_requests_per_patient,
      };
    },
  };
}

function toInboxRequest(view: AppointmentRequestView): InboxRequest {
  return {
    id: view.id,
    kind: view.kind,
    status: view.status,
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    resolutionReason: view.resolutionReason,
    patient: view.patient,
    slot: view.slot,
    appointment: view.appointment,
    resultingAppointment: view.resultingAppointment,
  };
}

/** Adaptador en proceso del puerto del simulador. En la Fase 4 lo reemplaza un cliente FHIR. */
function chatbotRequestsGateway(db: PrismaExecutor, resolve: ResolveAppointmentRequest): ChatbotRequestsGateway {
  const reader = createPrismaAppointmentRequestReader(db);
  const expire = createExpireDueRequests({ expirer: createPrismaRequestExpirer(db), clock: systemClock });
  const list = createListAppointmentRequests({ reader, expire });
  const get = createGetAppointmentRequest({ reader, expire });
  return {
    async listPending(filter) {
      const tenantId = toTenantId(filter.tenantId);
      const page = await list({ tenantId, status: "pending", cursor: filter.cursor, limit: filter.limit });
      return { data: page.data.map(toInboxRequest), nextCursor: page.nextCursor };
    },
    async get(tenantId, id) {
      return toInboxRequest(await get(toTenantId(tenantId), id));
    },
    async resolve(input) {
      const tenantId = toTenantId(input.tenantId);
      await resolve({ tenantId, requestId: input.requestId, resolution: input.resolution, actor: input.actor });
      return toInboxRequest(await get(tenantId, input.requestId));
    },
  };
}

function resolverFor(db: PrismaExecutor, audit: AuditLog): ResolveAppointmentRequest {
  return createResolveAppointmentRequest({
    store: createPrismaPreAgendaStore(db),
    ids: uuidV7Generator,
    clock: systemClock,
    audit,
  });
}

export function preAgendaReads(prisma: PrismaClient) {
  const resolve = resolverFor(prisma, createPrismaAuditLog(prisma, uuidV7Generator));
  return {
    expireDueRequests: createExpireDueRequests({
      expirer: createPrismaRequestExpirer(prisma),
      clock: systemClock,
    }),
    listInbox: createListInbox({ gateway: chatbotRequestsGateway(prisma, resolve) }),
  };
}

export type PreAgendaReads = ReturnType<typeof preAgendaReads>;

export function preAgendaWritePorts(db: PrismaExecutor, auditLog: AuditLog) {
  const resolveAppointmentRequest = resolverFor(db, auditLog);
  const gateway = chatbotRequestsGateway(db, resolveAppointmentRequest);
  return {
    createAppointmentRequest: createCreateAppointmentRequest({
      store: createPrismaPreAgendaStore(db),
      policy: preAgendaPolicy(db),
      ids: uuidV7Generator,
      clock: systemClock,
      audit: auditLog,
    }),
    resolveAppointmentRequest,
    approveInboxRequest: createApproveInboxRequest({
      gateway,
      store: createPrismaSimInboxStore(db),
      ids: uuidV7Generator,
    }),
    rejectInboxRequest: createRejectInboxRequest({ gateway }),
  };
}
```

En `backend/src/composition-root.ts`:
- El import pasa a `import { type PreAgendaReads, preAgendaReads, preAgendaWritePorts } from "./composition/pre-agenda-wiring";`.
- Junto a `type WidgetWritePorts = …`: `type PreAgendaWritePorts = ReturnType<typeof preAgendaWritePorts>;` y `WritePorts` gana `& PreAgendaWritePorts`.
- `Container` gana `readonly listInbox: PreAgendaReads["listInbox"];`.
- En `buildWritePorts`, tras `...widgetWritePorts(db),`: `...preAgendaWritePorts(db, auditLog),`.

- [ ] **Step 6: Serializador y rutas**

Create `backend/src/http/serializers-sim-inbox.ts`:

```ts
import type { InboxIdentifier, InboxRef, InboxRequest } from "@/modules/hermes-simulator/domain/inbox";

function identifierJson(identifier: InboxIdentifier) {
  return { system: identifier.system, value: identifier.value };
}

function refJson(ref: InboxRef | null) {
  return ref && {
    identifier: identifierJson(ref.identifier),
    start_at: ref.startAt.toISOString(),
    end_at: ref.endAt.toISOString(),
  };
}

/** Datos de identificacion para la bandeja; ningun dato clinico. */
export function inboxRequestJson(row: InboxRequest) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    resolution_reason: row.resolutionReason,
    patient: {
      identifier: identifierJson(row.patient.identifier),
      document_type: row.patient.documentType,
      document_number: row.patient.documentNumber,
      given_names: row.patient.givenNames,
      family_names: row.patient.familyNames,
    },
    slot: refJson(row.slot),
    appointment: refJson(row.appointment),
    resulting_appointment: row.resultingAppointment && {
      identifier: identifierJson(row.resultingAppointment.identifier),
    },
  };
}
```

Create `backend/src/app/api/sim/v1/inbox/route.ts`:

```ts
import { getContainer } from "@/composition-root";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { pageJson } from "@/http/serializers";
import { inboxRequestJson } from "@/http/serializers-sim-inbox";
import { parseLimit } from "@/modules/shared/domain/pagination";

export const dynamic = "force-dynamic";

/** Bandeja de Hermes: solicitudes pendientes y vivas del tenant del token. */
export const GET = privateRoute(["admin"], async ({ actor, request }) => {
  requireSimulatorEnabled();
  const url = new URL(request.url);
  const page = await getContainer().listInbox({
    tenantId: actor.tenantId,
    cursor: url.searchParams.get("cursor"),
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return pageJson(page, inboxRequestJson);
});
```

Create `backend/src/app/api/sim/v1/inbox/[id]/approve/route.ts`:

```ts
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { inboxRequestJson } from "@/http/serializers-sim-inbox";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const resolved = await ports.approveInboxRequest({
      tenantId: actor.tenantId,
      requestId: id,
      actor: { actorSubject: actor.subject, actorRole: actor.role, requestId },
    });
    return { status: 200, body: inboxRequestJson(resolved) };
  })(request);
```

Create `backend/src/app/api/sim/v1/inbox/[id]/reject/route.ts` igual que `approve/route.ts` cambiando `ports.approveInboxRequest` por `ports.rejectInboxRequest`:

```ts
import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { inboxRequestJson } from "@/http/serializers-sim-inbox";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    const resolved = await ports.rejectInboxRequest({
      tenantId: actor.tenantId,
      requestId: id,
      actor: { actorSubject: actor.subject, actorRole: actor.role, requestId },
    });
    return { status: 200, body: inboxRequestJson(resolved) };
  })(request);
```

- [ ] **Step 7: Pruebas HTTP de la bandeja**

Create `backend/tests/db/pre-agenda-bandeja.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/sim/v1/inbox/[id]/approve/route";
import { POST as reject } from "@/app/api/sim/v1/inbox/[id]/reject/route";
import { GET as listInbox } from "@/app/api/sim/v1/inbox/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/token";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  inboxPost,
  seedWorld,
  slotAt,
  type World,
} from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

/** Cupos futuros: la bandeja corre con el reloj del sistema. */
function futureStart(): Date {
  const start = new Date(Date.now() + 48 * HOUR_MS);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("pre-agenda: bandeja del simulador", () => {
  let world: World;
  let token: string;
  const clock = clockAt(new Date());

  const book = (slotIndex: number) =>
    createRequest(prisma, clock, { kind: "book", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId, slotId: slotAt(world, slotIndex), actor: ACTOR });
  const simSlot = (value: string) => prisma.simSlot.findFirstOrThrow({ where: { tenantId: world.tenantId, identifierValue: value } });
  const slot = (id: string) => prisma.slot.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    clock.set(new Date());
    world = await seedWorld(prisma, "a", futureStart());
    token = await signToken({ role: "admin", tenantId: world.tenantId, subject: "admin-a" });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("lista solo las pendientes vivas, con identificadores de Hermes", async () => {
    const live = await book(0);
    const stale = await book(1);
    await prisma.appointmentRequest.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await listInbox(authedRequest("http://localhost/api/sim/v1/inbox", token));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([live.id]);
    expect(body.data[0]).toMatchObject({
      kind: "book",
      patient: { identifier: { value: "MR-a" }, document_number: "1000a" },
      slot: { identifier: { value: "SL-a-0" } },
    });
    expect((await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("expired");
    expect((await slot(slotAt(world, 1))).status).toBe("free");
  });

  it("aprobar book deja cita y cupo coherentes en ambos lados", async () => {
    const request = await book(0);
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("approved");
    const identifier = body.resulting_appointment.identifier.value as string;
    expect((await slot(slotAt(world, 0))).status).toBe("busy");
    expect((await simSlot("SL-a-0")).status).toBe("busy");
    const chatbotAppt = await prisma.appointment.findFirstOrThrow({ where: { identifierValue: identifier } });
    const hermesAppt = await prisma.simAppointment.findFirstOrThrow({ where: { identifierValue: identifier } });
    expect(chatbotAppt.status).toBe("booked");
    expect(hermesAppt.status).toBe("booked");
    expect(chatbotAppt.startAt).toEqual(hermesAppt.startAt);
  });

  it("cupo ocupado en Hermes: 200 rechazada por slot_unavailable y cupo liberado", async () => {
    const request = await book(0);
    await prisma.simSlot.updateMany({ where: { identifierValue: "SL-a-0" }, data: { status: "busy" } });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "rejected", resolution_reason: "slot_unavailable" });
    expect((await slot(slotAt(world, 0))).status).toBe("free");
    expect(await prisma.simAppointment.count()).toBe(1);
  });

  it("aprobar reschedule mueve la cita en ambos lados", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "reschedule", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId, slotId: slotAt(world, 1), actor: ACTOR,
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(200);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status).toBe("cancelled");
    expect((await prisma.simAppointment.findFirstOrThrow({ where: { identifierValue: "AP-a" } })).status).toBe("cancelled");
    expect((await simSlot("SL-a-booked")).status).toBe("free");
    expect((await slot(world.bookedSlotId)).status).toBe("free");
    expect((await simSlot("SL-a-1")).status).toBe("busy");
    expect((await slot(slotAt(world, 1))).status).toBe("busy");
  });

  it("aprobar cancel cancela en ambos lados", async () => {
    const request = await createRequest(prisma, clock, {
      kind: "cancel", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId,
      appointmentId: world.appointmentId, actor: ACTOR,
    });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(200);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: world.appointmentId } })).status).toBe("cancelled");
    expect((await prisma.simAppointment.findFirstOrThrow({ where: { identifierValue: "AP-a" } })).status).toBe("cancelled");
    expect((await simSlot("SL-a-booked")).status).toBe("free");
  });

  it("rechazar libera el cupo y no toca Hermes", async () => {
    const request = await book(0);
    const response = await reject(inboxPost(`${request.id}/reject`, token), params(request.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "rejected", resolution_reason: "declined" });
    expect((await slot(slotAt(world, 0))).status).toBe("free");
    expect((await simSlot("SL-a-0")).status).toBe("free");
  });

  it("paciente desconocido para Hermes: 409 y nada escrito en ningun lado", async () => {
    const request = await book(0);
    await prisma.simPatient.updateMany({ where: { identifierValue: "MR-a" }, data: { identifierValue: "MR-otro" } });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toMatchObject({ reason: "patient_not_in_hermes" });
    expect((await simSlot("SL-a-0")).status).toBe("free");
    expect((await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("pending");
  });

  it("aprobar una vencida: 409 request_not_pending", async () => {
    const request = await book(0);
    await prisma.appointmentRequest.update({ where: { id: request.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await approve(inboxPost(`${request.id}/approve`, token), params(request.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toMatchObject({ reason: "request_not_pending" });
    expect((await simSlot("SL-a-0")).status).toBe("free");
  });
});
```

Antes de escribir el archivo, añade a `backend/tests/db/pre-agenda-support.ts` (con `import { authedRequest } from "../helpers/token";`):

```ts
let inboxKeyCounter = 0;

/** POST a la bandeja con una `Idempotency-Key` nueva salvo que se pase una. */
export function inboxPost(path: string, token: string, key = `inbox-${inboxKeyCounter++}`) {
  return authedRequest(`http://localhost/api/sim/v1/inbox/${path}`, token, {
    method: "POST",
    headers: { "Idempotency-Key": key },
  });
}
```

- [ ] **Step 8: Correr y ver que pasa**

Run: `npm --prefix backend exec vitest run --project db tests/db/pre-agenda-bandeja.test.ts`
Expected: PASS (8 tests).
Run: `npm --prefix backend run typecheck` y `npm --prefix backend test` → Expected: verdes. `contrato-api` fallará por «ruta sin declarar»: se arregla en la Tarea 6; anótalo, no lo tapes.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/hermes-simulator/domain/inbox.ts backend/src/modules/hermes-simulator/domain/ports/inbox.ts backend/src/modules/hermes-simulator/application/inbox.ts backend/src/modules/hermes-simulator/infrastructure/prisma-inbox-store.ts backend/src/composition/pre-agenda-wiring.ts backend/src/composition-root.ts backend/src/http/serializers-sim-inbox.ts backend/src/app/api/sim/v1/inbox backend/tests/dominio/bandeja-simulador.test.ts backend/tests/db/pre-agenda-bandeja.test.ts backend/tests/db/pre-agenda-support.ts
git commit -m "feat(simulador): bandeja de Hermes que aprueba y rechaza solicitudes"
```

---

### Task 6: Contrato, cliente, roles, aislamiento, idempotencia y fronteras

**Files:**
- Modify: `backend/src/http/openapi-sim.ts` (paths de la bandeja)
- Regenerate: `backend/openapi-sim.json`, `backend/openapi.json`, `backend/openapi-platform.json`
- Regenerate: `frontend/src/sim/**` (orval)
- Modify: `backend/tests/roles.test.ts`
- Modify: `backend/tests/db/aislamiento-tenant.test.ts`
- Modify: `backend/tests/db/idempotencia-http.test.ts`
- Modify: `backend/tests/fronteras.test.ts`

**Interfaces:**
- Consumes: rutas de la Tarea 5; `seedWorld`, `slotAt`, `createRequest`, `clockAt`, `ACTOR`, `HOUR_MS`, `inboxPost` del soporte.
- Produces: operationIds `listSimInbox`, `approveSimInboxRequest`, `rejectSimInboxRequest`.

- [ ] **Step 1: Ver fallar el contrato**

Run: `npm --prefix backend exec vitest run tests/contrato-api.test.ts`
Expected: FAIL en «toda ruta de /api/sim/v1 esta declarada en el contrato sim» (faltan `/inbox`, `/inbox/{id}/approve`, `/inbox/{id}/reject`).

- [ ] **Step 2: Declarar la bandeja en OpenAPI**

En `backend/src/http/openapi-sim.ts`, antes de `/** Contrato del simulador Hermes (/api/sim/v1). */`, añade:

```ts
const IDENTIFIER_SCHEMA = {
  type: "object",
  required: ["system", "value"],
  properties: { system: { type: "string" }, value: { type: "string" } },
} as const;

const REF_SCHEMA = {
  type: ["object", "null"],
  required: ["identifier", "start_at", "end_at"],
  properties: {
    identifier: IDENTIFIER_SCHEMA,
    start_at: { type: "string", format: "date-time" },
    end_at: { type: "string", format: "date-time" },
  },
} as const;

const INBOX_REQUEST_SCHEMA = {
  type: "object",
  required: ["id", "kind", "status", "created_at", "expires_at", "resolution_reason", "patient", "slot", "appointment", "resulting_appointment"],
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["book", "reschedule", "cancel"] },
    status: { type: "string", enum: ["pending", "approved", "rejected", "expired"] },
    created_at: { type: "string", format: "date-time" },
    expires_at: { type: "string", format: "date-time" },
    resolution_reason: { type: ["string", "null"], enum: ["slot_unavailable", "declined", null] },
    patient: {
      type: "object",
      required: ["identifier", "document_type", "document_number", "given_names", "family_names"],
      properties: {
        identifier: IDENTIFIER_SCHEMA,
        document_type: { type: "string" },
        document_number: { type: "string" },
        given_names: { type: "string" },
        family_names: { type: "string" },
      },
    },
    slot: REF_SCHEMA,
    appointment: REF_SCHEMA,
    resulting_appointment: {
      type: ["object", "null"],
      required: ["identifier"],
      properties: { identifier: IDENTIFIER_SCHEMA },
    },
  },
} as const;

function inboxDecision(operationId: string, summary: string) {
  return {
    post: {
      operationId,
      summary,
      security: [{ bearerAuth: [] }],
      parameters: [
        REQUEST_ID_PARAMETER,
        IDEMPOTENCY_PARAMETER,
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Solicitud resuelta",
          headers: REQUEST_ID_RESPONSE_HEADER,
          content: { "application/json": { schema: { $ref: "#/components/schemas/InboxRequest" } } },
        },
        ...writeErrors,
      },
    },
  };
}

const INBOX_PATHS = {
  "/inbox": {
    get: {
      operationId: "listSimInbox",
      summary: "Solicitudes pendientes y vivas del tenant (vence las caducadas antes de responder)",
      security: [{ bearerAuth: [] }],
      parameters: [
        REQUEST_ID_PARAMETER,
        { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
      ],
      responses: {
        "200": {
          description: "OK",
          headers: REQUEST_ID_RESPONSE_HEADER,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data", "next_cursor"],
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/InboxRequest" } },
                  next_cursor: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        ...readErrors,
      },
    },
  },
  "/inbox/{id}/approve": inboxDecision(
    "approveSimInboxRequest",
    "Hermes aprueba: reserva si su cupo sigue libre; si no, rechaza por slot_unavailable",
  ),
  "/inbox/{id}/reject": inboxDecision("rejectSimInboxRequest", "Hermes rechaza (declined)"),
} as const;
```

En `buildSimOpenApiDocument`: añade `InboxRequest: INBOX_REQUEST_SCHEMA,` dentro de `components.schemas` (junto a `Error`), añade `...INBOX_PATHS,` al final de `paths`, cambia `version: "0.2.0"` por `version: "0.3.0"` y la descripción por `"CRUD de maestros y bandeja de solicitudes del simulador. Apagable con HERMES_SIMULATOR_ENABLED."`.

Run: `npm --prefix backend run openapi:generate`
Run: `npm --prefix backend exec vitest run tests/contrato-api.test.ts` → Expected: PASS.

- [ ] **Step 3: Regenerar el cliente del frontend**

Run: `npm --prefix frontend run api:generate`
Run: `npm --prefix frontend run typecheck` (o `npm run typecheck` desde la raíz) → Expected: sin errores.
Run: `npm run doctor` → Expected: sin hallazgos nuevos.

- [ ] **Step 4: Roles (sin base)**

En `backend/tests/roles.test.ts`, importa `import { GET as getSimInbox } from "@/app/api/sim/v1/inbox/route";` y añade al final:

```ts
describe("roles: bandeja del simulador", () => {
  it("operator y widget reciben 403", async () => {
    for (const role of ["operator", "widget"] as const) {
      const token = await signToken({ role, tenantId: "tenant-a", sessionId: role === "widget" ? "s-1" : undefined });
      const response = await getSimInbox(authorized(token));
      expect(response.status).toBe(403);
    }
  });

  it("con el simulador apagado, admin recibe 404", async () => {
    resetContainer();
    const token = await signToken({ role: "admin", tenantId: "tenant-a" });
    const response = await getSimInbox(authorized(token));
    expect(response.status).toBe(404);
  });
});
```

(El proyecto `unit` no define `HERMES_SIMULATOR_ENABLED`, así que el simulador está apagado. `authorized` apunta a `/api/v1/me`; la ruta no lee la URL antes de fallar.)

Run: `npm --prefix backend exec vitest run tests/roles.test.ts` → Expected: PASS.

- [ ] **Step 5: Aislamiento por tenant**

En `backend/tests/db/aislamiento-tenant.test.ts`, añade imports:

```ts
import { POST as approveInbox } from "@/app/api/sim/v1/inbox/[id]/approve/route";
import { POST as rejectInbox } from "@/app/api/sim/v1/inbox/[id]/reject/route";
import { GET as listSimInbox } from "@/app/api/sim/v1/inbox/route";
import { ACTOR, clockAt, createRequest, HOUR_MS, inboxPost, seedWorld, slotAt } from "./pre-agenda-support";
```

y al final del archivo:

```ts
describe("aislamiento-tenant: bandeja del simulador", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("la bandeja de B no ve ni resuelve solicitudes de A", async () => {
    const start = new Date(Date.now() + 48 * HOUR_MS);
    start.setUTCMinutes(0, 0, 0);
    const a = await seedWorld(prisma, "a", start);
    const b = await seedWorld(prisma, "b", start);
    const request = await createRequest(prisma, clockAt(new Date()), {
      kind: "book", tenantId: a.tenantId, medicalRecordId: a.medicalRecordId, slotId: slotAt(a, 0), actor: ACTOR,
    });
    const tokenB = await signToken({ role: "admin", tenantId: b.tenantId });

    const list = await listSimInbox(authedRequest("http://localhost/api/sim/v1/inbox", tokenB));
    expect((await list.json()).data).toEqual([]);

    const context = { params: Promise.resolve({ id: request.id }) };
    expect((await approveInbox(inboxPost(`${request.id}/approve`, tokenB), context)).status).toBe(404);
    const context2 = { params: Promise.resolve({ id: request.id }) };
    expect((await rejectInbox(inboxPost(`${request.id}/reject`, tokenB), context2)).status).toBe(404);
    expect((await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("pending");
  });
});
```

Si `beforeEach`/`truncateAll`/`resetContainer` no están ya importados en el archivo, añádelos a sus imports existentes.

- [ ] **Step 6: Idempotencia y cursor manipulado**

En `backend/tests/db/idempotencia-http.test.ts`, añade imports:

```ts
import { POST as approveInbox } from "@/app/api/sim/v1/inbox/[id]/approve/route";
import { POST as rejectInbox } from "@/app/api/sim/v1/inbox/[id]/reject/route";
import { GET as listSimInbox } from "@/app/api/sim/v1/inbox/route";
import { ACTOR, clockAt, createRequest, HOUR_MS, inboxPost, seedWorld, slotAt } from "./pre-agenda-support";
```

y al final:

```ts
describe("idempotencia: bandeja del simulador", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  async function pendingBook() {
    const start = new Date(Date.now() + 48 * HOUR_MS);
    start.setUTCMinutes(0, 0, 0);
    const world = await seedWorld(prisma, "a", start);
    const request = await createRequest(prisma, clockAt(new Date()), {
      kind: "book", tenantId: world.tenantId, medicalRecordId: world.medicalRecordId, slotId: slotAt(world, 0), actor: ACTOR,
    });
    const token = await signToken({ role: "admin", tenantId: world.tenantId, subject: "admin-a" });
    return { request, token };
  }

  it("aprobar dos veces con la misma clave: misma respuesta y una sola cita nueva", async () => {
    const { request, token } = await pendingBook();
    const ctx = () => ({ params: Promise.resolve({ id: request.id }) });
    const first = await approveInbox(inboxPost(`${request.id}/approve`, token, "k-approve"), ctx());
    const second = await approveInbox(inboxPost(`${request.id}/approve`, token, "k-approve"), ctx());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await prisma.appointment.count()).toBe(2);
    expect(await prisma.simAppointment.count()).toBe(2);
  });

  it("la misma clave en otra ruta responde 409", async () => {
    const { request, token } = await pendingBook();
    const ctx = () => ({ params: Promise.resolve({ id: request.id }) });
    await approveInbox(inboxPost(`${request.id}/approve`, token, "k-shared"), ctx());
    const conflict = await rejectInbox(inboxPost(`${request.id}/reject`, token, "k-shared"), ctx());
    expect(conflict.status).toBe(409);
  });

  it("un cursor manipulado en la bandeja es 422, nunca 500", async () => {
    const { token } = await pendingBook();
    const response = await listSimInbox(
      authedRequest("http://localhost/api/sim/v1/inbox?cursor=no-es-un-cursor%24", token),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("validation_failed");
  });
});
```

(Cada mundo tiene una cita en firme sembrada; por eso los conteos esperan 2.)

- [ ] **Step 7: Fronteras**

En `backend/tests/fronteras.test.ts`, añade al final del `describe`:

```ts
  it("scheduling no importa bot-config ni hermes-simulator", () => {
    const offenders = listFiles(join(MODULES_DIR, "scheduling")).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => /modules\/(bot-config|hermes-simulator)(\/|$)/.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
```

(La regla «hermes-simulator solo importa shared y auth» ya existe y cubre el puerto del simulador.)

- [ ] **Step 8: Correr todo lo tocado**

Run: `npm --prefix backend test` → Expected: PASS.
Run: `npm --prefix backend run test:db` → Expected: PASS.
Run: `npm run ci` y `npm run typecheck` (raíz) → Expected: verdes.

- [ ] **Step 9: Commit**

```bash
git add backend/src/http/openapi-sim.ts backend/openapi-sim.json backend/openapi.json backend/openapi-platform.json frontend/src/sim backend/tests/roles.test.ts backend/tests/db/aislamiento-tenant.test.ts backend/tests/db/idempotencia-http.test.ts backend/tests/fronteras.test.ts
git commit -m "feat(simulador): contrato de la bandeja, cliente orval y suites de roles, aislamiento e idempotencia"
```

---

### Task 7: Gobernanza, documentación y verificación final

**Files:**
- Modify: `GOBERNANZA.md` (§1.2)
- Modify: `CLAUDE.md` (estado de la Fase 3)
- Modify: `docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md` (línea de estado)

- [ ] **Step 1: Política de apartado en la gobernanza**

En `GOBERNANZA.md`, al final de §1.2 (después de «Cualquier estado propio es provisional hasta que Hermes lo resuelva.»), añade:

```markdown

**Política de apartado (pre-agenda, Fase 3.2).** Una solicitud `book` o `reschedule` pasa el
cupo de `free` a `busy_tentative` en la misma transacción que la crea; dos solicitudes
concurrentes nunca apartan el mismo cupo. El apartado vence a los `request_hold_minutes` del
tenant (240 por defecto, 15–4320) o al inicio del cupo si llega antes; las cancelaciones no
apartan cupo y vencen con el mismo plazo. Cada historia clínica admite como máximo
`max_pending_requests_per_patient` solicitudes `book`/`reschedule` vivas (2 por defecto, 1–5);
las cancelaciones no cuentan. Cada cita en firme admite una sola solicitud de cambio viva. El
vencimiento se evalúa al leer y al crear o resolver; nunca se resuelve una solicitud vencida.
```

- [ ] **Step 2: Estado en `CLAUDE.md` y en la spec**

En `CLAUDE.md`, sustituye la viñeta que empieza por `- **3.2 pre-agenda — siguiente**` por:

```markdown
- **3.2 pre-agenda — implementada** en la rama `fase-3-2-pre-agenda` (spec en `docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md`): tabla `appointment_requests`, apartado atómico `free` → `busy_tentative`, tope por paciente, vencimiento al leer y bandeja del simulador (`/api/sim/v1/inbox`) que resuelve en proceso vía `ChatbotRequestsGateway`. El motor de la 3.3 consume `createAppointmentRequest` (en `WritePorts`).
```

En la spec, la línea de estado pasa a `> Estado: **implementada** en la rama \`fase-3-2-pre-agenda\` (pendiente de merge por el usuario).`

- [ ] **Step 3: Verificación completa**

Run, desde la raíz, y confirma cada salida antes de seguir:
- `npm run ci` → Biome sin errores.
- `npm run typecheck` → sin errores en backend y frontend.
- `npm test` → verde.
- `npm --prefix backend run test:db` → verde (incluye `pre-agenda-*`, `aislamiento-tenant`, `idempotencia-http`, `simetria-seed`).
- `npm run doctor` → sin hallazgos nuevos.
- `npm --prefix backend exec vitest run tests/sin-ia.test.ts` → verde.

Si algo falla, arréglalo en la tarea que corresponda y vuelve a correr la lista entera.

- [ ] **Step 4: Commit**

```bash
git add GOBERNANZA.md CLAUDE.md docs/superpowers/specs/2026-09-25-fase-3-2-pre-agenda-design.md
git commit -m "docs: politica de apartado en la gobernanza y estado de la 3.2"
```
