# Fase 3.3 — Motor conversacional: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat del widget funcionando por HTTP: identificación → verificación (banco de preguntas, par fijo, bloqueo) o pre-registro → agendar / reprogramar / cancelar como solicitudes, consultas a la KB y handoff a asesor, con historial redactado, CORS en las rutas del widget y alta/baja individual de orígenes.

**Architecture:** Módulo nuevo `conversation` con una máquina de estados en `domain`: cada paso (`Step`) tiene `enter` (arma el turno con sus opciones) y `handle` (procesa la entrada), lee por un puerto de solo lectura (`ConversationReads`) y **declara** a lo sumo un efecto de escritura (`Effect`) con una continuación pura (`then`). El motor (`runTurn`) resuelve opciones vigentes, navegación global y efectos; la capa `application` carga la conversación con bloqueo, renderiza textos de `bot-config` y persiste mensajes redactados. Los efectos los cumple `composition/conversation-wiring.ts` llamando a casos de uso de `scheduling`, `patients`, `verification` y `handoff`, cada uno dentro de un `SAVEPOINT`.

**Tech Stack:** Next.js 16 (route handlers), Prisma 7 + Postgres (`@prisma/adapter-pg`), Vitest (proyectos `unit` y `db`), Biome 2, orval (cliente del frontend).

**Spec:** `docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md`

## Global Constraints

- Sin IA: ninguna dependencia ni import de LLM, embeddings, vectores o n8n (`sin-ia`).
- Hermes es la fuente de verdad: el chat solo crea **solicitudes** (`createAppointmentRequest`) y pre-registros `pre_registered`; nunca una cita en firme.
- `tenant_id` solo del claim del JWT. Recurso de otro tenant u otra sesión → `404`, nunca `403`.
- Rol `widget`: solo `/widget/conversation*` y `/widget/sessions/refresh` de su propia sesión.
- No divulgación: respuestas de verificación nunca en `conversation_messages`, `conversations.context`, `audit_events`, logs ni cuerpos de respuesta. Todo texto libre del paciente se guarda como `[redactado]`, salvo el número de documento, que se guarda enmascarado (`CC ••••5678`).
- Toda escritura HTTP exige `Idempotency-Key` persistida en base de datos.
- `domain` y `application` no importan `next`, `@prisma/client`, `node:*` ni `react`.
- `conversation` solo importa `shared`, `auth` y `verification/domain`; `verification`, `handoff` solo `shared` y `auth`.
- `process.env` solo en `backend/src/config/env.ts`.
- Clean Code: complejidad cognitiva ≤ 15, ≤ 40 líneas por función (sin blancos), ≤ 400 líneas por archivo de lógica, 0 ciclos de importación. `composition-root.ts` va por 382 líneas: la Tarea 13 saca `simReads` a `composition/sim-wiring.ts` antes de añadir nada.
- Código, rutas y campos en inglés; comentarios, mensajes y textos en español.
- `openapi.json` es generado: se edita `src/http/openapi*.ts` y se corre `npm --prefix backend run openapi:generate`; el cliente del frontend se regenera con `npm --prefix frontend run api:generate`, nunca a mano.
- Params nuevos de `bot-config`: `verification_max_attempts` 3 (1–5) y `verification_lock_minutes` 30 (5–1440).
- Motivos de `409 conflict` nuevos (`details.reason`): `stale_option`, `document_taken`. Sin códigos de error nuevos.
- **Rama `fase-3-3-motor-conversacional`.** Commitear solo los archivos de cada tarea con `git add <rutas>`; nunca `git add -A`, `git stash`, `git checkout --` ni `reset`. No hacer merge a `main` ni abrir PR: lo hace el usuario.

## Refinamientos sobre la spec

La Tarea 1 los deja escritos en la spec (§9 nueva). Salen de leer el código al planificar:

1. **Lecturas por puerto, escrituras declaradas.** En vez de `needs()` + `facts`, los pasos leen por un puerto de solo lectura `ConversationReads` (asíncrono; en pruebas es un objeto en memoria). Las escrituras siguen siendo declarativas: cada `handle` devuelve **a lo sumo un** `Effect` y una continuación pura `then(outcome)`.
2. **Efectos dentro de un `SAVEPOINT`.** `createAppointmentRequest` puede lanzar una violación de unicidad de Postgres, que aborta la transacción. El ejecutor abre `SAVEPOINT` antes del efecto y hace `ROLLBACK TO SAVEPOINT` si falla: el cupo vuelve a su estado y la conversación sigue avanzando con el fallo traducido.
3. **El par se guarda al sortearlo** (efecto `open_challenge`), no al primer intento: si se guardara al responder, abandonar antes de contestar permitiría re-sortear hasta dar con el par más fácil.
4. **`conversation/domain` importa `verification/domain`** (puro, sin E/S) para evaluar respuestas. Nada más de otros módulos.
5. **Texto libre del paciente siempre redactado**, incluida la consulta a la KB (puede traer datos clínicos). El documento se guarda enmascarado. Las líneas del bot también pueden ir redactadas (resumen del pre-registro): se guardan como `[redactado]` y solo viajan completas en la respuesta del `POST`.
6. **Forma de las respuestas:** `POST /widget/conversation/messages` → `{ messages: string[], options: [{id,label}], input }`; `GET /widget/conversation` → `{ messages: [{author,text,redacted,created_at}], options, input }`.
7. **CORS:** una petición previa (`OPTIONS`) no trae cuerpo ni token, así que no puede saber el tenant. Se responde `Access-Control-Allow-Origin` con el origen exacto si está en los `allowed_origins` de **algún** tenant (índice GIN). El control por tenant se mantiene: la apertura lo hace `admitWidget` (`403`) y las rutas con token responden `403 forbidden` si llega `Origin` distinto del de la sesión.
8. **Auditoría:** no hay `conversation.request_created`; la solicitud ya audita `appointment_request.created` con el actor `widget:<sesión>`. Se añaden `verification.succeeded|failed|locked`, `patient.pre_registered`, `handoff.created`, `bot_config.origin_added|origin_removed`.
9. **Orden de mensajes por `seq`** (`conversations.message_count`), no por `created_at`.
10. **Repetición idempotente de mensajes** comprueba la sesión: una `Idempotency-Key` usada por otra sesión del tenant responde `409`, nunca la respuesta ajena.
11. **Identificador del pre-registro:** `identifier_system = "urn:ingenius:pre-registration"`, `identifier_value` = id del expediente. Hermes asigna el suyo en la Fase 4.
12. **`email_hint` con señuelos deterministas** por expediente (hash del id): si cambiaran en cada sesión, la intersección de las listas revelaría la respuesta.
13. **El ticket de handoff solo enlaza el expediente si el paciente ya verificó** en la sesión; un documento solo declarado no se asocia.
14. **Validación del pre-registro duplicada a propósito:** `conversation` valida campo a campo para la UX y `patients` valida el conjunto (autoritativo). DRY al tercer uso.
15. **Hash con clave en `idempotency_keys` para el chat.** El hash SHA-256 del cuerpo permitiría recuperar por fuerza bruta una respuesta de 4 dígitos. La ruta de mensajes usa HMAC-SHA256 (clave: el secreto JWT) y guarda la respuesta con las líneas redactadas.
16. **Sesión de otro tenant → `401`**, no `404`: el token apunta a una sesión que no existe para su tenant, igual que en `POST /widget/sessions/refresh`.

## Review Focus

- **`Idempotency-Key` de otra sesión del mismo tenant con el mismo cuerpo:** se espera `409 conflict`, nunca la respuesta guardada de la otra sesión (que puede traer su resumen de pre-registro). Test en la Tarea 14.
- **Efecto que falla a mitad de transacción** (cupo tomado por otro entre la elección y la confirmación): se espera el cupo coherente, la conversación avanzada con «ese horario se acaba de ocupar» y `200`, nunca `500`. Test en la Tarea 14.
- **Dos intentos de verificación simultáneos del mismo documento** desde sesiones distintas: el contador no pierde incrementos (bloqueo `FOR UPDATE`). Test en la Tarea 6.
- **Opción de un turno anterior** (doble clic, pestaña vieja): `409 stale_option` y el estado no cambia. Test en la Tarea 8.
- **`Origin` distinto al de la sesión en una ruta con token:** `403 forbidden`; sin `Origin` (cliente servidor a servidor) se admite. Test en la Tarea 4.

## Mapa de archivos

```
backend/prisma/schema.prisma                                  (T1) 4 tablas, 3 enums
backend/prisma/migrations/<ts>_fase3_3_conversacion/          (T1)
backend/prisma/seed/write-chatbot.ts                          (T1) borrado en orden de FK
backend/src/modules/shared/domain/ports/random.ts             (T5)
backend/src/modules/shared/infrastructure/crypto-random.ts    (T5)
backend/src/modules/shared/infrastructure/prisma-savepoint.ts (T13)
backend/src/modules/bot-config/domain/default-texts.ts        (T2) textos y marcadores por clave
backend/src/modules/bot-config/domain/bot-config.ts           (T2, T3)
backend/src/modules/bot-config/domain/allowed-origins.ts      (T3)
backend/src/modules/bot-config/application/allowed-origins.ts (T3)
backend/src/modules/verification/{domain,application,infrastructure}/ (T5, T6)
backend/src/modules/patients/domain/pre-registration.ts       (T7)
backend/src/modules/patients/application/pre-register-patient.ts (T7)
backend/src/modules/handoff/{domain,application,infrastructure}/ (T7)
backend/src/modules/conversation/domain/{text,types,ports,format,message-input,engine,pre-registration-fields}.ts (T8)
backend/src/modules/conversation/domain/steps/*.ts            (T9–T12)
backend/src/modules/conversation/application/{render,conversation}.ts (T13)
backend/src/modules/conversation/infrastructure/*.ts          (T14)
backend/src/composition/{conversation-wiring,sim-wiring}.ts   (T13, T14)
backend/src/http/cors.ts                                      (T4)
backend/src/http/openapi-paths-conversation.ts                (T3, T14)
backend/src/http/serializers-conversation.ts                  (T14)
backend/src/app/api/v1/bot-config/allowed-origins/route.ts    (T3)
backend/src/app/api/v1/bot-config/allowed-origins/[origin]/route.ts (T3)
backend/src/app/api/v1/widget/conversation/route.ts           (T14)
backend/src/app/api/v1/widget/conversation/messages/route.ts  (T14)
```

---

### Task 1: Esquema, migración y refinamientos de la spec

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_fase3_3_conversacion/migration.sql` (generada y ampliada)
- Modify: `backend/prisma/seed/write-chatbot.ts:17-25`
- Create: `backend/tests/db/conversacion-esquema.test.ts`
- Modify: `docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md` (§9 nueva)

**Interfaces:**
- Produces: modelos Prisma `Conversation` (`db.conversation`), `ConversationMessage` (`db.conversationMessage`), `VerificationChallenge` (`db.verificationChallenge`), `HandoffTicket` (`db.handoffTicket`); enums `ConversationMessageAuthor` (`bot`·`patient`), `HandoffReason` (`requested`·`verification_locked`·`unverifiable`), `HandoffStatus` (`open`).

- [ ] **Step 1: Escribir la §9 de la spec**

Al final de la spec, antes de `## 8. Fuera de alcance` no; **después** de la §8, añade `## 9. Refinamientos del plan` copiando literalmente la lista numerada 1–16 de la sección «Refinamientos sobre la spec» de este plan. Cambia la línea de estado del encabezado a:

```markdown
> Estado: **en implementación** en la rama `fase-3-3-motor-conversacional`; plan en
> `docs/superpowers/plans/2026-10-02-fase-3-3-motor-conversacional.md`.
```

- [ ] **Step 2: Escribir la prueba del esquema (falla)**

Crea `backend/tests/db/conversacion-esquema.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

async function seedSession(slug: string) {
  const { tenantId } = await insertChatbotTenant(prisma, slug);
  const now = new Date();
  await prisma.widgetSession.create({
    data: {
      id: `${tenantId}-ws`,
      tenantId,
      origin: "https://clinica.test",
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      lastSeenAt: now,
    },
  });
  await prisma.medicalRecord.create({
    data: {
      id: `${tenantId}-mr`,
      tenantId,
      identifierSystem: "urn:hermes:patient",
      identifierValue: `MR-${slug}`,
      documentType: "CC",
      documentNumber: `900${slug}`,
      givenNames: "Ana",
      familyNames: "Paz",
      birthDate: new Date("1990-01-15"),
    },
  });
  return { tenantId, sessionId: `${tenantId}-ws`, recordId: `${tenantId}-mr` };
}

function conversationData(tenantId: string, sessionId: string, id: string) {
  const now = new Date();
  return {
    id,
    tenantId,
    widgetSessionId: sessionId,
    step: "main_menu",
    context: {},
    createdAt: now,
    updatedAt: now,
  };
}

describe("conversacion: esquema", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una sola conversacion por sesion de widget", async () => {
    const s = await seedSession("a");
    await prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c1") });
    await expect(
      prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c2") }),
    ).rejects.toThrow();
  });

  it("la sesion debe ser del mismo tenant", async () => {
    const a = await seedSession("a");
    const b = await seedSession("b");
    await expect(
      prisma.conversation.create({ data: conversationData(b.tenantId, a.sessionId, "c1") }),
    ).rejects.toThrow();
  });

  it("un mensaje redactado solo guarda el marcador", async () => {
    const s = await seedSession("a");
    await prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c1") });
    const base = {
      tenantId: s.tenantId,
      conversationId: "c1",
      author: "patient" as const,
      createdAt: new Date(),
    };
    await prisma.conversationMessage.create({
      data: { ...base, id: "m1", seq: 1, text: "[redactado]", redacted: true },
    });
    await expect(
      prisma.conversationMessage.create({
        data: { ...base, id: "m2", seq: 2, text: "15", redacted: true },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.conversationMessage.create({
        data: { ...base, id: "m3", seq: 1, text: "[redactado]", redacted: true },
      }),
    ).rejects.toThrow();
  });

  it("el desafio guarda exactamente dos preguntas y uno por expediente", async () => {
    const s = await seedSession("a");
    const base = { tenantId: s.tenantId, medicalRecordId: s.recordId, createdAt: new Date(), updatedAt: new Date() };
    await expect(
      prisma.verificationChallenge.create({ data: { ...base, id: "v0", questionIds: ["birth_day"] } }),
    ).rejects.toThrow();
    await prisma.verificationChallenge.create({
      data: { ...base, id: "v1", questionIds: ["birth_day", "phone_last_4"] },
    });
    await expect(
      prisma.verificationChallenge.create({
        data: { ...base, id: "v2", questionIds: ["birth_year", "phone_last_4"] },
      }),
    ).rejects.toThrow();
  });

  it("el ticket de handoff nace abierto", async () => {
    const s = await seedSession("a");
    await prisma.conversation.create({ data: conversationData(s.tenantId, s.sessionId, "c1") });
    const ticket = await prisma.handoffTicket.create({
      data: { id: "h1", tenantId: s.tenantId, conversationId: "c1", reason: "requested", createdAt: new Date() },
    });
    expect(ticket.status).toBe("open");
    expect(ticket.medicalRecordId).toBeNull();
  });
});
```

- [ ] **Step 3: Correr la prueba y verla fallar**

Run: `npm --prefix backend run test:db -- conversacion-esquema`
Expected: FAIL de tipos/ejecución (`prisma.conversation` no existe).

- [ ] **Step 4: Añadir enums y modelos al esquema**

En `backend/prisma/schema.prisma`, después del enum `ResolutionReason`:

```prisma
enum ConversationMessageAuthor {
  bot
  patient

  @@map("conversation_message_author")
  @@schema("public")
}

enum HandoffReason {
  requested
  verification_locked
  unverifiable

  @@map("handoff_reason")
  @@schema("public")
}

enum HandoffStatus {
  open

  @@map("handoff_status")
  @@schema("public")
}
```

Después del modelo `WidgetSession`:

```prisma
// Conversacion del widget: una por sesion. `context` nunca guarda respuestas de
// verificacion (GOBERNANZA §1.5); el borrador del pre-registro se borra al confirmar.
model Conversation {
  id              String   @id
  tenantId        String   @map("tenant_id")
  widgetSessionId String   @map("widget_session_id")
  step            String
  context         Json     @default("{}")
  medicalRecordId String?  @map("medical_record_id")
  messageCount    Int      @default(0) @map("message_count")
  createdAt       DateTime @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime @map("updated_at") @db.Timestamptz(3)

  tenant         Tenant                @relation(fields: [tenantId], references: [id])
  widgetSession  WidgetSession         @relation(fields: [tenantId, widgetSessionId], references: [tenantId, id])
  medicalRecord  MedicalRecord?        @relation(fields: [tenantId, medicalRecordId], references: [tenantId, id], onDelete: Restrict)
  messages       ConversationMessage[]
  handoffTickets HandoffTicket[]

  @@unique([tenantId, id])
  @@unique([tenantId, widgetSessionId])
  @@map("conversations")
  @@schema("public")
}

// Historial. Un mensaje redactado guarda solo "[redactado]" (CHECK en la migracion).
model ConversationMessage {
  id             String                    @id
  tenantId       String                    @map("tenant_id")
  conversationId String                    @map("conversation_id")
  seq            Int
  author         ConversationMessageAuthor
  text           String
  redacted       Boolean                   @default(false)
  createdAt      DateTime                  @map("created_at") @db.Timestamptz(3)

  tenant       Tenant       @relation(fields: [tenantId], references: [id])
  conversation Conversation @relation(fields: [tenantId, conversationId], references: [tenantId, id], onDelete: Cascade)

  @@unique([tenantId, conversationId, seq])
  @@map("conversation_messages")
  @@schema("public")
}

// Par fijo de preguntas por expediente y contador de fallos. Nunca guarda respuestas.
model VerificationChallenge {
  id              String    @id
  tenantId        String    @map("tenant_id")
  medicalRecordId String    @map("medical_record_id")
  questionIds     String[]  @map("question_ids")
  failedAttempts  Int       @default(0) @map("failed_attempts")
  lockedUntil     DateTime? @map("locked_until") @db.Timestamptz(3)
  createdAt       DateTime  @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime  @map("updated_at") @db.Timestamptz(3)

  tenant        Tenant        @relation(fields: [tenantId], references: [id])
  medicalRecord MedicalRecord @relation(fields: [tenantId, medicalRecordId], references: [tenantId, id], onDelete: Cascade)

  @@unique([tenantId, medicalRecordId])
  @@map("verification_challenges")
  @@schema("public")
}

// Solo creacion en la 3.3; lectura y gestion en la Fase 6.
model HandoffTicket {
  id              String        @id
  tenantId        String        @map("tenant_id")
  conversationId  String        @map("conversation_id")
  reason          HandoffReason
  status          HandoffStatus @default(open)
  medicalRecordId String?       @map("medical_record_id")
  createdAt       DateTime      @map("created_at") @db.Timestamptz(3)

  tenant        Tenant         @relation(fields: [tenantId], references: [id])
  conversation  Conversation   @relation(fields: [tenantId, conversationId], references: [tenantId, id], onDelete: Cascade)
  medicalRecord MedicalRecord? @relation(fields: [tenantId, medicalRecordId], references: [tenantId, id], onDelete: Restrict)

  @@index([tenantId, status, createdAt])
  @@map("handoff_tickets")
  @@schema("public")
}
```

Relaciones inversas: en `Tenant` añade
```prisma
  conversations          Conversation[]
  conversationMessages   ConversationMessage[]
  verificationChallenges VerificationChallenge[]
  handoffTickets         HandoffTicket[]
```
en `WidgetSession` añade `conversation Conversation?`, y en `MedicalRecord` añade
```prisma
  conversations          Conversation[]
  verificationChallenges VerificationChallenge[]
  handoffTickets         HandoffTicket[]
```

`WidgetSession` ya tiene `@@unique([tenantId, id])`.

- [ ] **Step 5: Generar la migración sin aplicarla**

Run: `npm --prefix backend exec prisma migrate dev -- --create-only --name fase3_3_conversacion` (usa `backend/.env`; Postgres local arriba).
Expected: carpeta nueva `backend/prisma/migrations/<timestamp>_fase3_3_conversacion/`.

- [ ] **Step 6: Ampliar la migración con SQL crudo**

Al final de `migration.sql` generado:

```sql
-- Restricciones que Prisma no expresa.
ALTER TABLE "public"."verification_challenges"
  ADD CONSTRAINT "verification_challenges_question_pair" CHECK (cardinality("question_ids") = 2),
  ADD CONSTRAINT "verification_challenges_failed_attempts_nonneg" CHECK ("failed_attempts" >= 0);

ALTER TABLE "public"."conversation_messages"
  ADD CONSTRAINT "conversation_messages_redacted_text" CHECK (NOT "redacted" OR "text" = '[redactado]');

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_message_count_nonneg" CHECK ("message_count" >= 0);

-- CORS: buscar un origen entre los permitidos de cualquier tenant.
CREATE INDEX "bot_configs_allowed_origins_gin" ON "public"."bot_configs" USING GIN ("allowed_origins");
```

- [ ] **Step 7: Aplicar y regenerar el cliente**

Run: `npm --prefix backend exec prisma migrate dev` → Expected: aplica la migración sin proponer otra.
Run: `npm --prefix backend run db:generate` → Expected: cliente regenerado.

- [ ] **Step 8: Borrado del seed en orden de FK**

En `backend/prisma/seed/write-chatbot.ts`, `deleteExisting` empieza ahora así (antes de `appointmentRequest.deleteMany`) y el comentario lista el orden nuevo:

```ts
/**
 * ... Orden de FK: tickets -> mensajes -> conversaciones -> desafios -> solicitudes ->
 * citas -> cupos -> agendas -> servicios -> profesionales -> historias clinicas.
 */
async function deleteExisting(tx: Tx, tenantIds: string[]): Promise<void> {
  const scope = { where: { tenantId: { in: tenantIds } } };
  await tx.handoffTicket.deleteMany(scope);
  await tx.conversationMessage.deleteMany(scope);
  await tx.conversation.deleteMany(scope);
  await tx.verificationChallenge.deleteMany(scope);
  await tx.appointmentRequest.deleteMany(scope);
  await tx.appointment.deleteMany(scope);
  await tx.slot.deleteMany(scope);
  await tx.schedule.deleteMany(scope);
  await tx.healthcareService.deleteMany(scope);
  await tx.practitioner.deleteMany(scope);
  await tx.medicalRecord.deleteMany(scope);
}
```

- [ ] **Step 9: Correr la prueba y verla pasar**

Run: `npm --prefix backend run test:db -- conversacion-esquema`
Expected: PASS (5 tests). Run también `npm --prefix backend run test:db -- simetria-seed` → PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/prisma/seed/write-chatbot.ts backend/tests/db/conversacion-esquema.test.ts docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md
git commit -m "feat(conversation): tablas de conversaciones, mensajes, desafios y handoff"
```

---

### Task 2: Textos y parámetros de `bot-config` para el chat

**Files:**
- Create: `backend/src/modules/bot-config/domain/default-texts.ts`
- Modify: `backend/src/modules/bot-config/domain/bot-config.ts` (textos, marcadores por clave, params)
- Modify: `backend/tests/dominio/bot-config.test.ts`

**Interfaces:**
- Produces: `DEFAULT_TEXTS` (re-exportado desde `bot-config.ts`, ahora ~75 claves), `TextKey`, `TEXT_PLACEHOLDERS: Record<TextKey, readonly string[]>`, params `verification_max_attempts` y `verification_lock_minutes` en `PARAM_SPECS`/`BotParams`.

- [ ] **Step 1: Pruebas (fallan)**

En `backend/tests/dominio/bot-config.test.ts`, en el test «sin sobrescrituras devuelve los predeterminados», añade al objeto esperado de `params`:

```ts
      verification_max_attempts: 3,
      verification_lock_minutes: 30,
```

Y al final del archivo:

```ts
describe("conocimiento-config: textos del chat", () => {
  it("cada texto acepta {clinic_name} y solo los marcadores de su clave", () => {
    const ok = applyPatch(
      EMPTY_OVERRIDES,
      { texts: { verify_failed: "Quedan {remaining} en {clinic_name}" } },
      DEV,
    );
    expect(ok.texts.verify_failed).toBe("Quedan {remaining} en {clinic_name}");
    expect(() =>
      applyPatch(EMPTY_OVERRIDES, { texts: { welcome: "Quedan {remaining}" } }, DEV),
    ).toThrow(ValidationError);
  });

  it("los predeterminados solo usan marcadores admitidos para su clave", () => {
    for (const [key, value] of Object.entries(DEFAULT_TEXTS)) {
      const used = [...value.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
      const allowed = ["clinic_name", ...TEXT_PLACEHOLDERS[key as keyof typeof DEFAULT_TEXTS]];
      expect(used.filter((name) => !allowed.includes(name ?? "")), key).toEqual([]);
    }
  });

  it("los params de verificacion respetan su rango", () => {
    expect(() =>
      applyPatch(EMPTY_OVERRIDES, { params: { verification_max_attempts: 6 } }, DEV),
    ).toThrow(ValidationError);
    expect(
      applyPatch(EMPTY_OVERRIDES, { params: { verification_lock_minutes: 1440 } }, DEV).params,
    ).toEqual({ verification_lock_minutes: 1440 });
  });
});
```

Añade `TEXT_PLACEHOLDERS` al import de `@/modules/bot-config/domain/bot-config`.

Run: `npm --prefix backend exec vitest run tests/dominio/bot-config.test.ts`
Expected: FAIL (`verify_failed` desconocido, `TEXT_PLACEHOLDERS` no existe).

- [ ] **Step 2: Crear `default-texts.ts`**

```ts
/**
 * Textos predeterminados del bot. El tenant solo guarda los que sobrescribe. Todo texto del
 * chat sale de aqui, de la base de conocimiento o de datos de dominio (sin IA).
 * `{clinic_name}` vale en todas las claves; el resto, solo donde lo dice TEXT_PLACEHOLDERS.
 */
export const DEFAULT_TEXTS = {
  welcome: "Hola, soy el asistente virtual de {clinic_name}. ¿En qué te puedo ayudar?",
  kb_see_more_label: "Ver más",
  menu_prompt: "Elige una opción.",
  option_appointments: "Mis citas",
  option_kb: "Consultas generales",
  option_advisor: "Hablar con un asesor",
  option_menu: "Menú principal",
  option_cancel: "Cancelar",
  option_confirm: "Confirmar",
  option_accept: "Acepto",
  option_decline: "No acepto",
  option_skip: "Omitir",
  option_restart: "Corregir mis datos",
  option_more: "Ver más",
  invalid_option: "Elige una de las opciones para continuar.",
  generic_error: "No pudimos completar la operación. Intenta de nuevo.",
  kb_prompt: "Escribe tu pregunta en pocas palabras.",
  kb_no_results:
    "No encontré información sobre eso. Puedes intentar con otras palabras o hablar con un asesor.",
  kb_results_prompt: "¿Algo más?",
  kb_another: "Otra consulta",
  handoff_created: "Listo. Un asesor de {clinic_name} revisará tu caso y te contactará.",
  closed_prompt: "Si necesitas algo más, vuelve al menú.",
  id_document_type_prompt: "Para gestionar tus citas, elige tu tipo de documento.",
  doc_type_cc: "Cédula de ciudadanía",
  doc_type_ti: "Tarjeta de identidad",
  doc_type_ce: "Cédula de extranjería",
  doc_type_pa: "Pasaporte",
  doc_type_rc: "Registro civil",
  id_document_number_prompt: "Escribe tu número de documento, sin puntos ni espacios.",
  id_document_number_invalid: "Ese número no es válido. Usa solo letras y números (3 a 20).",
  verify_intro: "Para proteger tus datos, responde dos preguntas de seguridad.",
  verify_q_birth_day: "¿Qué día del mes naciste? Escribe solo el número.",
  verify_q_birth_month: "¿En qué mes naciste?",
  verify_q_birth_year: "¿En qué año naciste? Escribe los cuatro dígitos.",
  verify_q_phone_last_4: "Escribe los últimos 4 dígitos de tu celular registrado.",
  verify_q_phone_first_3: "Escribe los primeros 3 dígitos de tu celular registrado.",
  verify_q_email_hint: "¿Cuál de estos se parece a tu correo registrado?",
  verify_success: "Verificamos tu identidad.",
  verify_failed: "No pudimos verificar tus datos. Te quedan {remaining} intentos.",
  verify_locked:
    "Por seguridad, la verificación de este documento queda bloqueada hasta {until}. Un asesor puede ayudarte.",
  verify_unverifiable:
    "No podemos verificar tu identidad por este medio. Un asesor puede ayudarte.",
  prereg_not_found: "No encontramos ese documento en {clinic_name}. Puedes hacer un pre-registro.",
  privacy_notice:
    "Para crear tu pre-registro, {clinic_name} tratará tus datos personales según su política de tratamiento de datos (Ley 1581 de 2012). ¿Aceptas?",
  privacy_declined: "Entendido. Sin tu autorización no podemos crear el pre-registro.",
  prereg_given_names_prompt: "Escribe tus nombres.",
  prereg_family_names_prompt: "Escribe tus apellidos.",
  prereg_birth_date_prompt: "Escribe tu fecha de nacimiento (AAAA-MM-DD).",
  prereg_phone_prompt: "Escribe tu número de celular (10 dígitos).",
  prereg_email_prompt: "Escribe tu correo electrónico, o elige Omitir.",
  prereg_invalid: "Ese dato no es válido. Intenta de nuevo.",
  prereg_confirm_prompt:
    "Revisa tus datos: {given_names} {family_names}, nacimiento {birth_date}, celular {phone}, correo {email}. ¿Son correctos?",
  prereg_done: "Creamos tu pre-registro. {clinic_name} lo confirmará.",
  prereg_document_taken: "Ese documento ya está registrado. Vamos a verificar tu identidad.",
  appointments_menu_prompt: "¿Qué quieres hacer con tus citas?",
  option_book: "Agendar una cita",
  option_reschedule: "Reprogramar una cita",
  option_cancel_appointment: "Cancelar una cita",
  book_service_prompt: "¿Para qué servicio?",
  book_no_services: "No hay servicios disponibles en este momento.",
  book_practitioner_prompt: "¿Con qué profesional?",
  option_any_practitioner: "Cualquiera",
  book_day_prompt: "Elige un día.",
  book_no_days: "No hay cupos disponibles en los próximos días.",
  book_slot_prompt: "Elige una hora.",
  book_confirm_prompt: "Vas a solicitar {service} el {when} con {practitioner}. ¿Confirmas?",
  request_created:
    "Enviamos tu solicitud. {clinic_name} la confirmará; te guardamos el cupo hasta {hold_until}.",
  slot_taken: "Ese horario se acaba de ocupar. Elige otro.",
  pending_limit: "Ya tienes {max} solicitudes pendientes. Espera a que {clinic_name} las resuelva.",
  change_pending: "Esa cita ya tiene un cambio pendiente.",
  appointment_unavailable: "Esa cita ya no se puede modificar.",
  no_upcoming_appointments: "No tienes citas próximas.",
  pick_appointment_prompt: "¿Cuál cita?",
  cancel_confirm_prompt: "¿Confirmas que quieres cancelar la cita del {when}?",
  cancel_request_created: "Enviamos tu solicitud de cancelación. {clinic_name} la confirmará.",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

const EXTRA_PLACEHOLDERS: Partial<Record<TextKey, readonly string[]>> = {
  verify_failed: ["remaining"],
  verify_locked: ["until"],
  prereg_confirm_prompt: ["given_names", "family_names", "birth_date", "phone", "email"],
  book_confirm_prompt: ["service", "when", "practitioner"],
  request_created: ["hold_until"],
  pending_limit: ["max"],
  cancel_confirm_prompt: ["when"],
};

/** Marcadores admitidos por clave, ademas de `{clinic_name}`. */
export const TEXT_PLACEHOLDERS = Object.fromEntries(
  (Object.keys(DEFAULT_TEXTS) as TextKey[]).map((key) => [key, EXTRA_PLACEHOLDERS[key] ?? []]),
) as Record<TextKey, readonly string[]>;
```

- [ ] **Step 3: Usarlo en `bot-config.ts`**

En `backend/src/modules/bot-config/domain/bot-config.ts`:

1. Borra la constante `DEFAULT_TEXTS` local, el tipo `TextKey` local y `ALLOWED_PLACEHOLDERS`, y añade arriba:
```ts
import { DEFAULT_TEXTS, TEXT_PLACEHOLDERS, type TextKey } from "./default-texts";

export { DEFAULT_TEXTS, TEXT_PLACEHOLDERS, type TextKey };
```
2. En `PARAM_SPECS` añade al final:
```ts
  verification_max_attempts: { default: 3, min: 1, max: 5 },
  verification_lock_minutes: { default: 30, min: 5, max: 1440 },
```
3. En `validateText`, sustituye el bucle de marcadores por:
```ts
  const allowed = new Set(["clinic_name", ...TEXT_PLACEHOLDERS[key]]);
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!allowed.has(match[1] ?? "")) {
      throw new ValidationError(`Marcador desconocido en ${field}: {${match[1] ?? ""}}`, {
        field,
        allowed: [...allowed],
      });
    }
  }
```

- [ ] **Step 4: Correr pruebas**

Run: `npm --prefix backend exec vitest run tests/dominio/bot-config.test.ts` → PASS.
Run: `npm --prefix backend run typecheck` → sin errores (el frontend lee `texts` como mapa: no cambia).

- [ ] **Step 5: Regenerar OpenAPI si cambió** 

Run: `npm --prefix backend run openapi:generate` y `npm --prefix backend exec vitest run tests/contrato-api.test.ts` → PASS (el esquema `BotConfig` usa `additionalProperties`, no debería cambiar; si cambia, commitea `openapi.json`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/bot-config/domain/default-texts.ts backend/src/modules/bot-config/domain/bot-config.ts backend/tests/dominio/bot-config.test.ts
git commit -m "feat(bot-config): textos del chat, marcadores por clave y params de verificacion"
```

---

### Task 3: Alta y baja individual de orígenes permitidos

**Files:**
- Modify: `backend/src/modules/bot-config/domain/allowed-origins.ts`
- Modify: `backend/src/modules/bot-config/domain/ports/repositories.ts`
- Modify: `backend/src/modules/bot-config/infrastructure/prisma-bot-config-repository.ts`
- Create: `backend/src/modules/bot-config/application/allowed-origins.ts`
- Modify: `backend/src/composition-root.ts` (`botConfigWritePorts`)
- Create: `backend/src/app/api/v1/bot-config/allowed-origins/route.ts`
- Create: `backend/src/app/api/v1/bot-config/allowed-origins/[origin]/route.ts`
- Create: `backend/src/http/openapi-paths-conversation.ts`
- Modify: `backend/src/http/openapi.ts`
- Test: `backend/tests/dominio/bot-config.test.ts`, `backend/tests/db/conocimiento-config-http.test.ts`

**Interfaces:**
- Produces: `addOrigin(current: readonly string[], raw: unknown, policy: OriginPolicy): string[]`, `removeOrigin(current: readonly string[], raw: unknown): string[]` (lanza `NotFoundError` si no está); `BotConfigRepository.lock(tenantId): Promise<boolean>`; casos de uso `AddAllowedOrigin` / `RemoveAllowedOrigin` (`(input: AuditActor & { tenantId; origin: unknown }) => Promise<BotConfigView>`) en `WritePorts` como `addAllowedOrigin` / `removeAllowedOrigin`; `CONVERSATION_PATHS` y `CONVERSATION_SCHEMAS` en `openapi-paths-conversation.ts` (la Tarea 14 los amplía).

- [ ] **Step 1: Pruebas de dominio (fallan)**

En `backend/tests/dominio/bot-config.test.ts` importa `addOrigin, removeOrigin` de `@/modules/bot-config/domain/allowed-origins` y `NotFoundError` de `@/modules/shared/domain/not-found-error`; añade:

```ts
describe("conocimiento-config: alta y baja de un origen", () => {
  it("agrega normalizado y sin duplicar", () => {
    expect(addOrigin(["https://a.test"], " HTTPS://B.test ", PROD)).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
    expect(addOrigin(["https://a.test"], "https://a.test", PROD)).toEqual(["https://a.test"]);
  });

  it("respeta el formato y el maximo de 20", () => {
    expect(() => addOrigin([], "http://a.test", PROD)).toThrow(ValidationError);
    const full = Array.from({ length: 20 }, (_, i) => `https://o${i}.test`);
    expect(() => addOrigin(full, "https://otro.test", PROD)).toThrow(ValidationError);
    expect(addOrigin(full, "https://o3.test", PROD)).toEqual(full);
  });

  it("quita uno; si no esta es not_found", () => {
    expect(removeOrigin(["https://a.test", "https://b.test"], "https://A.test")).toEqual([
      "https://b.test",
    ]);
    expect(() => removeOrigin(["https://a.test"], "https://x.test")).toThrow(NotFoundError);
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/bot-config.test.ts` → FAIL (`addOrigin` no existe).

- [ ] **Step 2: Implementar en `allowed-origins.ts`**

Añade al final de `backend/src/modules/bot-config/domain/allowed-origins.ts` (e importa `NotFoundError`):

```ts
/** Agrega un origen a la lista; si ya esta, la lista no cambia. */
export function addOrigin(current: readonly string[], raw: unknown, policy: OriginPolicy): string[] {
  const origin = validateOrigin(raw, 0, policy);
  if (current.includes(origin)) {
    return [...current];
  }
  return validateAllowedOrigins([...current, origin], policy);
}

/** Quita un origen; si no esta en la lista es un recurso inexistente. */
export function removeOrigin(current: readonly string[], raw: unknown): string[] {
  const origin = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!current.includes(origin)) {
    throw new NotFoundError();
  }
  return current.filter((value) => value !== origin);
}
```

`validateOrigin` con índice 0 reporta `allowed_origins.0`; para el alta el campo correcto es `origin`. Cambia la firma a `validateOrigin(value: unknown, field: string, policy: OriginPolicy)`; en `validateAllowedOrigins` pásale `` `allowed_origins.${index}` `` y en `addOrigin` pásale `"origin"`.

Run: `npm --prefix backend exec vitest run tests/dominio/bot-config.test.ts` → PASS.

- [ ] **Step 3: Bloqueo de la fila en el repositorio**

En `ports/repositories.ts`, dentro de `BotConfigRepository`:
```ts
  /** `SELECT ... FOR UPDATE` de la fila del tenant; `false` si no existe. Solo en transaccion. */
  lock(tenantId: TenantId): Promise<boolean>;
```
En `prisma-bot-config-repository.ts`, dentro del objeto devuelto:
```ts
    async lock(tenantId) {
      const rows = await db.$queryRaw<{ tenant_id: string }[]>`
        SELECT "tenant_id" FROM "public"."bot_configs" WHERE "tenant_id" = ${tenantId} FOR UPDATE`;
      return rows.length === 1;
    },
```

- [ ] **Step 4: Casos de uso**

Crea `backend/src/modules/bot-config/application/allowed-origins.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { addOrigin, type OriginPolicy, removeOrigin } from "../domain/allowed-origins";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import { type BotConfigView, loadOverrides, viewOf } from "./bot-config";

export type OriginChangeInput = AuditActor & { readonly tenantId: TenantId; readonly origin: unknown };
export type ChangeAllowedOrigin = (input: OriginChangeInput) => Promise<BotConfigView>;

type Deps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly clock: Clock;
  readonly audit: AuditLog;
  readonly originPolicy: OriginPolicy;
};

type Change = (current: readonly string[], raw: unknown, policy: OriginPolicy) => string[];

/**
 * Cambia un solo origen con la fila bloqueada: dos administradores que agregan a la vez no se
 * pisan (a diferencia del PATCH, que reemplaza la lista entera).
 */
function createChangeAllowedOrigin(deps: Deps, change: Change, action: string): ChangeAllowedOrigin {
  return async (input) => {
    if (!(await deps.configs.lock(input.tenantId))) {
      throw new NotFoundError();
    }
    const current = await loadOverrides(deps.configs, input.tenantId);
    const allowedOrigins = change(current.allowedOrigins, input.origin, deps.originPolicy);
    const next = { ...current, allowedOrigins };
    await deps.configs.update(input.tenantId, next);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action,
      resourceType: "bot_config",
      resourceId: input.tenantId,
      requestId: input.requestId,
      occurredAt: deps.clock.now(),
    });
    return viewOf(deps, input.tenantId, next);
  };
}

export function createAddAllowedOrigin(deps: Deps): ChangeAllowedOrigin {
  return createChangeAllowedOrigin(deps, addOrigin, "bot_config.origin_added");
}

export function createRemoveAllowedOrigin(deps: Deps): ChangeAllowedOrigin {
  return createChangeAllowedOrigin(
    deps,
    (current, raw) => removeOrigin(current, raw),
    "bot_config.origin_removed",
  );
}
```

- [ ] **Step 5: Cablear en `botConfigWritePorts`**

En `backend/src/composition-root.ts`, importa `createAddAllowedOrigin, createRemoveAllowedOrigin` de `./modules/bot-config/application/allowed-origins` y, dentro del objeto que devuelve `botConfigWritePorts`, añade:

```ts
    addAllowedOrigin: createAddAllowedOrigin({ ...deps, audit: auditLog, originPolicy: originPolicyOf(config) }),
    removeAllowedOrigin: createRemoveAllowedOrigin({ ...deps, audit: auditLog, originPolicy: originPolicyOf(config) }),
```

(Si `composition-root.ts` pasa de 400 líneas, adelanta aquí el Step 1 de la Tarea 13: mover `simReads` a `composition/sim-wiring.ts`.)

- [ ] **Step 6: Rutas**

`backend/src/app/api/v1/bot-config/allowed-origins/route.ts`:

```ts
import { idempotentRoute } from "@/http/idempotent-route";
import { botConfigJson } from "@/http/serializers-chatbot";
import { isRecord } from "@/modules/shared/domain/input";

export const dynamic = "force-dynamic";

/** Agrega un origen al widget sin reemplazar la lista. Si ya estaba, responde 200 igual. */
export const POST = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  const view = await ports.addAllowedOrigin({
    tenantId: actor.tenantId,
    origin: isRecord(body) ? body.origin : undefined,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: botConfigJson(view) };
});
```

`backend/src/app/api/v1/bot-config/allowed-origins/[origin]/route.ts`:

```ts
import { idempotentRoute } from "@/http/idempotent-route";
import { botConfigJson } from "@/http/serializers-chatbot";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ origin: string }> };

/** El origen va codificado en la ruta (`https%3A%2F%2Fclinica.test`). */
export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, ports }) => {
    const { origin } = await context.params;
    const view = await ports.removeAllowedOrigin({
      tenantId: actor.tenantId,
      origin: decodeURIComponent(origin),
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: botConfigJson(view) };
  })(request);
```

- [ ] **Step 7: Contrato OpenAPI**

Crea `backend/src/http/openapi-paths-conversation.ts`:

```ts
import { IDEMPOTENCY_PARAMETER, okJson, REQUEST_ID_PARAMETER, writeErrors } from "./openapi-shared";

/** Rutas de /api/v1 de la Fase 3.3: origenes del widget y conversacion. */
const bearer = [{ bearerAuth: [] }];
const botConfigOk = okJson({ $ref: "#/components/schemas/BotConfig" });

export const CONVERSATION_SCHEMAS = {
  AllowedOriginInput: {
    type: "object",
    required: ["origin"],
    additionalProperties: false,
    properties: { origin: { type: "string", description: "https://host[:puerto]" } },
  },
} as const;

export const CONVERSATION_PATHS = {
  "/bot-config/allowed-origins": {
    post: {
      operationId: "addAllowedOrigin",
      description: "Agrega un origen (maximo 20). Si ya esta, responde 200 sin cambios.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AllowedOriginInput" } },
        },
      },
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
  "/bot-config/allowed-origins/{origin}": {
    delete: {
      operationId: "removeAllowedOrigin",
      description: "Quita un origen. El origen va codificado (encodeURIComponent).",
      security: bearer,
      parameters: [
        REQUEST_ID_PARAMETER,
        IDEMPOTENCY_PARAMETER,
        { name: "origin", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: { ...botConfigOk, ...writeErrors },
    },
  },
};
```

En `backend/src/http/openapi.ts` importa `CONVERSATION_PATHS, CONVERSATION_SCHEMAS` y extiéndelos junto a `...CHATBOT_SCHEMAS` y `...CHATBOT_PATHS`.

Run: `npm --prefix backend run openapi:generate` y `npm --prefix backend exec vitest run tests/contrato-api.test.ts` → PASS.

- [ ] **Step 8: Prueba HTTP (BD)**

En `backend/tests/db/conocimiento-config-http.test.ts` añade un `describe` (reutiliza los helpers del archivo para token `admin`/`operator` y `Idempotency-Key`; importa `POST as addOrigin` y `DELETE as removeOrigin` de las rutas nuevas):

```ts
describe("conocimiento-config: origenes por API", () => {
  it("admin agrega y quita un origen; operator no", async () => {
    const admin = await signToken({ role: "admin", tenantId });
    const add = (token: string, origin: string) =>
      addOrigin(
        authedRequest("http://localhost/api/v1/bot-config/allowed-origins", token, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
          body: JSON.stringify({ origin }),
        }),
      );
    const added = await add(admin, "https://nueva.test");
    expect(added.status).toBe(200);
    expect((await added.json()).allowed_origins).toContain("https://nueva.test");
    expect((await add(admin, "https://nueva.test")).status).toBe(200);

    const operator = await signToken({ role: "operator", tenantId });
    expect((await add(operator, "https://otra.test")).status).toBe(403);

    const encoded = encodeURIComponent("https://nueva.test");
    const removed = await removeOrigin(
      authedRequest(`http://localhost/api/v1/bot-config/allowed-origins/${encoded}`, admin, {
        method: "DELETE",
        headers: { "Idempotency-Key": randomUUID() },
      }),
      { params: Promise.resolve({ origin: encoded }) },
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).allowed_origins).not.toContain("https://nueva.test");
    const actions = await prisma.auditEvent.findMany({ where: { tenantId }, select: { action: true } });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["bot_config.origin_added", "bot_config.origin_removed"]),
    );
  });
});
```

(`tenantId` es el del tenant que siembra el `beforeEach` del archivo; si el archivo usa otro nombre, adáptalo.)

Run: `npm --prefix backend run test:db -- conocimiento-config-http` → PASS.

- [ ] **Step 9: Cliente del frontend y commit**

Run: `npm --prefix frontend run api:generate` y `npm run typecheck` → sin errores.

```bash
git add backend/src/modules/bot-config backend/src/composition-root.ts backend/src/app/api/v1/bot-config/allowed-origins backend/src/http/openapi-paths-conversation.ts backend/src/http/openapi.ts backend/openapi.json backend/tests/dominio/bot-config.test.ts backend/tests/db/conocimiento-config-http.test.ts frontend/src/api
git commit -m "feat(bot-config): alta y baja individual de origenes permitidos"
```

---

### Task 4: CORS en las rutas del widget

**Files:**
- Create: `backend/src/http/cors.ts`
- Modify: `backend/src/modules/bot-config/domain/ports/repositories.ts` + `infrastructure/prisma-bot-config-repository.ts` (`isOriginRegistered`)
- Modify: `backend/src/composition/widget-wiring.ts` (`widgetReads`), `backend/src/composition-root.ts` (`Container`)
- Modify: `backend/src/app/api/v1/widget/sessions/route.ts`, `backend/src/app/api/v1/widget/sessions/refresh/route.ts`
- Create: `backend/tests/db/cors.test.ts`

**Interfaces:**
- Produces: `withWidgetCors(handler: (request: Request, context?: unknown) => Promise<Response>)`, `widgetPreflight(request: Request): Promise<Response>`, `assertSessionOrigin(request: Request, session: { origin: string }): void` (lanza `AuthError` `forbidden`); `Container.isWidgetOriginRegistered(origin: string): Promise<boolean>`. La Tarea 14 los usa en las rutas de conversación.

- [ ] **Step 1: Prueba (falla)**

Crea `backend/tests/db/cors.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  OPTIONS as preflightRefresh,
  POST as refreshSession,
} from "@/app/api/v1/widget/sessions/refresh/route";
import { OPTIONS as preflightOpen, POST as openSession } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import { authedRequest } from "../helpers/token";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ORIGIN = "https://clinica-a.test";
const URL_OPEN = "http://localhost/api/v1/widget/sessions";
const URL_REFRESH = "http://localhost/api/v1/widget/sessions/refresh";

function open(seed: ChatbotTenantSeed, origin = ORIGIN) {
  return openSession(
    new Request(URL_OPEN, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ widget_key: seed.widgetKey }),
    }),
  );
}

describe("cors: rutas del widget", () => {
  let seed: ChatbotTenantSeed;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
    await insertChatbotTenant(prisma, "b", { allowedOrigins: ["https://clinica-b.test"] });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("la peticion previa devuelve el origen exacto si esta registrado", async () => {
    const response = await preflightOpen(
      new Request(URL_OPEN, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("un origen no registrado no recibe cabeceras CORS ni comodin", async () => {
    const response = await preflightOpen(
      new Request(URL_OPEN, { method: "OPTIONS", headers: { Origin: "https://mala.test" } }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("la apertura responde con el origen y expone X-Request-Id", async () => {
    const response = await open(seed);
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
  });

  it("el origen de otro tenant abre con 403 aunque reciba CORS", async () => {
    const response = await open(seed, "https://clinica-b.test");
    expect(response.status).toBe(403);
  });

  it("una ruta con token rechaza un Origin distinto al de la sesion", async () => {
    const { token } = await (await open(seed)).json();
    const refresh = (headers: Record<string, string>) =>
      refreshSession(
        authedRequest(URL_REFRESH, token, {
          method: "POST",
          headers: { "Idempotency-Key": randomUUID(), ...headers },
        }),
      );
    expect((await refresh({ Origin: "https://clinica-b.test" })).status).toBe(403);
    const same = await refresh({ Origin: ORIGIN });
    expect(same.status).toBe(200);
    expect(same.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect((await refresh({})).status).toBe(200);
    const pre = await preflightRefresh(
      new Request(URL_REFRESH, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
```

Run: `npm --prefix backend run test:db -- cors` → FAIL (`OPTIONS` no exportado).

- [ ] **Step 2: Consulta de origen registrado**

`BotConfigRepository` (puerto):
```ts
  /** Algun tenant tiene este origen entre sus permitidos (CORS de la peticion previa). */
  isOriginRegistered(origin: string): Promise<boolean>;
```
Adaptador Prisma:
```ts
    async isOriginRegistered(origin) {
      const found = await db.botConfig.findFirst({
        where: { allowedOrigins: { has: origin.toLowerCase() } },
        select: { tenantId: true },
      });
      return found !== null;
    },
```
En `widgetReads` (`composition/widget-wiring.ts`) añade:
```ts
    isWidgetOriginRegistered: (origin: string) =>
      createPrismaBotConfigRepository(prisma).isOriginRegistered(origin),
```
y en `Container` (`composition-root.ts`): `readonly isWidgetOriginRegistered: (origin: string) => Promise<boolean>;`.

- [ ] **Step 3: `http/cors.ts`**

```ts
import { getContainer } from "@/composition-root";
import { forbidden } from "@/modules/auth/domain/auth-error";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * CORS solo para las rutas del widget (refinamiento 7 de la spec 3.3). La peticion previa no
 * trae tenant: se devuelve el origen exacto si algun tenant lo admite, nunca un comodin. El
 * control por tenant sigue en la apertura (admitWidget) y en assertSessionOrigin.
 */
const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = `Authorization, Content-Type, Idempotency-Key, ${REQUEST_ID_HEADER}`;
const MAX_AGE_SECONDS = "600";

async function allowedOrigin(request: Request): Promise<string | null> {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return null;
  }
  return (await getContainer().isWidgetOriginRegistered(origin)) ? origin : null;
}

function applyCors(headers: Headers, origin: string): void {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", REQUEST_ID_HEADER);
  headers.append("Vary", "Origin");
}

/** Envuelve un handler del widget: anade las cabeceras CORS a toda respuesta, incluso de error. */
export function withWidgetCors<C>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    const response = await handler(request, context);
    const origin = await allowedOrigin(request);
    if (origin) {
      applyCors(response.headers, origin);
    }
    return response;
  };
}

export async function widgetPreflight(request: Request): Promise<Response> {
  const response = new Response(null, { status: 204 });
  response.headers.set("Vary", "Origin");
  const origin = await allowedOrigin(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
    response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
    response.headers.set("Access-Control-Max-Age", MAX_AGE_SECONDS);
  }
  return response;
}

/** Con token, el navegador debe hablar desde el mismo origen que abrio la sesion. */
export function assertSessionOrigin(request: Request, session: { readonly origin: string }): void {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin.toLowerCase() !== session.origin.toLowerCase()) {
    throw forbidden("Origen distinto al de la sesion");
  }
}
```

En `widgetPreflight` no se añade `Vary` dos veces: `applyCors` no se usa ahí. Si la prueba de `Vary` en el `POST` recibe `"Origin"` duplicado por otra capa, usa `headers.set` en vez de `append`.

- [ ] **Step 4: Envolver las rutas de sesión**

En `widget/sessions/route.ts`: renombra la función actual a `async function openSession(request: Request): Promise<Response>` (sin `export`) y al final:

```ts
export const POST = withWidgetCors(openSession);
export const OPTIONS = widgetPreflight;
```

En `widget/sessions/refresh/route.ts`, dentro del handler, antes de `refreshWidgetSession`, comprueba el origen contra la sesión vigente:

```ts
const refresh = idempotentRoute(
  ["widget"],
  async ({ actor, ports, request }) => {
    const sessionId = sessionIdOf(actor);
    assertSessionOrigin(request, await getContainer().getActiveWidgetSession(actor.tenantId, sessionId));
    const session = await ports.refreshWidgetSession({ tenantId: actor.tenantId, sessionId });
    // ...resto igual
  },
  { rebuild: ... },
);

export const POST = withWidgetCors(refresh);
export const OPTIONS = widgetPreflight;
```

`idempotentRoute` no pasa hoy `request` al handler: añade `request: Request` al tipo `IdempotentHandler` en `http/idempotent-route.ts` y pásalo en la llamada (`handler({ actor, requestId, body: idempotent.body, ports, request })`). Los handlers existentes lo ignoran.

- [ ] **Step 5: Correr pruebas**

Run: `npm --prefix backend run test:db -- cors sesion-widget` → PASS.
Run: `npm --prefix backend exec vitest run tests/contrato-api.test.ts` → PASS (las rutas no cambian; `OPTIONS` no se declara en OpenAPI).

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/cors.ts backend/src/http/idempotent-route.ts backend/src/modules/bot-config backend/src/composition/widget-wiring.ts backend/src/composition-root.ts backend/src/app/api/v1/widget/sessions backend/tests/db/cors.test.ts
git commit -m "feat(widget): CORS con origen exacto en las rutas del widget"
```

---
### Task 5: Banco de preguntas, sorteo y reglas del bloqueo (`verification/domain`)

**Files:**
- Create: `backend/src/modules/shared/domain/ports/random.ts`
- Create: `backend/src/modules/shared/infrastructure/crypto-random.ts`
- Create: `backend/src/modules/verification/domain/questions.ts`
- Create: `backend/src/modules/verification/domain/draw.ts`
- Create: `backend/src/modules/verification/domain/challenge.ts`
- Create: `backend/tests/dominio/verificacion.test.ts`
- Modify: `backend/tests/fronteras.test.ts`

**Interfaces:**
- Produces:
  - `Random = { int(maxExclusive: number): number }`; `cryptoRandom: Random`.
  - `VerifiableRecord = { id: string; birthDate: string /* YYYY-MM-DD */; phone: string | null; email: string | null }`.
  - `VerificationQuestion = { id; source: "birth_date" | "phone" | "email"; textKey: string; input: "text" | "options"; isAvailable(r); expected(r): string; normalize(raw): string; options?(r): QuestionOption[] }`, `QuestionOption = { value: string; label: string }`.
  - `QUESTION_BANK`, `questionById(id): VerificationQuestion | null`, `answerMatches(questionId, record, raw): boolean`.
  - `QuestionPair = readonly [string, string]`; `drawPair(record, random): QuestionPair | null`; `pairUsable(pair, record): boolean`.
  - `Challenge = { id; tenantId; medicalRecordId; questionIds: QuestionPair; failedAttempts: number; lockedUntil: Date | null }`; `VerificationPolicy = { maxAttempts: number; lockMinutes: number }`; `effectiveChallenge(c, now): Challenge`; `isLocked(c, now): boolean`; `AttemptOutcome = { result: "verified" | "failed" | "locked"; remainingAttempts: number; lockedUntil: Date | null }`; `applyAttempt(c, success, now, policy, redraw: QuestionPair): { challenge: Challenge; outcome: AttemptOutcome }`.

- [ ] **Step 1: Pruebas (fallan)**

Crea `backend/tests/dominio/verificacion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS } from "@/modules/bot-config/domain/bot-config";
import type { Random } from "@/modules/shared/domain/ports/random";
import {
  applyAttempt,
  type Challenge,
  effectiveChallenge,
  isLocked,
} from "@/modules/verification/domain/challenge";
import { drawPair, pairUsable } from "@/modules/verification/domain/draw";
import {
  answerMatches,
  QUESTION_BANK,
  questionById,
  type VerifiableRecord,
} from "@/modules/verification/domain/questions";

const FULL: VerifiableRecord = {
  id: "mr-1",
  birthDate: "1990-03-07",
  phone: "+57 300 123 4567",
  email: "juana.perez@gmail.com",
};
const DATE_ONLY: VerifiableRecord = { id: "mr-2", birthDate: "1985-12-24", phone: null, email: null };

function sequence(...values: number[]): Random {
  let i = 0;
  return { int: (max) => (values[i++] ?? 0) % max };
}

describe("verificacion: banco de preguntas", () => {
  it("cada pregunta tiene su texto predeterminado", () => {
    for (const question of QUESTION_BANK) {
      expect(Object.keys(DEFAULT_TEXTS), question.id).toContain(question.textKey);
    }
  });

  it("compara normalizando la respuesta", () => {
    expect(answerMatches("birth_day", FULL, " 07 ")).toBe(true);
    expect(answerMatches("birth_month", FULL, "3")).toBe(true);
    expect(answerMatches("birth_year", FULL, "1990")).toBe(true);
    expect(answerMatches("phone_last_4", FULL, "4567")).toBe(true);
    expect(answerMatches("phone_first_3", FULL, "300")).toBe(true);
    expect(answerMatches("phone_first_3", FULL, "573")).toBe(false);
    expect(answerMatches("birth_day", FULL, "8")).toBe(false);
    expect(answerMatches("birth_day", FULL, "")).toBe(false);
  });

  it("la pista de correo da las mismas opciones en cada llamada e incluye la verdadera", () => {
    const question = questionById("email_hint");
    const first = question?.options?.(FULL) ?? [];
    const second = question?.options?.(FULL) ?? [];
    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    const right = first.find((option) => answerMatches("email_hint", FULL, option.value));
    expect(right?.label).toBe("j•••@gmail.com");
  });

  it("sin telefono ni correo solo quedan preguntas de fecha", () => {
    const available = QUESTION_BANK.filter((q) => q.isAvailable(DATE_ONLY)).map((q) => q.source);
    expect(new Set(available)).toEqual(new Set(["birth_date"]));
  });
});

describe("verificacion: sorteo del par", () => {
  it("con varias fuentes elige dos de fuentes distintas", () => {
    for (let seed = 0; seed < 20; seed++) {
      const pair = drawPair(FULL, sequence(seed, seed + 3));
      expect(pair).not.toBeNull();
      const [a, b] = (pair ?? []).map((id) => questionById(id)?.source);
      expect(a).not.toBe(b);
    }
  });

  it("solo con fecha elige dos preguntas distintas de fecha", () => {
    const pair = drawPair(DATE_ONLY, sequence(0, 0));
    expect(pair?.[0]).not.toBe(pair?.[1]);
    expect(pair?.every((id) => questionById(id)?.source === "birth_date")).toBe(true);
  });

  it("un par con una pregunta que ya no aplica no es usable", () => {
    expect(pairUsable(["birth_day", "phone_last_4"], FULL)).toBe(true);
    expect(pairUsable(["birth_day", "phone_last_4"], DATE_ONLY)).toBe(false);
    expect(pairUsable(["birth_day", "desconocida"], FULL)).toBe(false);
  });
});

describe("verificacion: intentos y bloqueo", () => {
  const now = new Date("2026-10-02T15:00:00.000Z");
  const policy = { maxAttempts: 3, lockMinutes: 30 };
  const base: Challenge = {
    id: "v1",
    tenantId: "t1",
    medicalRecordId: "mr-1",
    questionIds: ["birth_day", "phone_last_4"],
    failedAttempts: 0,
    lockedUntil: null,
  };
  const redraw = ["birth_year", "email_hint"] as const;

  it("cuenta fallos y bloquea al tercero con el mismo par", () => {
    let challenge = base;
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const step = applyAttempt(challenge, false, now, policy, redraw);
      challenge = step.challenge;
      results.push(step.outcome.result);
    }
    expect(results).toEqual(["failed", "failed", "locked"]);
    expect(challenge.lockedUntil).toEqual(new Date(now.getTime() + 30 * 60_000));
    expect(challenge.questionIds).toEqual(base.questionIds);
    expect(isLocked(challenge, now)).toBe(true);
  });

  it("al vencer el bloqueo vuelve a cero con el mismo par", () => {
    const locked = { ...base, failedAttempts: 3, lockedUntil: new Date(now.getTime() - 1) };
    const effective = effectiveChallenge(locked, now);
    expect(effective).toEqual({ ...base, failedAttempts: 0, lockedUntil: null });
  });

  it("el exito re-sortea el par y reinicia el contador", () => {
    const step = applyAttempt({ ...base, failedAttempts: 2 }, true, now, policy, redraw);
    expect(step.outcome).toEqual({ result: "verified", remainingAttempts: 3, lockedUntil: null });
    expect(step.challenge).toMatchObject({ failedAttempts: 0, questionIds: redraw });
  });

  it("un intento sobre un desafio bloqueado no cambia nada", () => {
    const locked = { ...base, failedAttempts: 3, lockedUntil: new Date(now.getTime() + 60_000) };
    const step = applyAttempt(locked, true, now, policy, redraw);
    expect(step.outcome.result).toBe("locked");
    expect(step.challenge).toEqual(locked);
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/verificacion.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 2: Puerto `Random` y adaptador**

`backend/src/modules/shared/domain/ports/random.ts`:
```ts
/** Puerto de azar: el nucleo nunca llama a Math.random ni a node:crypto. */
export type Random = {
  /** Entero uniforme en [0, maxExclusive). */
  int(maxExclusive: number): number;
};
```

`backend/src/modules/shared/infrastructure/crypto-random.ts`:
```ts
import { randomInt } from "node:crypto";
import type { Random } from "../domain/ports/random";

export const cryptoRandom: Random = { int: (maxExclusive) => randomInt(maxExclusive) };
```

- [ ] **Step 3: `questions.ts`**

```ts
/**
 * Banco de preguntas de seguridad. Agregar una pregunta = una entrada aqui y su texto
 * predeterminado en bot-config (`textKey`). El motor y el esquema no cambian.
 * Las respuestas se comparan en memoria y se descartan (GOBERNANZA §1.5).
 */
export type VerifiableRecord = {
  readonly id: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
};

export type QuestionOption = { readonly value: string; readonly label: string };

export type VerificationQuestion = {
  readonly id: string;
  readonly source: "birth_date" | "phone" | "email";
  readonly textKey: string;
  readonly input: "text" | "options";
  isAvailable(record: VerifiableRecord): boolean;
  expected(record: VerifiableRecord): string;
  normalize(raw: string): string;
  options?(record: VerifiableRecord): QuestionOption[];
};

const digits = (raw: string): string => raw.replace(/\D/g, "");
const asNumber = (raw: string): string => {
  const only = digits(raw);
  return only === "" ? "" : String(Number(only));
};

/** Celular nacional: sin indicativo 57 si viene con el. */
function nationalPhone(phone: string | null): string {
  const only = digits(phone ?? "");
  return only.length > 10 && only.startsWith("57") ? only.slice(2) : only;
}

const MONTHS = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" });
const MONTH_OPTIONS: QuestionOption[] = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: MONTHS.format(new Date(Date.UTC(2000, i, 1))),
}));

const DECOY_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com"];
const DECOY_LETTERS = "abcdefghijklmnopqrstuvwxyz";

function emailHint(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.charAt(0)}•••@${domain}`;
}

/** FNV-1a: semilla estable por expediente para que los senuelos no cambien entre sesiones. */
function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return hash;
}

function emailOptions(record: VerifiableRecord): QuestionOption[] {
  const real = emailHint(record.email ?? "");
  const hints = new Set([real]);
  let seed = stableHash(record.id);
  while (hints.size < 4) {
    const letter = DECOY_LETTERS.charAt(seed % DECOY_LETTERS.length);
    const domain = DECOY_DOMAINS[(seed >>> 8) % DECOY_DOMAINS.length] ?? "gmail.com";
    hints.add(`${letter}•••@${domain}`);
    seed = stableHash(`${seed}`);
  }
  return [...hints].sort().map((hint) => ({ value: hint, label: hint }));
}

const always = () => true;

export const QUESTION_BANK: readonly VerificationQuestion[] = [
  {
    id: "birth_day",
    source: "birth_date",
    textKey: "verify_q_birth_day",
    input: "text",
    isAvailable: always,
    expected: (r) => asNumber(r.birthDate.slice(8, 10)),
    normalize: asNumber,
  },
  {
    id: "birth_month",
    source: "birth_date",
    textKey: "verify_q_birth_month",
    input: "options",
    isAvailable: always,
    expected: (r) => asNumber(r.birthDate.slice(5, 7)),
    normalize: asNumber,
    options: () => MONTH_OPTIONS,
  },
  {
    id: "birth_year",
    source: "birth_date",
    textKey: "verify_q_birth_year",
    input: "text",
    isAvailable: always,
    expected: (r) => r.birthDate.slice(0, 4),
    normalize: digits,
  },
  {
    id: "phone_last_4",
    source: "phone",
    textKey: "verify_q_phone_last_4",
    input: "text",
    isAvailable: (r) => nationalPhone(r.phone).length >= 7,
    expected: (r) => nationalPhone(r.phone).slice(-4),
    normalize: digits,
  },
  {
    id: "phone_first_3",
    source: "phone",
    textKey: "verify_q_phone_first_3",
    input: "text",
    isAvailable: (r) => nationalPhone(r.phone).length >= 7,
    expected: (r) => nationalPhone(r.phone).slice(0, 3),
    normalize: digits,
  },
  {
    id: "email_hint",
    source: "email",
    textKey: "verify_q_email_hint",
    input: "options",
    isAvailable: (r) => (r.email ?? "").includes("@"),
    expected: (r) => emailHint(r.email ?? ""),
    normalize: (raw) => raw.trim().toLowerCase(),
    options: emailOptions,
  },
];

export function questionById(id: string): VerificationQuestion | null {
  return QUESTION_BANK.find((question) => question.id === id) ?? null;
}

export function answerMatches(questionId: string, record: VerifiableRecord, raw: string): boolean {
  const question = questionById(questionId);
  if (!question || !question.isAvailable(record)) {
    return false;
  }
  const expected = question.expected(record);
  return expected !== "" && question.normalize(raw) === expected;
}
```

- [ ] **Step 4: `draw.ts`**

```ts
import type { Random } from "@/modules/shared/domain/ports/random";
import { QUESTION_BANK, questionById, type VerifiableRecord } from "./questions";

export type QuestionPair = readonly [string, string];

function pick<T>(items: readonly T[], random: Random): T | undefined {
  return items[random.int(items.length)];
}

/**
 * Dos preguntas disponibles para el expediente, de fuentes distintas si se puede
 * (dia y mes de la misma fecha valen casi como una). `null` si no hay dos.
 */
export function drawPair(record: VerifiableRecord, random: Random): QuestionPair | null {
  const available = QUESTION_BANK.filter((question) => question.isAvailable(record));
  const first = pick(available, random);
  if (!first) {
    return null;
  }
  const others = available.filter((question) => question.id !== first.id);
  const otherSource = others.filter((question) => question.source !== first.source);
  const second = pick(otherSource.length > 0 ? otherSource : others, random);
  return second ? [first.id, second.id] : null;
}

/** El par guardado sigue sirviendo si ambas preguntas existen y aplican al expediente. */
export function pairUsable(pair: readonly string[], record: VerifiableRecord): boolean {
  return (
    pair.length === 2 &&
    pair.every((id) => questionById(id)?.isAvailable(record) === true)
  );
}
```

- [ ] **Step 5: `challenge.ts`**

```ts
import type { QuestionPair } from "./draw";

/** Par fijo y contador por expediente. Nunca guarda respuestas. */
export type Challenge = {
  readonly id: string;
  readonly tenantId: string;
  readonly medicalRecordId: string;
  readonly questionIds: QuestionPair;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
};

export type VerificationPolicy = { readonly maxAttempts: number; readonly lockMinutes: number };

export type AttemptOutcome = {
  readonly result: "verified" | "failed" | "locked";
  readonly remainingAttempts: number;
  readonly lockedUntil: Date | null;
};

export function isLocked(challenge: Challenge, now: Date): boolean {
  return challenge.lockedUntil !== null && challenge.lockedUntil.getTime() > now.getTime();
}

/** Vencimiento al leer: un bloqueo pasado vuelve el contador a cero con el mismo par. */
export function effectiveChallenge(challenge: Challenge, now: Date): Challenge {
  if (challenge.lockedUntil === null || isLocked(challenge, now)) {
    return challenge;
  }
  return { ...challenge, failedAttempts: 0, lockedUntil: null };
}

/**
 * Aplica un intento (ambas preguntas respondidas). Exito: re-sorteo y contador a cero.
 * Fallo: suma uno y bloquea al llegar al maximo, sin cambiar el par.
 */
export function applyAttempt(
  current: Challenge,
  success: boolean,
  now: Date,
  policy: VerificationPolicy,
  redraw: QuestionPair,
): { challenge: Challenge; outcome: AttemptOutcome } {
  const challenge = effectiveChallenge(current, now);
  if (isLocked(challenge, now)) {
    return {
      challenge,
      outcome: { result: "locked", remainingAttempts: 0, lockedUntil: challenge.lockedUntil },
    };
  }
  if (success) {
    const next = { ...challenge, questionIds: redraw, failedAttempts: 0, lockedUntil: null };
    return {
      challenge: next,
      outcome: { result: "verified", remainingAttempts: policy.maxAttempts, lockedUntil: null },
    };
  }
  const failedAttempts = challenge.failedAttempts + 1;
  if (failedAttempts < policy.maxAttempts) {
    return {
      challenge: { ...challenge, failedAttempts },
      outcome: {
        result: "failed",
        remainingAttempts: policy.maxAttempts - failedAttempts,
        lockedUntil: null,
      },
    };
  }
  const lockedUntil = new Date(now.getTime() + policy.lockMinutes * 60_000);
  return {
    challenge: { ...challenge, failedAttempts, lockedUntil },
    outcome: { result: "locked", remainingAttempts: 0, lockedUntil },
  };
}
```

- [ ] **Step 6: Fronteras**

En `backend/tests/fronteras.test.ts`, en el test «los modulos de la Fase 3 solo importan shared y auth de otros modulos», amplía la lista y la excepción:

```ts
    const phase3 = ["bot-config", "knowledge", "widget", "platform", "verification", "handoff", "conversation"];
    // conversation evalua respuestas con el dominio puro de verification (refinamiento 4).
    const extra: Record<string, RegExp> = { conversation: /modules\/verification\/domain\// };
```
y en el filtro, además de `!allowed.has(module)`, excluye los especificadores que cumplan `extra[mod]?.test(specifier)`. Añade un test:

```ts
  it("conversation solo toma el dominio de verification", () => {
    const offenders = listFiles(join(MODULES_DIR, "conversation")).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => /modules\/verification\/(application|infrastructure)\//.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 7: Correr pruebas**

Run: `npm --prefix backend exec vitest run tests/dominio/verificacion.test.ts tests/fronteras.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/shared/domain/ports/random.ts backend/src/modules/shared/infrastructure/crypto-random.ts backend/src/modules/verification/domain backend/tests/dominio/verificacion.test.ts backend/tests/fronteras.test.ts
git commit -m "feat(verification): banco de preguntas, sorteo de par fijo y reglas de bloqueo"
```

---

### Task 6: Persistencia y casos de uso de la verificación

**Files:**
- Create: `backend/src/modules/verification/domain/ports.ts`
- Create: `backend/src/modules/verification/application/verification.ts`
- Create: `backend/src/modules/verification/infrastructure/prisma-challenge-repository.ts`
- Create: `backend/tests/db/verificacion.test.ts`

**Interfaces:**
- Consumes: Tarea 5 (`Challenge`, `applyAttempt`, `drawPair`, `pairUsable`, `VerificationPolicy`, `VerifiableRecord`, `QuestionPair`, `Random`).
- Produces:
  - `ChallengeRepository = { find(tenantId, medicalRecordId): Promise<Challenge | null>; insertIfAbsent(challenge: Challenge, now: Date): Promise<void>; findForUpdate(tenantId, medicalRecordId): Promise<Challenge | null>; update(challenge: Challenge, now: Date): Promise<void> }`.
  - `VerificationPolicyReader = (tenantId: TenantId) => Promise<VerificationPolicy>`.
  - `createOpenChallenge(deps: { repo; ids; clock }) → OpenChallenge = (input: { tenantId: TenantId; medicalRecordId: string; questionIds: QuestionPair }) => Promise<QuestionPair>` (devuelve el par guardado, que gana si otra sesión lo creó antes).
  - `createReadChallenge(deps: { repo; clock }) → ReadChallenge = (tenantId, medicalRecordId) => Promise<Challenge | null>` (ya efectivo).
  - `createRecordVerificationAttempt(deps: { repo; clock; random; audit; policy: VerificationPolicyReader; records: (tenantId, id) => Promise<VerifiableRecord | null> }) → RecordVerificationAttempt = (input: AuditActor & { tenantId: TenantId; medicalRecordId: string; success: boolean }) => Promise<AttemptOutcome>`.
  - `createPrismaChallengeRepository(db: PrismaExecutor): ChallengeRepository`.

- [ ] **Step 1: Prueba (falla)**

Crea `backend/tests/db/verificacion.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cryptoRandom } from "@/modules/shared/infrastructure/crypto-random";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  createOpenChallenge,
  createReadChallenge,
  createRecordVerificationAttempt,
} from "@/modules/verification/application/verification";
import { createPrismaChallengeRepository } from "@/modules/verification/infrastructure/prisma-challenge-repository";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ACTOR = { actorSubject: "widget:s1", actorRole: "widget", requestId: "r1" };
const RECORD = { id: "", birthDate: "1990-03-07", phone: "3001234567", email: null };

function deps(db: PrismaExecutor, now = new Date()) {
  const repo = createPrismaChallengeRepository(db);
  const clock = { now: () => now };
  return {
    open: createOpenChallenge({ repo, ids: uuidV7Generator, clock }),
    read: createReadChallenge({ repo, clock }),
    attempt: createRecordVerificationAttempt({
      repo,
      clock,
      random: cryptoRandom,
      audit: createPrismaAuditLog(db, uuidV7Generator),
      policy: async () => ({ maxAttempts: 3, lockMinutes: 30 }),
      records: async (_tenant, id) => ({ ...RECORD, id }),
    }),
  };
}

describe("verificacion: persistencia", () => {
  let tenantId: ReturnType<typeof toTenantId>;
  const recordId = "mr-v";

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantId = toTenantId(await insertTenant(prisma, "v"));
    await prisma.medicalRecord.create({
      data: {
        id: recordId,
        tenantId,
        identifierSystem: "urn:hermes:patient",
        identifierValue: "MR-v",
        documentType: "CC",
        documentNumber: "4455667788",
        givenNames: "Ana",
        familyNames: "Paz",
        birthDate: new Date("1990-03-07"),
        phone: "3001234567",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("el primer par guardado gana y se mantiene entre sesiones", async () => {
    const { open } = deps(prisma);
    const first = await open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_day", "phone_last_4"] });
    const second = await open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_year", "phone_first_3"] });
    expect(first).toEqual(["birth_day", "phone_last_4"]);
    expect(second).toEqual(first);
  });

  it("tres fallos bloquean y auditan sin guardar respuestas", async () => {
    const { open, attempt, read } = deps(prisma);
    await open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_day", "phone_last_4"] });
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push((await attempt({ ...ACTOR, tenantId, medicalRecordId: recordId, success: false })).result);
    }
    expect(results).toEqual(["failed", "failed", "locked"]);
    expect((await read(tenantId, recordId))?.lockedUntil).not.toBeNull();
    const actions = await prisma.auditEvent.findMany({ where: { tenantId }, orderBy: { occurredAt: "asc" } });
    expect(actions.map((a) => a.action)).toEqual([
      "verification.failed",
      "verification.failed",
      "verification.locked",
    ]);
    expect(actions.every((a) => a.resourceId === recordId)).toBe(true);
  });

  it("dos intentos simultaneos no pierden incrementos", async () => {
    await deps(prisma).open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_day", "phone_last_4"] });
    const attemptInTx = () =>
      prisma.$transaction((tx) =>
        deps(tx).attempt({ ...ACTOR, tenantId, medicalRecordId: recordId, success: false }),
      );
    await Promise.all([attemptInTx(), attemptInTx()]);
    const row = await prisma.verificationChallenge.findFirstOrThrow({ where: { tenantId } });
    expect(row.failedAttempts).toBe(2);
  });

  it("un bloqueo vencido se lee con el contador en cero y el mismo par", async () => {
    const past = new Date(Date.now() - 2 * 3_600_000);
    const { open, attempt } = deps(prisma, past);
    await open({ tenantId, medicalRecordId: recordId, questionIds: ["birth_day", "phone_last_4"] });
    for (let i = 0; i < 3; i++) {
      await attempt({ ...ACTOR, tenantId, medicalRecordId: recordId, success: false });
    }
    const challenge = await deps(prisma).read(tenantId, recordId);
    expect(challenge).toMatchObject({ failedAttempts: 0, lockedUntil: null, questionIds: ["birth_day", "phone_last_4"] });
  });
});
```

Run: `npm --prefix backend run test:db -- verificacion` → FAIL (módulos inexistentes).

- [ ] **Step 2: Puertos**

`backend/src/modules/verification/domain/ports.ts`:
```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Challenge, VerificationPolicy } from "./challenge";

export type ChallengeRepository = {
  find(tenantId: TenantId, medicalRecordId: string): Promise<Challenge | null>;
  /** INSERT ... ON CONFLICT DO NOTHING: si otra sesion ya guardo un par, gana el suyo. */
  insertIfAbsent(challenge: Challenge, now: Date): Promise<void>;
  /** SELECT ... FOR UPDATE: serializa intentos simultaneos del mismo expediente. */
  findForUpdate(tenantId: TenantId, medicalRecordId: string): Promise<Challenge | null>;
  update(challenge: Challenge, now: Date): Promise<void>;
};

/** Parametros de bot-config (verification_max_attempts, verification_lock_minutes). */
export type VerificationPolicyReader = (tenantId: TenantId) => Promise<VerificationPolicy>;
```

- [ ] **Step 3: Casos de uso**

`backend/src/modules/verification/application/verification.ts`:

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { Random } from "@/modules/shared/domain/ports/random";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { type AttemptOutcome, applyAttempt, type Challenge, effectiveChallenge } from "../domain/challenge";
import { drawPair, type QuestionPair } from "../domain/draw";
import type { ChallengeRepository, VerificationPolicyReader } from "../domain/ports";
import type { VerifiableRecord } from "../domain/questions";

export type OpenChallenge = (input: {
  readonly tenantId: TenantId;
  readonly medicalRecordId: string;
  readonly questionIds: QuestionPair;
}) => Promise<QuestionPair>;

/** Guarda el par sorteado al identificarse (refinamiento 3); devuelve el que quedo guardado. */
export function createOpenChallenge(deps: {
  repo: ChallengeRepository;
  ids: IdGenerator;
  clock: Clock;
}): OpenChallenge {
  return async (input) => {
    const now = deps.clock.now();
    await deps.repo.insertIfAbsent(
      {
        id: deps.ids.next(),
        tenantId: input.tenantId,
        medicalRecordId: input.medicalRecordId,
        questionIds: input.questionIds,
        failedAttempts: 0,
        lockedUntil: null,
      },
      now,
    );
    const stored = await deps.repo.find(input.tenantId, input.medicalRecordId);
    if (!stored) {
      throw new NotFoundError();
    }
    return stored.questionIds;
  };
}

export type ReadChallenge = (tenantId: TenantId, medicalRecordId: string) => Promise<Challenge | null>;

export function createReadChallenge(deps: { repo: ChallengeRepository; clock: Clock }): ReadChallenge {
  return async (tenantId, medicalRecordId) => {
    const stored = await deps.repo.find(tenantId, medicalRecordId);
    return stored && effectiveChallenge(stored, deps.clock.now());
  };
}

export type RecordVerificationAttempt = (
  input: AuditActor & {
    readonly tenantId: TenantId;
    readonly medicalRecordId: string;
    readonly success: boolean;
  },
) => Promise<AttemptOutcome>;

type AttemptDeps = {
  readonly repo: ChallengeRepository;
  readonly clock: Clock;
  readonly random: Random;
  readonly audit: AuditLog;
  readonly policy: VerificationPolicyReader;
  readonly records: (tenantId: TenantId, id: string) => Promise<VerifiableRecord | null>;
};

const ACTION: Record<AttemptOutcome["result"], string> = {
  verified: "verification.succeeded",
  failed: "verification.failed",
  locked: "verification.locked",
};

/** Registra el hecho y el resultado, nunca que pregunta fallo ni que se respondio. */
export function createRecordVerificationAttempt(deps: AttemptDeps): RecordVerificationAttempt {
  return async (input) => {
    const now = deps.clock.now();
    const current = await deps.repo.findForUpdate(input.tenantId, input.medicalRecordId);
    const record = await deps.records(input.tenantId, input.medicalRecordId);
    if (!current || !record) {
      throw new NotFoundError();
    }
    const redraw = drawPair(record, deps.random) ?? current.questionIds;
    const policy = await deps.policy(input.tenantId);
    const { challenge, outcome } = applyAttempt(current, input.success, now, policy, redraw);
    await deps.repo.update(challenge, now);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: ACTION[outcome.result],
      resourceType: "medical_record",
      resourceId: input.medicalRecordId,
      requestId: input.requestId,
      occurredAt: now,
    });
    return outcome;
  };
}
```

Nota: un intento sobre un desafío ya bloqueado audita `verification.locked` sin cambiar el contador; es correcto (registra el hecho).

- [ ] **Step 4: Repositorio Prisma**

`backend/src/modules/verification/infrastructure/prisma-challenge-repository.ts`:

```ts
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { Challenge } from "../domain/challenge";
import type { QuestionPair } from "../domain/draw";
import type { ChallengeRepository } from "../domain/ports";

function mapChallenge(row: {
  id: string;
  tenantId: string;
  medicalRecordId: string;
  questionIds: string[];
  failedAttempts: number;
  lockedUntil: Date | null;
}): Challenge {
  return {
    id: row.id,
    tenantId: row.tenantId,
    medicalRecordId: row.medicalRecordId,
    questionIds: [row.questionIds[0] ?? "", row.questionIds[1] ?? ""] as QuestionPair,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
  };
}

export function createPrismaChallengeRepository(db: PrismaExecutor): ChallengeRepository {
  return {
    async find(tenantId, medicalRecordId) {
      const row = await db.verificationChallenge.findUnique({
        where: { tenantId_medicalRecordId: { tenantId, medicalRecordId } },
      });
      return row ? mapChallenge(row) : null;
    },

    async insertIfAbsent(challenge, now) {
      await db.verificationChallenge.createMany({
        data: [
          {
            id: challenge.id,
            tenantId: challenge.tenantId,
            medicalRecordId: challenge.medicalRecordId,
            questionIds: [...challenge.questionIds],
            failedAttempts: challenge.failedAttempts,
            lockedUntil: challenge.lockedUntil,
            createdAt: now,
            updatedAt: now,
          },
        ],
        skipDuplicates: true,
      });
    },

    async findForUpdate(tenantId, medicalRecordId) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "public"."verification_challenges"
        WHERE "tenant_id" = ${tenantId} AND "medical_record_id" = ${medicalRecordId} FOR UPDATE`;
      if (locked.length === 0) {
        return null;
      }
      return this.find(tenantId, medicalRecordId);
    },

    async update(challenge, now) {
      await db.verificationChallenge.update({
        where: { id: challenge.id },
        data: {
          questionIds: [...challenge.questionIds],
          failedAttempts: challenge.failedAttempts,
          lockedUntil: challenge.lockedUntil,
          updatedAt: now,
        },
      });
    },
  };
}
```

`createMany({ skipDuplicates: true })` es `INSERT ... ON CONFLICT DO NOTHING`: no aborta la transacción. Si `this.find` molesta al tipado, extrae `find` a una función local y úsala en ambos métodos.

- [ ] **Step 5: Correr pruebas**

Run: `npm --prefix backend run test:db -- verificacion` → PASS (4 tests).
Run: `npm --prefix backend exec vitest run tests/fronteras.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/verification backend/tests/db/verificacion.test.ts
git commit -m "feat(verification): par fijo persistido, intentos con bloqueo de fila y auditoria"
```

---

### Task 7: Pre-registro de pacientes y tickets de handoff

**Files:**
- Create: `backend/src/modules/patients/domain/pre-registration.ts`
- Modify: `backend/src/modules/patients/domain/ports/repositories.ts`
- Modify: `backend/src/modules/patients/infrastructure/prisma-medical-record-repository.ts`
- Create: `backend/src/modules/patients/application/pre-register-patient.ts`
- Create: `backend/src/modules/handoff/domain/handoff-ticket.ts`
- Create: `backend/src/modules/handoff/domain/ports.ts`
- Create: `backend/src/modules/handoff/application/create-handoff-ticket.ts`
- Create: `backend/src/modules/handoff/infrastructure/prisma-handoff-repository.ts`
- Create: `backend/tests/dominio/pre-registro.test.ts`
- Create: `backend/tests/db/pre-registro-handoff.test.ts`

**Interfaces:**
- Produces:
  - `PRE_REGISTRATION_SYSTEM = "urn:ingenius:pre-registration"`; `PreRegistrationData = { documentType: DocumentType; documentNumber: string; givenNames: string; familyNames: string; birthDate: string; phone: string; email: string | null }`; `validatePreRegistration(raw: PreRegistrationData, today: string): PreRegistrationData` (lanza `ValidationError` con `field`).
  - `MedicalRecordRepository.insertPreRegistered(record: MedicalRecord): Promise<void>` (lanza `ConflictError` `{ reason: "document_taken" }` si el documento ya existe).
  - `createPreRegisterPatient(deps: { repo: MedicalRecordRepository; ids; clock; audit }) → PreRegisterPatient = (input: AuditActor & { tenantId: TenantId; data: PreRegistrationData }) => Promise<MedicalRecord>`.
  - `HandoffReason = "requested" | "verification_locked" | "unverifiable"`; `HandoffTicket = { id; tenantId; conversationId; reason; medicalRecordId: string | null; createdAt: Date }`; `HandoffRepository = { insert(ticket: HandoffTicket): Promise<void> }`; `createCreateHandoffTicket(deps: { repo; ids; clock; audit }) → CreateHandoffTicket = (input: AuditActor & { tenantId: TenantId; conversationId: string; reason: HandoffReason; medicalRecordId: string | null }) => Promise<HandoffTicket>`; `createPrismaHandoffRepository(db)`.

- [ ] **Step 1: Pruebas de dominio (fallan)**

`backend/tests/dominio/pre-registro.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validatePreRegistration } from "@/modules/patients/domain/pre-registration";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const VALID = {
  documentType: "CC" as const,
  documentNumber: "1020304050",
  givenNames: "  Ana  María ",
  familyNames: "Pérez Gómez",
  birthDate: "1990-03-07",
  phone: "+57 300 123 4567",
  email: " Ana@Correo.COM ",
};
const TODAY = "2026-10-02";

function fieldOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof ValidationError ? (error.details as { field: string }).field : error;
  }
  return null;
}

describe("pre-registro: validacion autoritativa", () => {
  it("normaliza nombres, celular y correo", () => {
    expect(validatePreRegistration(VALID, TODAY)).toEqual({
      ...VALID,
      givenNames: "Ana María",
      phone: "3001234567",
      email: "ana@correo.com",
    });
  });

  it("rechaza cada campo invalido con su nombre", () => {
    expect(fieldOf(() => validatePreRegistration({ ...VALID, documentNumber: "12" }, TODAY))).toBe("document_number");
    expect(fieldOf(() => validatePreRegistration({ ...VALID, givenNames: "Ana3" }, TODAY))).toBe("given_names");
    expect(fieldOf(() => validatePreRegistration({ ...VALID, birthDate: "2027-01-01" }, TODAY))).toBe("birth_date");
    expect(fieldOf(() => validatePreRegistration({ ...VALID, birthDate: "1990-02-30" }, TODAY))).toBe("birth_date");
    expect(fieldOf(() => validatePreRegistration({ ...VALID, phone: "6011234567" }, TODAY))).toBe("phone");
    expect(fieldOf(() => validatePreRegistration({ ...VALID, email: "sin-arroba" }, TODAY))).toBe("email");
  });

  it("el correo es opcional", () => {
    expect(validatePreRegistration({ ...VALID, email: null }, TODAY).email).toBeNull();
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/pre-registro.test.ts` → FAIL.

- [ ] **Step 2: `patients/domain/pre-registration.ts`**

```ts
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { DocumentType } from "./entities";

/** Hermes asigna su identificador al confirmar (Fase 4); hasta entonces, el id propio. */
export const PRE_REGISTRATION_SYSTEM = "urn:ingenius:pre-registration";

export type PreRegistrationData = {
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string;
  readonly email: string | null;
};

const DOCUMENT = /^[A-Z0-9]{3,20}$/;
const NAME = /^[\p{L}][\p{L}' -]{0,99}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE = /^3\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(field: string, message: string): never {
  throw new ValidationError(message, { field });
}

function name(raw: string, field: string): string {
  const value = raw.trim().replace(/\s+/g, " ");
  return NAME.test(value) ? value : fail(field, `${field} solo admite letras (1 a 100)`);
}

function birthDate(raw: string, today: string): string {
  const value = raw.trim();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const valid = DATE.test(value) && parsed.toISOString().slice(0, 10) === value;
  if (!valid || value > today || value < "1900-01-01") {
    fail("birth_date", "birth_date debe ser una fecha AAAA-MM-DD pasada");
  }
  return value;
}

function mobile(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("57")) {
    digits = digits.slice(2);
  }
  return MOBILE.test(digits) ? digits : fail("phone", "phone debe ser un celular de 10 digitos");
}

function email(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  return EMAIL.test(value) && value.length <= 254 ? value : fail("email", "email invalido");
}

/** Validacion autoritativa del pre-registro (la del chat es solo UX, refinamiento 14). */
export function validatePreRegistration(raw: PreRegistrationData, today: string): PreRegistrationData {
  const documentNumber = raw.documentNumber.trim().toUpperCase();
  if (!DOCUMENT.test(documentNumber)) {
    fail("document_number", "document_number debe tener de 3 a 20 letras o digitos");
  }
  return {
    documentType: raw.documentType,
    documentNumber,
    givenNames: name(raw.givenNames, "given_names"),
    familyNames: name(raw.familyNames, "family_names"),
    birthDate: birthDate(raw.birthDate, today),
    phone: mobile(raw.phone),
    email: email(raw.email),
  };
}
```

Run: `npm --prefix backend exec vitest run tests/dominio/pre-registro.test.ts` → PASS.

- [ ] **Step 3: Repositorio de expedientes**

En `patients/domain/ports/repositories.ts`, dentro de `MedicalRecordRepository`:
```ts
  /** Inserta un expediente `pre_registered`. Documento ya existente → ConflictError document_taken. */
  insertPreRegistered(record: MedicalRecord): Promise<void>;
```

En `prisma-medical-record-repository.ts` (importa `ConflictError` y `isUniqueViolation`):
```ts
    async insertPreRegistered(record) {
      try {
        await db.medicalRecord.create({
          data: {
            id: record.id,
            tenantId: record.tenantId,
            identifierSystem: record.identifier.system,
            identifierValue: record.identifier.value,
            documentType: record.documentType,
            documentNumber: record.documentNumber,
            givenNames: record.givenNames,
            familyNames: record.familyNames,
            birthDate: new Date(`${record.birthDate}T00:00:00.000Z`),
            phone: record.phone,
            email: record.email,
            status: "pre_registered",
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("El documento ya esta registrado", { reason: "document_taken" });
        }
        throw error;
      }
    },
```

La violación de unicidad aborta la transacción de Postgres: el ejecutor de efectos de la Tarea 14 la envuelve en `SAVEPOINT`.

- [ ] **Step 4: Caso de uso `pre-register-patient.ts`**

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { MedicalRecord } from "../domain/entities";
import type { MedicalRecordRepository } from "../domain/ports/repositories";
import {
  PRE_REGISTRATION_SYSTEM,
  type PreRegistrationData,
  validatePreRegistration,
} from "../domain/pre-registration";

export type PreRegisterPatient = (
  input: AuditActor & { readonly tenantId: TenantId; readonly data: PreRegistrationData },
) => Promise<MedicalRecord>;

/** El chat solo origina pre-registros; Hermes los confirma (GOBERNANZA §1.2). */
export function createPreRegisterPatient(deps: {
  repo: MedicalRecordRepository;
  ids: IdGenerator;
  clock: Clock;
  audit: AuditLog;
}): PreRegisterPatient {
  return async (input) => {
    const now = deps.clock.now();
    const data = validatePreRegistration(input.data, now.toISOString().slice(0, 10));
    const id = deps.ids.next();
    const record: MedicalRecord = {
      id,
      tenantId: input.tenantId,
      identifier: { system: PRE_REGISTRATION_SYSTEM, value: id },
      ...data,
      status: "pre_registered",
    };
    await deps.repo.insertPreRegistered(record);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "patient.pre_registered",
      resourceType: "medical_record",
      resourceId: id,
      requestId: input.requestId,
      occurredAt: now,
    });
    return record;
  };
}
```

- [ ] **Step 5: Módulo `handoff`**

`handoff/domain/handoff-ticket.ts`:
```ts
import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Por que el chat deriva a un asesor. La gestion del ticket llega en la Fase 6. */
export type HandoffReason = "requested" | "verification_locked" | "unverifiable";

export type HandoffTicket = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly conversationId: string;
  readonly reason: HandoffReason;
  /** Solo si el paciente verifico en la sesion (refinamiento 13). */
  readonly medicalRecordId: string | null;
  readonly createdAt: Date;
};
```

`handoff/domain/ports.ts`:
```ts
import type { HandoffTicket } from "./handoff-ticket";

export type HandoffRepository = { insert(ticket: HandoffTicket): Promise<void> };
```

`handoff/application/create-handoff-ticket.ts`:
```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { HandoffReason, HandoffTicket } from "../domain/handoff-ticket";
import type { HandoffRepository } from "../domain/ports";

export type CreateHandoffTicket = (
  input: AuditActor & {
    readonly tenantId: TenantId;
    readonly conversationId: string;
    readonly reason: HandoffReason;
    readonly medicalRecordId: string | null;
  },
) => Promise<HandoffTicket>;

export function createCreateHandoffTicket(deps: {
  repo: HandoffRepository;
  ids: IdGenerator;
  clock: Clock;
  audit: AuditLog;
}): CreateHandoffTicket {
  return async (input) => {
    const ticket: HandoffTicket = {
      id: deps.ids.next(),
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      reason: input.reason,
      medicalRecordId: input.medicalRecordId,
      createdAt: deps.clock.now(),
    };
    await deps.repo.insert(ticket);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "handoff.created",
      resourceType: "handoff_ticket",
      resourceId: ticket.id,
      requestId: input.requestId,
      occurredAt: ticket.createdAt,
    });
    return ticket;
  };
}
```

`handoff/infrastructure/prisma-handoff-repository.ts`:
```ts
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { HandoffRepository } from "../domain/ports";

export function createPrismaHandoffRepository(db: PrismaExecutor): HandoffRepository {
  return {
    async insert(ticket) {
      await db.handoffTicket.create({
        data: {
          id: ticket.id,
          tenantId: ticket.tenantId,
          conversationId: ticket.conversationId,
          reason: ticket.reason,
          medicalRecordId: ticket.medicalRecordId,
          createdAt: ticket.createdAt,
        },
      });
    },
  };
}
```

- [ ] **Step 6: Prueba de BD**

`backend/tests/db/pre-registro-handoff.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCreateHandoffTicket } from "@/modules/handoff/application/create-handoff-ticket";
import { createPrismaHandoffRepository } from "@/modules/handoff/infrastructure/prisma-handoff-repository";
import { createPreRegisterPatient } from "@/modules/patients/application/pre-register-patient";
import { createPrismaMedicalRecordRepository } from "@/modules/patients/infrastructure/prisma-medical-record-repository";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import { systemClock } from "@/modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ACTOR = { actorSubject: "widget:s1", actorRole: "widget", requestId: "r1" };
const DATA = {
  documentType: "CC" as const,
  documentNumber: "1020304050",
  givenNames: "Ana",
  familyNames: "Paz",
  birthDate: "1990-03-07",
  phone: "3001234567",
  email: null,
};

describe("pre-registro y handoff: persistencia", () => {
  let tenantId: ReturnType<typeof toTenantId>;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantId = toTenantId((await insertChatbotTenant(prisma, "p")).tenantId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const deps = () => ({
    repo: createPrismaMedicalRecordRepository(prisma),
    ids: uuidV7Generator,
    clock: systemClock,
    audit: createPrismaAuditLog(prisma, uuidV7Generator),
  });

  it("crea un expediente pre_registered con identificador propio y lo audita", async () => {
    const record = await createPreRegisterPatient(deps())({ ...ACTOR, tenantId, data: DATA });
    const row = await prisma.medicalRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row).toMatchObject({
      status: "pre_registered",
      identifierSystem: "urn:ingenius:pre-registration",
      identifierValue: record.id,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId } });
    expect(audit).toMatchObject({ action: "patient.pre_registered", resourceId: record.id });
  });

  it("un documento existente es document_taken", async () => {
    const register = createPreRegisterPatient(deps());
    await register({ ...ACTOR, tenantId, data: DATA });
    await expect(register({ ...ACTOR, tenantId, data: DATA })).rejects.toMatchObject({
      constructor: ConflictError,
      details: { reason: "document_taken" },
    });
  });

  it("el ticket de handoff nace abierto y se audita", async () => {
    const now = new Date();
    await prisma.widgetSession.create({
      data: { id: "ws", tenantId, origin: "https://c.test", createdAt: now, expiresAt: now, lastSeenAt: now },
    });
    await prisma.conversation.create({
      data: { id: "c1", tenantId, widgetSessionId: "ws", step: "main_menu", context: {}, createdAt: now, updatedAt: now },
    });
    const create = createCreateHandoffTicket({
      repo: createPrismaHandoffRepository(prisma),
      ids: uuidV7Generator,
      clock: systemClock,
      audit: createPrismaAuditLog(prisma, uuidV7Generator),
    });
    const ticket = await create({ ...ACTOR, tenantId, conversationId: "c1", reason: "requested", medicalRecordId: null });
    expect(await prisma.handoffTicket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({
      status: "open",
      reason: "requested",
    });
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { tenantId } })).action).toBe("handoff.created");
  });
});
```

Run: `npm --prefix backend run test:db -- pre-registro-handoff` → PASS.
Run: `npm --prefix backend exec vitest run tests/fronteras.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/patients backend/src/modules/handoff backend/tests/dominio/pre-registro.test.ts backend/tests/db/pre-registro-handoff.test.ts
git commit -m "feat(patients,handoff): pre-registro autoritativo y creacion de tickets de handoff"
```

---
### Task 8: Núcleo del motor (`conversation/domain`)

**Files:**
- Create: `backend/src/modules/conversation/domain/document.ts`
- Create: `backend/src/modules/conversation/domain/text.ts`
- Create: `backend/src/modules/conversation/domain/reads.ts`
- Create: `backend/src/modules/conversation/domain/types.ts`
- Create: `backend/src/modules/conversation/domain/format.ts`
- Create: `backend/src/modules/conversation/domain/message-input.ts`
- Create: `backend/src/modules/conversation/domain/step-kit.ts`
- Create: `backend/src/modules/conversation/domain/engine.ts`
- Create: `backend/tests/dominio/flujo-support.ts`
- Create: `backend/tests/dominio/flujo-motor.test.ts`

**Interfaces:**
- Consumes: `Random` (T5), `Challenge`, `isLocked` (T5), `VerifiableRecord` (T5), `QuestionPair` (T5), `startOfDayInZone` (`shared/domain/date-range`), `ConflictError`, `ValidationError`, `asRecord`, `requiredText`.
- Produces (los usan T9–T14):
  - `document.ts`: `DocumentType`, `DOCUMENT_TYPES`, `isDocumentType(value: string): value is DocumentType`.
  - `text.ts`: `REDACTED = "[redactado]"`, `CONVERSATION_TEXT_KEYS`, `ConversationTextKey`, `BotText = { key: ConversationTextKey; params?: Record<string,string>; append?: string } | { literal: string }`, `BotLine = { text: BotText; redacted?: boolean }`, `t(key, params?)`, `literal(text)`, `line(key, params?, redacted?)`.
  - `reads.ts`: `ConversationReads`, `NamedRef`, `AvailableSlot`, `UpcomingAppointment`, `KnowledgeHit`, `SlotFilter`.
  - `types.ts`: `StepId`, `InputMode`, `HandoffReason`, `PreRegField`, `OptionSpec`, `StoredOption`, `VerificationDraft`, `PreRegistrationDraft`, `BookingDraft`, `KbResult`, `ConversationContext`, `ConversationState`, `PatientInput`, `IncomingMessage`, `AppointmentCommand`, `PreRegistrationPayload`, `Effect`, `EffectFailure`, `EffectOutcome`, `ConversationParams`, `StepEnv`, `EnterResult`, `HandleResult`, `Step`, `StepRegistry`.
  - `format.ts`: `localDate(instant, tz)`, `formatDay(instant, tz)`, `formatTime(instant, tz)`, `formatWhen(instant, tz)`, `dayBounds(date, tz)`, `formatLocalDay(date, tz)`, `maskDocument(type, raw)`.
  - `message-input.ts`: `parseIncomingMessage(raw: unknown): IncomingMessage`, `MAX_TEXT_LENGTH = 500`.
  - `step-kit.ts`: `prompt`, `redirect`, `go`, `retry`, `choice`, `resetFlow`, `optionValue`, `isOption`.
  - `engine.ts`: `NAV`, `Echo = { text: BotText; redacted: boolean }`, `TurnOutput = { state; echo: Echo | null; lines: readonly BotLine[] }`, `startConversation(env, steps): Promise<TurnOutput>`, `runTurn(state, message, env, runEffect: (effect: Effect) => Promise<EffectOutcome>, steps): Promise<TurnOutput>`.

- [ ] **Step 1: `document.ts` y `text.ts`**

`document.ts`:
```ts
export type DocumentType = "CC" | "TI" | "CE" | "PA" | "RC";

export const DOCUMENT_TYPES: readonly DocumentType[] = ["CC", "TI", "CE", "PA", "RC"];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}
```

`text.ts`:
```ts
/**
 * Referencias a textos del bot. El motor nunca escribe texto propio: usa claves de bot-config
 * (renderizadas en application), contenido de la KB o datos de dominio (`literal`).
 */
export const REDACTED = "[redactado]";

export const CONVERSATION_TEXT_KEYS = [
  "welcome", "kb_see_more_label", "menu_prompt", "option_appointments", "option_kb",
  "option_advisor", "option_menu", "option_cancel", "option_confirm", "option_accept",
  "option_decline", "option_skip", "option_restart", "option_more", "invalid_option",
  "generic_error", "kb_prompt", "kb_no_results", "kb_results_prompt", "kb_another",
  "handoff_created", "closed_prompt", "id_document_type_prompt", "doc_type_cc", "doc_type_ti",
  "doc_type_ce", "doc_type_pa", "doc_type_rc", "id_document_number_prompt",
  "id_document_number_invalid", "verify_intro", "verify_q_birth_day", "verify_q_birth_month",
  "verify_q_birth_year", "verify_q_phone_last_4", "verify_q_phone_first_3",
  "verify_q_email_hint", "verify_success", "verify_failed", "verify_locked",
  "verify_unverifiable", "prereg_not_found", "privacy_notice", "privacy_declined",
  "prereg_given_names_prompt", "prereg_family_names_prompt", "prereg_birth_date_prompt",
  "prereg_phone_prompt", "prereg_email_prompt", "prereg_invalid", "prereg_confirm_prompt",
  "prereg_done", "prereg_document_taken", "appointments_menu_prompt", "option_book",
  "option_reschedule", "option_cancel_appointment", "book_service_prompt", "book_no_services",
  "book_practitioner_prompt", "option_any_practitioner", "book_day_prompt", "book_no_days",
  "book_slot_prompt", "book_confirm_prompt", "request_created", "slot_taken", "pending_limit",
  "change_pending", "appointment_unavailable", "no_upcoming_appointments",
  "pick_appointment_prompt", "cancel_confirm_prompt", "cancel_request_created",
] as const;

export type ConversationTextKey = (typeof CONVERSATION_TEXT_KEYS)[number];

export type BotText =
  | {
      readonly key: ConversationTextKey;
      readonly params?: Readonly<Record<string, string>>;
      /** Dato de dominio que sigue al texto (p. ej. «Ver más: <pregunta>»). */
      readonly append?: string;
    }
  | { readonly literal: string };

/** Mensaje del bot. `redacted`: se guarda como [redactado] (lleva datos personales). */
export type BotLine = { readonly text: BotText; readonly redacted?: boolean };

export function t(key: ConversationTextKey, params?: Readonly<Record<string, string>>): BotText {
  return params ? { key, params } : { key };
}

export function literal(text: string): BotText {
  return { literal: text };
}

export function line(
  key: ConversationTextKey,
  params?: Readonly<Record<string, string>>,
  redacted = false,
): BotLine {
  return redacted ? { text: t(key, params), redacted } : { text: t(key, params) };
}
```

(Biome formatea el arreglo una clave por línea; está bien.)

- [ ] **Step 2: `reads.ts`**

```ts
import type { Challenge } from "@/modules/verification/domain/challenge";
import type { VerifiableRecord } from "@/modules/verification/domain/questions";
import type { DocumentType } from "./document";

/** Lo que los pasos pueden leer. Solo lectura: las escrituras son efectos declarados. */
export type NamedRef = { readonly id: string; readonly name: string };

export type AvailableSlot = {
  readonly id: string;
  readonly startAt: Date;
  readonly serviceName: string;
  readonly practitionerName: string;
};

export type UpcomingAppointment = {
  readonly id: string;
  readonly startAt: Date;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly practitionerName: string;
};

export type KnowledgeHit = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly detail: string | null;
};

export type SlotFilter = {
  readonly serviceId: string;
  readonly practitionerId: string | null;
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
};

export type ConversationReads = {
  findPatient(
    tenantId: string,
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<VerifiableRecord | null>;
  getPatient(tenantId: string, id: string): Promise<VerifiableRecord | null>;
  /** Ya efectivo: un bloqueo vencido llega con el contador en cero. */
  challenge(tenantId: string, medicalRecordId: string): Promise<Challenge | null>;
  searchKnowledge(tenantId: string, query: string, max: number): Promise<KnowledgeHit[]>;
  getKnowledge(tenantId: string, id: string): Promise<KnowledgeHit | null>;
  listServices(tenantId: string): Promise<NamedRef[]>;
  listPractitioners(tenantId: string, serviceId: string): Promise<NamedRef[]>;
  /** Cupos `free` de agendas activas, ordenados por inicio; vence solicitudes antes de leer. */
  listAvailableSlots(tenantId: string, filter: SlotFilter): Promise<AvailableSlot[]>;
  listUpcomingAppointments(
    tenantId: string,
    medicalRecordId: string,
    now: Date,
  ): Promise<UpcomingAppointment[]>;
};
```

- [ ] **Step 3: `types.ts`**

```ts
import type { Random } from "@/modules/shared/domain/ports/random";
import type { QuestionPair } from "@/modules/verification/domain/draw";
import type { DocumentType } from "./document";
import type { ConversationReads } from "./reads";
import type { BotLine, BotText } from "./text";

export type StepId =
  | "main_menu"
  | "closed"
  | "kb_query"
  | "kb_results"
  | "id_document_type"
  | "id_document_number"
  | "verify_question"
  | "verification_blocked"
  | "privacy_notice"
  | "prereg_field"
  | "prereg_confirm"
  | "appointments_menu"
  | "pick_appointment"
  | "cancel_confirm"
  | "book_service"
  | "book_practitioner"
  | "book_day"
  | "book_slot"
  | "book_confirm";

export type InputMode = "none" | "text" | "date";
export type HandoffReason = "requested" | "verification_locked" | "unverifiable";
export type PreRegField = "given_names" | "family_names" | "birth_date" | "phone" | "email";

export type OptionSpec = { readonly value: string; readonly label: BotText };
/** Opcion vigente del turno: el id es opaco y solo vale para ese turno. */
export type StoredOption = OptionSpec & { readonly id: string };

/** Nunca guarda respuestas: solo si la primera fue correcta (refinamiento 3 / §5.2). */
export type VerificationDraft = {
  readonly medicalRecordId: string;
  readonly questionIds: QuestionPair;
  readonly index: 0 | 1;
  readonly firstCorrect?: boolean;
};

/** Borrador del pre-registro; se borra al confirmar o abandonar. */
export type PreRegistrationDraft = {
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly field: PreRegField;
  readonly givenNames?: string;
  readonly familyNames?: string;
  readonly birthDate?: string;
  readonly phone?: string;
  readonly email?: string | null;
};

export type BookingDraft = {
  readonly kind: "book" | "reschedule" | "cancel";
  readonly appointmentId?: string;
  readonly serviceId?: string;
  readonly practitionerId?: string | null;
  readonly day?: string;
  readonly dayOffset?: number;
  readonly slotOffset?: number;
  readonly slotId?: string;
};

export type KbResult = { readonly id: string; readonly question: string };

export type ConversationContext = {
  readonly turn: number;
  readonly options: readonly StoredOption[];
  readonly input: InputMode;
  /** Expediente verificado (o recien pre-registrado) en esta sesion. */
  readonly patientId?: string;
  readonly documentType?: DocumentType;
  readonly verification?: VerificationDraft;
  readonly preRegistration?: PreRegistrationDraft;
  readonly booking?: BookingDraft;
  readonly kbResults?: readonly KbResult[];
  readonly handoffReason?: HandoffReason;
};

export type ConversationState = { readonly step: StepId; readonly context: ConversationContext };

export type PatientInput =
  | { readonly kind: "option"; readonly value: string; readonly label: BotText }
  | { readonly kind: "text"; readonly text: string };

export type IncomingMessage = { readonly optionId: string } | { readonly text: string };

export type AppointmentCommand =
  | { readonly kind: "book"; readonly slotId: string }
  | { readonly kind: "reschedule"; readonly appointmentId: string; readonly slotId: string }
  | { readonly kind: "cancel"; readonly appointmentId: string };

export type PreRegistrationPayload = {
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string;
  readonly email: string | null;
};

/** Unica forma de escribir desde un paso. A lo sumo uno por turno (refinamiento 1). */
export type Effect =
  | {
      readonly kind: "request_appointment";
      readonly medicalRecordId: string;
      readonly command: AppointmentCommand;
    }
  | { readonly kind: "pre_register"; readonly data: PreRegistrationPayload }
  | {
      readonly kind: "handoff";
      readonly reason: HandoffReason;
      readonly medicalRecordId: string | null;
    }
  | {
      readonly kind: "open_challenge";
      readonly medicalRecordId: string;
      readonly questionIds: QuestionPair;
    }
  | {
      readonly kind: "verification_attempt";
      readonly medicalRecordId: string;
      readonly success: boolean;
    };

export type EffectFailure =
  | "slot_unavailable"
  | "pending_limit_reached"
  | "appointment_change_pending"
  | "not_available"
  | "document_taken";

export type VerificationResult = {
  readonly result: "verified" | "failed" | "locked";
  readonly remainingAttempts: number;
  readonly lockedUntil: Date | null;
};

export type EffectOutcome =
  | {
      readonly ok: true;
      readonly expiresAt?: Date;
      readonly medicalRecordId?: string;
      readonly questionIds?: QuestionPair;
      readonly verification?: VerificationResult;
    }
  | { readonly ok: false; readonly failure: EffectFailure; readonly max?: number };

export type ConversationParams = { readonly kbMaxResults: number };

export type StepEnv = {
  readonly tenantId: string;
  readonly now: Date;
  readonly timeZone: string;
  readonly params: ConversationParams;
  readonly random: Random;
  readonly reads: ConversationReads;
};

export type EnterResult =
  | {
      readonly kind: "prompt";
      readonly lines: readonly BotLine[];
      readonly options: readonly OptionSpec[];
      readonly input: InputMode;
      readonly context: ConversationContext;
    }
  | {
      readonly kind: "goto";
      readonly lines: readonly BotLine[];
      readonly goto: StepId;
      readonly context: ConversationContext;
    };

export type HandleResult = {
  readonly goto: StepId;
  readonly context: ConversationContext;
  readonly lines: readonly BotLine[];
  readonly effect?: Effect;
  /** Continuacion pura con el resultado del efecto; no puede declarar otro efecto. */
  readonly then?: (outcome: EffectOutcome) => HandleResult;
};

export type Step = {
  readonly id: StepId;
  /** `full`: Menu (salvo en main_menu) y Asesor; `cancel_only`: solo Cancelar (verificacion). */
  readonly globals: "full" | "cancel_only";
  /** Como se guarda la entrada del paciente: etiqueta de la opcion, redactada o documento enmascarado. */
  readonly echo: "label" | "redacted" | "document";
  enter(context: ConversationContext, env: StepEnv): Promise<EnterResult>;
  handle(input: PatientInput, context: ConversationContext, env: StepEnv): Promise<HandleResult>;
};

export type StepRegistry = Readonly<Record<StepId, Step>>;
```

- [ ] **Step 4: `format.ts` y `message-input.ts`**

`format.ts`:
```ts
import { startOfDayInZone } from "@/modules/shared/domain/date-range";

/** Formatos de fecha del chat (datos de dominio, no textos de bot-config). */
const LOCALE = "es-CO";
const DAY_MS = 86_400_000;

export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function formatDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}

export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function formatWhen(instant: Date, timeZone: string): string {
  return `${formatDay(instant, timeZone)}, ${formatTime(instant, timeZone)}`;
}

/** Inicio y fin (exclusivo) del dia local `YYYY-MM-DD` en la zona. */
export function dayBounds(date: string, timeZone: string): { from: Date; to: Date } {
  const next = new Date(new Date(`${date}T00:00:00.000Z`).getTime() + DAY_MS);
  return {
    from: startOfDayInZone(date, timeZone),
    to: startOfDayInZone(next.toISOString().slice(0, 10), timeZone),
  };
}

export function formatLocalDay(date: string, timeZone: string): string {
  const { from } = dayBounds(date, timeZone);
  return formatDay(new Date(from.getTime() + DAY_MS / 2), timeZone);
}

/** Eco del documento en el historial: tipo y ultimos 4 caracteres. */
export function maskDocument(type: string | undefined, raw: string): string {
  const clean = raw.replace(/[\s.-]/g, "").toUpperCase();
  return `${type ?? ""} ••••${clean.slice(-4)}`.trim();
}
```

`message-input.ts`:
```ts
import { asRecord, requiredText } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { IncomingMessage } from "./types";

export const MAX_TEXT_LENGTH = 500;
const MAX_OPTION_ID_LENGTH = 64;
const FIELDS = new Set(["option_id", "text"]);

/** Cuerpo de `POST /widget/conversation/messages`: exactamente uno de option_id o text. */
export function parseIncomingMessage(raw: unknown): IncomingMessage {
  const data = asRecord(raw, "body");
  const unknown = Object.keys(data).find((key) => !FIELDS.has(key));
  if (unknown !== undefined) {
    throw new ValidationError(`Campo desconocido: ${unknown}`, { field: unknown });
  }
  const hasOption = Object.hasOwn(data, "option_id");
  if (hasOption === Object.hasOwn(data, "text")) {
    throw new ValidationError("Envia option_id o text, no ambos", { field: "body" });
  }
  if (!hasOption) {
    return { text: requiredText(data.text, "text", MAX_TEXT_LENGTH) };
  }
  const optionId = data.option_id;
  if (typeof optionId !== "string" || optionId === "" || optionId.length > MAX_OPTION_ID_LENGTH) {
    throw new ValidationError("option_id invalido", { field: "option_id" });
  }
  return { optionId };
}
```

- [ ] **Step 5: `step-kit.ts`**

```ts
import type { BotLine, BotText, ConversationTextKey } from "./text";
import { line } from "./text";
import type {
  ConversationContext,
  EnterResult,
  HandleResult,
  InputMode,
  OptionSpec,
  PatientInput,
  StepId,
} from "./types";

/** Utilidades de los pasos: construir turnos y transiciones sin repetir forma. */
export function prompt(
  context: ConversationContext,
  lines: readonly BotLine[],
  options: readonly OptionSpec[],
  input: InputMode = "none",
): EnterResult {
  return { kind: "prompt", lines, options, input, context };
}

export function redirect(
  goto: StepId,
  context: ConversationContext,
  lines: readonly BotLine[] = [],
): EnterResult {
  return { kind: "goto", goto, context, lines };
}

export function go(
  goto: StepId,
  context: ConversationContext,
  lines: readonly BotLine[] = [],
): HandleResult {
  return { goto, context, lines };
}

/** Repite el paso con un aviso (por defecto «elige una de las opciones»). */
export function retry(
  step: StepId,
  context: ConversationContext,
  key: ConversationTextKey = "invalid_option",
): HandleResult {
  return go(step, context, [line(key)]);
}

export function choice(value: string, label: BotText): OptionSpec {
  return { value, label };
}

/** Sale de cualquier flujo: conserva solo el turno, las opciones y al paciente verificado. */
export function resetFlow(context: ConversationContext): ConversationContext {
  return {
    turn: context.turn,
    options: context.options,
    input: context.input,
    ...(context.patientId ? { patientId: context.patientId } : {}),
  };
}

/** Valor de una opcion con prefijo (`svc:abc` → `abc`); `null` si no aplica. */
export function optionValue(input: PatientInput, prefix: string): string | null {
  return input.kind === "option" && input.value.startsWith(prefix)
    ? input.value.slice(prefix.length)
    : null;
}

export function isOption(input: PatientInput, value: string): boolean {
  return input.kind === "option" && input.value === value;
}
```

- [ ] **Step 6: Soporte de pruebas del flujo**

`backend/tests/dominio/flujo-support.ts`:
```ts
import type { ConversationReads } from "@/modules/conversation/domain/reads";
import type { BotLine } from "@/modules/conversation/domain/text";
import type {
  ConversationContext,
  EffectOutcome,
  PatientInput,
  StepEnv,
} from "@/modules/conversation/domain/types";
import type { Random } from "@/modules/shared/domain/ports/random";

/** Lunes 5 de octubre de 2026, 08:00 en Bogota. */
export const NOW = new Date("2026-10-05T13:00:00.000Z");
export const TZ = "America/Bogota";
export const firstRandom: Random = { int: () => 0 };

export function fakeReads(overrides: Partial<ConversationReads> = {}): ConversationReads {
  return {
    findPatient: async () => null,
    getPatient: async () => null,
    challenge: async () => null,
    searchKnowledge: async () => [],
    getKnowledge: async () => null,
    listServices: async () => [],
    listPractitioners: async () => [],
    listAvailableSlots: async () => [],
    listUpcomingAppointments: async () => [],
    ...overrides,
  };
}

export function makeEnv(reads: ConversationReads = fakeReads(), overrides: Partial<StepEnv> = {}): StepEnv {
  return {
    tenantId: "tenant-1",
    now: NOW,
    timeZone: TZ,
    params: { kbMaxResults: 3 },
    random: firstRandom,
    reads,
    ...overrides,
  };
}

export function ctx(extra: Partial<ConversationContext> = {}): ConversationContext {
  return { turn: 1, options: [], input: "none", ...extra };
}

export const opt = (value: string): PatientInput => ({ kind: "option", value, label: { literal: value } });
export const text = (value: string): PatientInput => ({ kind: "text", text: value });

/** Claves de los mensajes (o `literal:<texto>`), para comparar sin renderizar. */
export function keysOf(lines: readonly BotLine[]): string[] {
  return lines.map((l) => ("key" in l.text ? l.text.key : `literal:${l.text.literal}`));
}

export const okOutcome = (extra: Partial<Extract<EffectOutcome, { ok: true }>> = {}): EffectOutcome => ({
  ok: true,
  ...extra,
});
```

- [ ] **Step 7: Pruebas del motor (fallan)**

`backend/tests/dominio/flujo-motor.test.ts` — usa un registro de prueba con dos pasos reales mínimos (`main_menu` y `closed`) y un paso de texto:

```ts
import { describe, expect, it, vi } from "vitest";
import { NAV, runTurn, startConversation } from "@/modules/conversation/domain/engine";
import { parseIncomingMessage } from "@/modules/conversation/domain/message-input";
import { choice, go, prompt, retry } from "@/modules/conversation/domain/step-kit";
import { line, literal, t } from "@/modules/conversation/domain/text";
import type { Step, StepRegistry } from "@/modules/conversation/domain/types";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { keysOf, makeEnv } from "./flujo-support";

const menu: Step = {
  id: "main_menu",
  globals: "full",
  echo: "label",
  enter: async (c) => prompt(c, [line("menu_prompt")], [choice("menu:kb", t("option_kb"))]),
  handle: async (input, c) =>
    input.kind === "option" && input.value === "menu:kb" ? go("kb_query", c) : retry("main_menu", c),
};
const query: Step = {
  id: "kb_query",
  globals: "full",
  echo: "redacted",
  enter: async (c) => prompt(c, [line("kb_prompt")], [], "text"),
  handle: async (input, c) => go("kb_query", c, [{ text: literal(input.kind === "text" ? "eco" : "?") }]),
};
const closed: Step = {
  id: "closed",
  globals: "full",
  echo: "label",
  enter: async (c) => prompt(c, [line("closed_prompt")], []),
  handle: async (_i, c) => retry("closed", c),
};
const steps = { main_menu: menu, kb_query: query, closed } as unknown as StepRegistry;
const noEffect = vi.fn(async () => ({ ok: true as const }));

describe("flujo: motor", () => {
  it("arranca con la bienvenida y el menu, con Asesor pero sin Menu", async () => {
    const start = await startConversation(makeEnv(), steps);
    expect(keysOf(start.lines)).toEqual(["welcome", "menu_prompt"]);
    expect(start.state.step).toBe("main_menu");
    expect(start.state.context.options.map((o) => o.value)).toEqual(["menu:kb", NAV.advisor]);
    expect(start.state.context.options.map((o) => o.id)).toEqual(["1.1", "1.2"]);
    expect(start.echo).toBeNull();
  });

  it("una opcion de otro turno es stale_option y no toca el estado", async () => {
    const start = await startConversation(makeEnv(), steps);
    await expect(runTurn(start.state, { optionId: "9.1" }, makeEnv(), noEffect, steps)).rejects.toMatchObject({
      constructor: ConflictError,
      details: { reason: "stale_option" },
    });
  });

  it("texto donde se esperaba opcion repite el turno con invalid_option", async () => {
    const start = await startConversation(makeEnv(), steps);
    const out = await runTurn(start.state, { text: "hola" }, makeEnv(), noEffect, steps);
    expect(keysOf(out.lines)).toEqual(["invalid_option", "menu_prompt"]);
    expect(out.echo).toEqual({ text: { literal: "[redactado]" }, redacted: true });
    expect(out.state.context.turn).toBe(2);
  });

  it("la eleccion se guarda con su etiqueta y el texto libre redactado", async () => {
    const start = await startConversation(makeEnv(), steps);
    const toQuery = await runTurn(start.state, { optionId: "1.1" }, makeEnv(), noEffect, steps);
    expect(toQuery.echo).toEqual({ text: t("option_kb"), redacted: false });
    expect(toQuery.state.context.input).toBe("text");
    expect(toQuery.state.context.options.map((o) => o.value)).toEqual([NAV.menu, NAV.advisor]);
    const typed = await runTurn(toQuery.state, { text: "dolor de pecho" }, makeEnv(), noEffect, steps);
    expect(typed.echo?.redacted).toBe(true);
  });

  it("Asesor crea el handoff sin expediente si no verifico y cierra", async () => {
    const start = await startConversation(makeEnv(), steps);
    const runEffect = vi.fn(async () => ({ ok: true as const }));
    const out = await runTurn(start.state, { optionId: "1.2" }, makeEnv(), runEffect, steps);
    expect(runEffect).toHaveBeenCalledWith({ kind: "handoff", reason: "requested", medicalRecordId: null });
    expect(out.state.step).toBe("closed");
    expect(keysOf(out.lines)).toEqual(["handoff_created", "closed_prompt"]);
  });

  it("valida el cuerpo del mensaje", () => {
    expect(parseIncomingMessage({ option_id: "1.1" })).toEqual({ optionId: "1.1" });
    expect(parseIncomingMessage({ text: "  hola " })).toEqual({ text: "hola" });
    expect(() => parseIncomingMessage({})).toThrow(ValidationError);
    expect(() => parseIncomingMessage({ option_id: "1", text: "x" })).toThrow(ValidationError);
    expect(() => parseIncomingMessage({ text: "x".repeat(501) })).toThrow(ValidationError);
    expect(() => parseIncomingMessage({ text: "x", tenant_id: "otro" })).toThrow(ValidationError);
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-motor.test.ts` → FAIL (`engine` no existe).

- [ ] **Step 8: `engine.ts`**

```ts
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { maskDocument } from "./format";
import { resetFlow } from "./step-kit";
import { type BotLine, type BotText, line, REDACTED, t } from "./text";
import type {
  ConversationContext,
  ConversationState,
  Effect,
  EffectOutcome,
  HandleResult,
  IncomingMessage,
  OptionSpec,
  PatientInput,
  Step,
  StepEnv,
  StepId,
  StepRegistry,
} from "./types";

/** Opciones globales que el motor resuelve antes que el paso. */
export const NAV = { menu: "nav:menu", advisor: "nav:advisor", cancel: "nav:cancel" } as const;

const MAX_HOPS = 8;

export type Echo = { readonly text: BotText; readonly redacted: boolean };
export type TurnOutput = {
  readonly state: ConversationState;
  readonly echo: Echo | null;
  readonly lines: readonly BotLine[];
};
export type RunEffect = (effect: Effect) => Promise<EffectOutcome>;

function initialContext(): ConversationContext {
  return { turn: 0, options: [], input: "none" };
}

export function startConversation(env: StepEnv, steps: StepRegistry): Promise<TurnOutput> {
  return settle(steps, "main_menu", initialContext(), [line("welcome")], env, null);
}

/** Un turno: resuelve la entrada, aplica el paso (y su efecto) y entra al siguiente. */
export async function runTurn(
  state: ConversationState,
  message: IncomingMessage,
  env: StepEnv,
  runEffect: RunEffect,
  steps: StepRegistry,
): Promise<TurnOutput> {
  const step = steps[state.step];
  const input = resolveInput(state.context, message);
  const echo = echoOf(step, input, state.context);
  const handled = await dispatch(step, input, state.context, env, runEffect);
  return settle(steps, handled.goto, handled.context, handled.lines, env, echo);
}

function resolveInput(context: ConversationContext, message: IncomingMessage): PatientInput {
  if ("text" in message) {
    return { kind: "text", text: message.text };
  }
  const found = context.options.find((option) => option.id === message.optionId);
  if (!found) {
    throw new ConflictError("La opcion ya no esta vigente", { reason: "stale_option" });
  }
  return { kind: "option", value: found.value, label: found.label };
}

/** Texto libre siempre redactado salvo el documento, que va enmascarado (refinamiento 5). */
function echoOf(step: Step, input: PatientInput, context: ConversationContext): Echo {
  const redacted: Echo = { text: { literal: REDACTED }, redacted: true };
  if (input.kind === "option") {
    return step.echo === "redacted" ? redacted : { text: input.label, redacted: false };
  }
  if (step.echo === "document") {
    return { text: { literal: maskDocument(context.documentType, input.text) }, redacted: false };
  }
  return redacted;
}

async function dispatch(
  step: Step,
  input: PatientInput,
  context: ConversationContext,
  env: StepEnv,
  runEffect: RunEffect,
): Promise<HandleResult> {
  if (input.kind === "option" && input.value.startsWith("nav:")) {
    return navigate(input.value, context, runEffect);
  }
  if (input.kind === "text" && context.input === "none") {
    return { goto: step.id, context, lines: [line("invalid_option")] };
  }
  const result = await step.handle(input, context, env);
  if (!result.effect) {
    return result;
  }
  const outcome = await runEffect(result.effect);
  const next = result.then ? result.then(outcome) : result;
  if (result.then && next.effect) {
    throw new Error(`El paso ${step.id} declaro un efecto en su continuacion`);
  }
  return next;
}

async function navigate(
  value: string,
  context: ConversationContext,
  runEffect: RunEffect,
): Promise<HandleResult> {
  if (value !== NAV.advisor) {
    return { goto: "main_menu", context: resetFlow(context), lines: [] };
  }
  await runEffect({
    kind: "handoff",
    reason: context.handoffReason ?? "requested",
    medicalRecordId: context.patientId ?? null,
  });
  return { goto: "closed", context: resetFlow(context), lines: [line("handoff_created")] };
}

function withGlobals(step: Step, options: readonly OptionSpec[]): OptionSpec[] {
  if (step.globals === "cancel_only") {
    return [...options, { value: NAV.cancel, label: t("option_cancel") }];
  }
  const menu = step.id === "main_menu" ? [] : [{ value: NAV.menu, label: t("option_menu") }];
  return [...options, ...menu, { value: NAV.advisor, label: t("option_advisor") }];
}

/** Entra al paso destino siguiendo redirecciones hasta un turno con opciones. */
async function settle(
  steps: StepRegistry,
  goto: StepId,
  context: ConversationContext,
  lines: readonly BotLine[],
  env: StepEnv,
  echo: Echo | null,
): Promise<TurnOutput> {
  const said = [...lines];
  let target = goto;
  let current = context;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const entered = await steps[target].enter(current, env);
    said.push(...entered.lines);
    if (entered.kind === "goto") {
      target = entered.goto;
      current = entered.context;
      continue;
    }
    const turn = entered.context.turn + 1;
    const options = withGlobals(steps[target], entered.options).map((option, index) => ({
      ...option,
      id: `${turn}.${index + 1}`,
    }));
    const next = { ...entered.context, turn, options, input: entered.input };
    return { state: { step: target, context: next }, echo, lines: said };
  }
  throw new Error(`El flujo no se estabilizo al entrar a ${goto}`);
}
```

- [ ] **Step 9: Correr pruebas**

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-motor.test.ts tests/fronteras.test.ts` → PASS.
Run: `npm --prefix backend run typecheck` → sin errores.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/conversation/domain backend/tests/dominio/flujo-support.ts backend/tests/dominio/flujo-motor.test.ts
git commit -m "feat(conversation): motor determinista con opciones vigentes, navegacion global y efectos"
```

---
### Task 9: Pasos de menú, consultas a la KB y cierre

**Files:**
- Create: `backend/src/modules/conversation/domain/steps/menu.ts`
- Create: `backend/src/modules/conversation/domain/steps/knowledge.ts`
- Create: `backend/tests/dominio/flujo-menu-kb.test.ts`

**Interfaces:**
- Consumes: T8 (`Step`, `step-kit`, `text`, `KnowledgeHit`).
- Produces: `mainMenu`, `closed`, `verificationBlocked` (en `menu.ts`); `kbQuery`, `kbResults` (en `knowledge.ts`).

- [ ] **Step 1: Pruebas (fallan)**

```ts
import { describe, expect, it } from "vitest";
import { closed, mainMenu, verificationBlocked } from "@/modules/conversation/domain/steps/menu";
import { kbQuery, kbResults } from "@/modules/conversation/domain/steps/knowledge";
import { ctx, fakeReads, keysOf, makeEnv, opt, text } from "./flujo-support";

const HOURS = { id: "kb1", question: "¿Horarios?", answer: "Lunes a viernes 7 a 17", detail: "Sabados 8 a 12" };
const PARKING = { id: "kb2", question: "¿Parqueadero?", answer: "Sí, gratuito", detail: null };

describe("flujo: menu principal", () => {
  it("ofrece Mis citas y Consultas", async () => {
    const entered = await mainMenu.enter(ctx(), makeEnv());
    expect(entered.kind === "prompt" && entered.options.map((o) => o.value)).toEqual(["menu:appointments", "menu:kb"]);
  });

  it("Mis citas pide documento si no hay paciente verificado y va directo si lo hay", async () => {
    expect((await mainMenu.handle(opt("menu:appointments"), ctx(), makeEnv())).goto).toBe("id_document_type");
    expect((await mainMenu.handle(opt("menu:appointments"), ctx({ patientId: "mr" }), makeEnv())).goto).toBe("appointments_menu");
    expect((await mainMenu.handle(opt("menu:kb"), ctx(), makeEnv())).goto).toBe("kb_query");
  });

  it("cierre y bloqueo solo dejan las opciones globales", async () => {
    for (const step of [closed, verificationBlocked]) {
      const entered = await step.enter(ctx(), makeEnv());
      expect(entered.kind === "prompt" && entered.options).toEqual([]);
    }
  });
});

describe("flujo: consultas generales", () => {
  const env = makeEnv(
    fakeReads({
      searchKnowledge: async (_t, query, max) => (query.includes("horario") ? [HOURS, PARKING].slice(0, max) : []),
      getKnowledge: async (_t, id) => [HOURS, PARKING].find((e) => e.id === id) ?? null,
    }),
  );

  it("muestra las respuestas y ofrece Ver mas solo para las que tienen detalle", async () => {
    const handled = await kbQuery.handle(text("horario de atencion"), ctx(), env);
    expect(handled.goto).toBe("kb_results");
    expect(keysOf(handled.lines)).toEqual([
      "literal:¿Horarios?\nLunes a viernes 7 a 17",
      "literal:¿Parqueadero?\nSí, gratuito",
    ]);
    const entered = await kbResults.enter(handled.context, env);
    expect(entered.kind === "prompt" && entered.options).toEqual([
      { value: "kb:detail:kb1", label: { key: "kb_see_more_label", append: "¿Horarios?" } },
      { value: "kb:another", label: { key: "kb_another" } },
    ]);
  });

  it("sin resultados avisa y ofrece otra consulta", async () => {
    const handled = await kbQuery.handle(text("precio"), ctx(), env);
    expect(keysOf(handled.lines)).toEqual(["kb_no_results"]);
    expect(handled.context.kbResults).toEqual([]);
  });

  it("Ver mas muestra el detalle; Otra consulta vuelve a preguntar", async () => {
    const context = ctx({ kbResults: [{ id: "kb1", question: "¿Horarios?" }] });
    const detail = await kbResults.handle(opt("kb:detail:kb1"), context, env);
    expect(keysOf(detail.lines)).toEqual(["literal:Sabados 8 a 12"]);
    expect((await kbResults.handle(opt("kb:another"), context, env)).goto).toBe("kb_query");
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-menu-kb.test.ts` → FAIL.

- [ ] **Step 2: `steps/menu.ts`**

```ts
import { choice, go, prompt, retry } from "../step-kit";
import { line, t } from "../text";
import type { Step } from "../types";

export const mainMenu: Step = {
  id: "main_menu",
  globals: "full",
  echo: "label",
  async enter(context) {
    return prompt(
      context,
      [line("menu_prompt")],
      [choice("menu:appointments", t("option_appointments")), choice("menu:kb", t("option_kb"))],
    );
  },
  async handle(input, context) {
    if (input.kind === "option" && input.value === "menu:appointments") {
      return go(context.patientId ? "appointments_menu" : "id_document_type", context);
    }
    if (input.kind === "option" && input.value === "menu:kb") {
      return go("kb_query", context);
    }
    return retry("main_menu", context);
  },
};

/** Tras crear un handoff: solo Menu y Asesor (globales). */
export const closed: Step = {
  id: "closed",
  globals: "full",
  echo: "label",
  async enter(context) {
    return prompt(context, [line("closed_prompt")], []);
  },
  async handle(_input, context) {
    return retry("closed", context);
  },
};

/** Verificacion bloqueada o imposible: el contexto lleva `handoffReason` para el ticket. */
export const verificationBlocked: Step = {
  id: "verification_blocked",
  globals: "full",
  echo: "label",
  async enter(context) {
    return prompt(context, [line("menu_prompt")], []);
  },
  async handle(_input, context) {
    return retry("verification_blocked", context);
  },
};
```

- [ ] **Step 3: `steps/knowledge.ts`**

```ts
import { choice, go, isOption, optionValue, prompt, retry } from "../step-kit";
import { line, literal, t } from "../text";
import type { Step } from "../types";

/** Consulta libre contra la KB (busqueda determinista por keywords, sin IA). */
export const kbQuery: Step = {
  id: "kb_query",
  globals: "full",
  echo: "redacted",
  async enter(context) {
    return prompt(context, [line("kb_prompt")], [], "text");
  },
  async handle(input, context, env) {
    if (input.kind !== "text") {
      return retry("kb_query", context);
    }
    const hits = await env.reads.searchKnowledge(env.tenantId, input.text, env.params.kbMaxResults);
    if (hits.length === 0) {
      return go("kb_results", { ...context, kbResults: [] }, [line("kb_no_results")]);
    }
    const kbResults = hits
      .filter((hit) => hit.detail !== null)
      .map((hit) => ({ id: hit.id, question: hit.question }));
    const lines = hits.map((hit) => ({ text: literal(`${hit.question}\n${hit.answer}`) }));
    return go("kb_results", { ...context, kbResults }, lines);
  },
};

export const kbResults: Step = {
  id: "kb_results",
  globals: "full",
  echo: "label",
  async enter(context) {
    const details = (context.kbResults ?? []).map((result) =>
      choice(`kb:detail:${result.id}`, { key: "kb_see_more_label", append: result.question }),
    );
    return prompt(context, [line("kb_results_prompt")], [...details, choice("kb:another", t("kb_another"))]);
  },
  async handle(input, context, env) {
    const id = optionValue(input, "kb:detail:");
    if (id !== null) {
      const hit = await env.reads.getKnowledge(env.tenantId, id);
      const detail = hit?.detail ? { text: literal(hit.detail) } : line("kb_no_results");
      return go("kb_results", context, [detail]);
    }
    if (isOption(input, "kb:another")) {
      return go("kb_query", { ...context, kbResults: [] });
    }
    return retry("kb_results", context);
  },
};
```

- [ ] **Step 4: Correr pruebas y commit**

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-menu-kb.test.ts` → PASS.

```bash
git add backend/src/modules/conversation/domain/steps/menu.ts backend/src/modules/conversation/domain/steps/knowledge.ts backend/tests/dominio/flujo-menu-kb.test.ts
git commit -m "feat(conversation): menu principal, consultas a la KB y cierre"
```

---

### Task 10: Pasos de identificación y verificación

**Files:**
- Create: `backend/src/modules/conversation/domain/steps/identification.ts`
- Create: `backend/src/modules/conversation/domain/steps/verification.ts`
- Create: `backend/tests/dominio/flujo-verificacion.test.ts`

**Interfaces:**
- Consumes: T5 (`drawPair`, `pairUsable`, `isLocked`, `questionById`, `answerMatches`), T8.
- Produces: `idDocumentType`, `idDocumentNumber`, `normalizeDocumentNumber(raw): string`; `verifyQuestion`.

- [ ] **Step 1: Pruebas (fallan)**

```ts
import { describe, expect, it } from "vitest";
import { idDocumentNumber, idDocumentType } from "@/modules/conversation/domain/steps/identification";
import { verifyQuestion } from "@/modules/conversation/domain/steps/verification";
import type { Challenge } from "@/modules/verification/domain/challenge";
import { ctx, fakeReads, keysOf, makeEnv, NOW, okOutcome, opt, text } from "./flujo-support";

const RECORD = { id: "mr-1", birthDate: "1990-03-07", phone: "3001234567", email: null };
const CHALLENGE: Challenge = {
  id: "v1",
  tenantId: "tenant-1",
  medicalRecordId: "mr-1",
  questionIds: ["birth_day", "phone_last_4"],
  failedAttempts: 0,
  lockedUntil: null,
};
const reads = (challenge: Challenge | null = null) =>
  fakeReads({
    findPatient: async (_t, type, number) => (type === "CC" && number === "1020304050" ? RECORD : null),
    getPatient: async (_t, id) => (id === RECORD.id ? RECORD : null),
    challenge: async () => challenge,
  });

describe("flujo: identificacion", () => {
  it("elige tipo y normaliza el numero", async () => {
    const typed = await idDocumentType.handle(opt("doc:CC"), ctx(), makeEnv());
    expect(typed).toMatchObject({ goto: "id_document_number", context: { documentType: "CC" } });
    const handled = await idDocumentNumber.handle(text("1.020.304.050"), typed.context, makeEnv(reads(CHALLENGE)));
    expect(handled.goto).toBe("verify_question");
    expect(handled.context.verification).toEqual({ medicalRecordId: "mr-1", questionIds: CHALLENGE.questionIds, index: 0 });
    expect(handled.effect).toBeUndefined();
  });

  it("un numero invalido repite con su aviso", async () => {
    const handled = await idDocumentNumber.handle(text("12"), ctx({ documentType: "CC" }), makeEnv(reads()));
    expect(keysOf(handled.lines)).toEqual(["id_document_number_invalid"]);
  });

  it("sin desafio sortea y lo abre con un efecto; el par guardado gana", async () => {
    const handled = await idDocumentNumber.handle(text("1020304050"), ctx({ documentType: "CC" }), makeEnv(reads()));
    expect(handled.effect).toMatchObject({ kind: "open_challenge", medicalRecordId: "mr-1" });
    const stored = ["birth_year", "phone_first_3"] as const;
    const next = handled.then?.(okOutcome({ questionIds: stored }));
    expect(next?.context.verification?.questionIds).toEqual(stored);
  });

  it("bloqueado o sin preguntas posibles va al bloqueo con su motivo", async () => {
    const locked = { ...CHALLENGE, failedAttempts: 3, lockedUntil: new Date(NOW.getTime() + 60_000) };
    const blocked = await idDocumentNumber.handle(text("1020304050"), ctx({ documentType: "CC" }), makeEnv(reads(locked)));
    expect(blocked).toMatchObject({ goto: "verification_blocked", context: { handoffReason: "verification_locked" } });
    expect(keysOf(blocked.lines)).toEqual(["verify_locked"]);

    const unusable = { ...CHALLENGE, questionIds: ["email_hint", "birth_day"] as const };
    const unverifiable = await idDocumentNumber.handle(text("1020304050"), ctx({ documentType: "CC" }), makeEnv(reads(unusable)));
    expect(unverifiable.context.handoffReason).toBe("unverifiable");
  });

  it("documento desconocido ofrece el pre-registro", async () => {
    const handled = await idDocumentNumber.handle(text("999999"), ctx({ documentType: "TI" }), makeEnv(reads()));
    expect(handled.goto).toBe("privacy_notice");
    expect(handled.context.preRegistration).toEqual({ documentType: "TI", documentNumber: "999999", field: "given_names" });
    expect(keysOf(handled.lines)).toEqual(["prereg_not_found"]);
  });
});

describe("flujo: verificacion", () => {
  const draft = { medicalRecordId: "mr-1", questionIds: ["birth_day", "phone_last_4"] as const, index: 0 as const };

  it("la primera respuesta solo deja si fue correcta, nunca el valor", async () => {
    const handled = await verifyQuestion.handle(text("07"), ctx({ verification: draft }), makeEnv(reads()));
    expect(handled.context.verification).toEqual({ ...draft, index: 1, firstCorrect: true });
    expect(JSON.stringify(handled.context)).not.toContain("07");
  });

  it("la segunda declara el intento con exito solo si ambas fueron correctas", async () => {
    const second = { ...draft, index: 1 as const, firstCorrect: false };
    const handled = await verifyQuestion.handle(text("4567"), ctx({ verification: second }), makeEnv(reads()));
    expect(handled.effect).toEqual({ kind: "verification_attempt", medicalRecordId: "mr-1", success: false });
  });

  it("traduce el resultado del intento", async () => {
    const second = ctx({ verification: { ...draft, index: 1, firstCorrect: true } });
    const handled = await verifyQuestion.handle(text("4567"), second, makeEnv(reads()));
    const verified = handled.then?.(okOutcome({ verification: { result: "verified", remainingAttempts: 3, lockedUntil: null } }));
    expect(verified).toMatchObject({ goto: "appointments_menu", context: { patientId: "mr-1" } });
    expect(verified?.context.verification).toBeUndefined();

    const failed = handled.then?.(okOutcome({ verification: { result: "failed", remainingAttempts: 2, lockedUntil: null } }));
    expect(failed?.goto).toBe("verify_question");
    expect(failed?.context.verification).toEqual(draft);
    expect(failed?.lines[0]).toEqual({ text: { key: "verify_failed", params: { remaining: "2" } } });

    const until = new Date(NOW.getTime() + 30 * 60_000);
    const locked = handled.then?.(okOutcome({ verification: { result: "locked", remainingAttempts: 0, lockedUntil: until } }));
    expect(locked).toMatchObject({ goto: "verification_blocked", context: { handoffReason: "verification_locked" } });
  });

  it("una pregunta de opciones lista sus opciones con prefijo ans:", async () => {
    const months = { ...draft, questionIds: ["birth_month", "phone_last_4"] as const };
    const entered = await verifyQuestion.enter(ctx({ verification: months }), makeEnv(reads()));
    expect(entered.kind === "prompt" && entered.options).toHaveLength(12);
    expect(entered.kind === "prompt" && entered.options[2]?.value).toBe("ans:3");
    const handled = await verifyQuestion.handle(opt("ans:3"), ctx({ verification: months }), makeEnv(reads()));
    expect(handled.context.verification?.firstCorrect).toBe(true);
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-verificacion.test.ts` → FAIL.

- [ ] **Step 2: `steps/identification.ts`**

```ts
import { isLocked } from "@/modules/verification/domain/challenge";
import { drawPair, pairUsable, type QuestionPair } from "@/modules/verification/domain/draw";
import type { VerifiableRecord } from "@/modules/verification/domain/questions";
import { DOCUMENT_TYPES, type DocumentType, isDocumentType } from "../document";
import { formatWhen } from "../format";
import { choice, go, optionValue, prompt, resetFlow, retry } from "../step-kit";
import { type BotLine, type ConversationTextKey, line, t } from "../text";
import type { ConversationContext, HandleResult, HandoffReason, StepEnv, Step } from "../types";

const DOC_LABEL: Record<DocumentType, ConversationTextKey> = {
  CC: "doc_type_cc",
  TI: "doc_type_ti",
  CE: "doc_type_ce",
  PA: "doc_type_pa",
  RC: "doc_type_rc",
};
const DOCUMENT_NUMBER = /^[A-Z0-9]{3,20}$/;

export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

export const idDocumentType: Step = {
  id: "id_document_type",
  globals: "full",
  echo: "label",
  async enter(context) {
    const options = DOCUMENT_TYPES.map((type) => choice(`doc:${type}`, t(DOC_LABEL[type])));
    return prompt(context, [line("id_document_type_prompt")], options);
  },
  async handle(input, context) {
    const type = optionValue(input, "doc:");
    if (type === null || !isDocumentType(type)) {
      return retry("id_document_type", context);
    }
    return go("id_document_number", { ...context, documentType: type });
  },
};

export const idDocumentNumber: Step = {
  id: "id_document_number",
  globals: "full",
  echo: "document",
  async enter(context) {
    return prompt(context, [line("id_document_number_prompt")], [], "text");
  },
  async handle(input, context, env) {
    const documentType = context.documentType;
    if (!documentType) {
      return go("id_document_type", context);
    }
    if (input.kind !== "text") {
      return retry("id_document_number", context);
    }
    const documentNumber = normalizeDocumentNumber(input.text);
    if (!DOCUMENT_NUMBER.test(documentNumber)) {
      return retry("id_document_number", context, "id_document_number_invalid");
    }
    const record = await env.reads.findPatient(env.tenantId, documentType, documentNumber);
    if (!record) {
      const preRegistration = { documentType, documentNumber, field: "given_names" as const };
      return go("privacy_notice", { ...context, preRegistration }, [line("prereg_not_found")]);
    }
    return startVerification(record, context, env);
  },
};

function blocked(
  context: ConversationContext,
  reason: HandoffReason,
  lines: readonly BotLine[],
): HandleResult {
  return go("verification_blocked", { ...resetFlow(context), handoffReason: reason }, lines);
}

function verifying(
  context: ConversationContext,
  medicalRecordId: string,
  questionIds: QuestionPair,
): HandleResult {
  const verification = { medicalRecordId, questionIds, index: 0 as const };
  return go("verify_question", { ...context, verification }, [line("verify_intro")]);
}

/**
 * Par guardado si existe (par fijo); si no, uno sorteado que se guarda con `open_challenge`
 * antes de preguntar (refinamiento 3). Un par guardado que ya no aplica deriva a un asesor.
 */
async function startVerification(
  record: VerifiableRecord,
  context: ConversationContext,
  env: StepEnv,
): Promise<HandleResult> {
  const challenge = await env.reads.challenge(env.tenantId, record.id);
  if (challenge?.lockedUntil && isLocked(challenge, env.now)) {
    const until = formatWhen(challenge.lockedUntil, env.timeZone);
    return blocked(context, "verification_locked", [line("verify_locked", { until })]);
  }
  if (challenge) {
    return pairUsable(challenge.questionIds, record)
      ? verifying(context, record.id, challenge.questionIds)
      : blocked(context, "unverifiable", [line("verify_unverifiable")]);
  }
  const drawn = drawPair(record, env.random);
  if (!drawn) {
    return blocked(context, "unverifiable", [line("verify_unverifiable")]);
  }
  return {
    ...verifying(context, record.id, drawn),
    effect: { kind: "open_challenge", medicalRecordId: record.id, questionIds: drawn },
    then: (outcome) =>
      verifying(context, record.id, (outcome.ok && outcome.questionIds) || drawn),
  };
}
```

- [ ] **Step 3: `steps/verification.ts`**

```ts
import { answerMatches, questionById } from "@/modules/verification/domain/questions";
import { formatWhen } from "../format";
import { choice, go, optionValue, prompt, redirect, resetFlow } from "../step-kit";
import { type ConversationTextKey, line, literal } from "../text";
import type {
  ConversationContext,
  EffectOutcome,
  HandleResult,
  Step,
  StepEnv,
  VerificationDraft,
} from "../types";

/**
 * Pregunta de seguridad (una por turno). La respuesta se compara en memoria y se descarta:
 * el contexto solo guarda si la primera fue correcta (refinamiento 3, GOBERNANZA §1.5).
 */
export const verifyQuestion: Step = {
  id: "verify_question",
  globals: "cancel_only",
  echo: "redacted",
  async enter(context, env) {
    const draft = context.verification;
    const question = draft ? questionById(draft.questionIds[draft.index]) : null;
    if (!draft || !question) {
      return redirect("main_menu", resetFlow(context), [line("generic_error")]);
    }
    const ask = [line(question.textKey as ConversationTextKey)];
    if (question.input === "text") {
      return prompt(context, ask, [], "text");
    }
    const record = await env.reads.getPatient(env.tenantId, draft.medicalRecordId);
    const options = record && question.options ? question.options(record) : [];
    return prompt(context, ask, options.map((o) => choice(`ans:${o.value}`, literal(o.label))));
  },
  async handle(input, context, env) {
    const draft = context.verification;
    const record = draft ? await env.reads.getPatient(env.tenantId, draft.medicalRecordId) : null;
    if (!draft || !record) {
      return go("main_menu", resetFlow(context), [line("generic_error")]);
    }
    const answer = input.kind === "text" ? input.text : (optionValue(input, "ans:") ?? "");
    const correct = answerMatches(draft.questionIds[draft.index], record, answer);
    if (draft.index === 0) {
      return go("verify_question", {
        ...context,
        verification: { ...draft, index: 1, firstCorrect: correct },
      });
    }
    return attempt(draft, draft.firstCorrect === true && correct, context, env);
  },
};

function attempt(
  draft: VerificationDraft,
  success: boolean,
  context: ConversationContext,
  env: StepEnv,
): HandleResult {
  return {
    goto: "verify_question",
    context,
    lines: [],
    effect: { kind: "verification_attempt", medicalRecordId: draft.medicalRecordId, success },
    then: (outcome) => afterAttempt(outcome, draft, context, env),
  };
}

function afterAttempt(
  outcome: EffectOutcome,
  draft: VerificationDraft,
  context: ConversationContext,
  env: StepEnv,
): HandleResult {
  const result = outcome.ok ? outcome.verification : undefined;
  if (result?.result === "verified") {
    const verified = { ...resetFlow(context), patientId: draft.medicalRecordId };
    return go("appointments_menu", verified, [line("verify_success")]);
  }
  if (result?.result === "failed") {
    const verification = { medicalRecordId: draft.medicalRecordId, questionIds: draft.questionIds, index: 0 as const };
    const remaining = String(result.remainingAttempts);
    return go("verify_question", { ...context, verification }, [line("verify_failed", { remaining })]);
  }
  if (result?.result === "locked" && result.lockedUntil) {
    const until = formatWhen(result.lockedUntil, env.timeZone);
    const blocked = { ...resetFlow(context), handoffReason: "verification_locked" as const };
    return go("verification_blocked", blocked, [line("verify_locked", { until })]);
  }
  return go("main_menu", resetFlow(context), [line("generic_error")]);
}
```

- [ ] **Step 4: Correr pruebas y commit**

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-verificacion.test.ts tests/fronteras.test.ts` → PASS.

```bash
git add backend/src/modules/conversation/domain/steps/identification.ts backend/src/modules/conversation/domain/steps/verification.ts backend/tests/dominio/flujo-verificacion.test.ts
git commit -m "feat(conversation): identificacion y verificacion con par fijo y bloqueo"
```

---

### Task 11: Pasos del pre-registro

**Files:**
- Create: `backend/src/modules/conversation/domain/pre-registration-fields.ts`
- Create: `backend/src/modules/conversation/domain/steps/pre-registration.ts`
- Create: `backend/tests/dominio/flujo-pre-registro.test.ts`

**Interfaces:**
- Consumes: T8.
- Produces: `PREREG_FIELDS`, `nextField(field): PreRegField | null`, `parseField(field, raw, today): string | null`; `privacyNotice`, `preregField`, `preregConfirm`, `completeDraft(draft?): PreRegistrationPayload | null`.

- [ ] **Step 1: Pruebas (fallan)**

```ts
import { describe, expect, it } from "vitest";
import { parseField } from "@/modules/conversation/domain/pre-registration-fields";
import {
  preregConfirm,
  preregField,
  privacyNotice,
} from "@/modules/conversation/domain/steps/pre-registration";
import type { PreRegistrationDraft } from "@/modules/conversation/domain/types";
import { ctx, keysOf, makeEnv, okOutcome, opt, text } from "./flujo-support";

const START: PreRegistrationDraft = { documentType: "CC", documentNumber: "99887766", field: "given_names" };
const FULL: PreRegistrationDraft = {
  ...START,
  field: "email",
  givenNames: "Ana",
  familyNames: "Paz",
  birthDate: "1990-03-07",
  phone: "3001234567",
  email: null,
};

describe("flujo: pre-registro", () => {
  it("sin aceptar el aviso de datos vuelve al menu y descarta el borrador", async () => {
    const declined = await privacyNotice.handle(opt("privacy:decline"), ctx({ preRegistration: START }), makeEnv());
    expect(declined.goto).toBe("main_menu");
    expect(declined.context.preRegistration).toBeUndefined();
    expect(keysOf(declined.lines)).toEqual(["privacy_declined"]);
    const accepted = await privacyNotice.handle(opt("privacy:accept"), ctx({ preRegistration: START }), makeEnv());
    expect(accepted.goto).toBe("prereg_field");
  });

  it("pide los campos en orden y valida cada uno", async () => {
    let context = ctx({ preRegistration: START });
    for (const value of ["Ana", "Paz", "1990-03-07", "300 123 4567"]) {
      const handled = await preregField.handle(text(value), context, makeEnv());
      expect(handled.goto).toBe("prereg_field");
      context = handled.context;
    }
    expect(context.preRegistration).toMatchObject({ field: "email", phone: "3001234567" });
    const skipped = await preregField.handle(opt("prereg:skip"), context, makeEnv());
    expect(skipped).toMatchObject({ goto: "prereg_confirm", context: { preRegistration: { email: null } } });
    const invalid = await preregField.handle(text("2099-01-01"), ctx({ preRegistration: { ...START, field: "birth_date" } }), makeEnv());
    expect(keysOf(invalid.lines)).toEqual(["prereg_invalid"]);
  });

  it("la fecha de nacimiento pide input date y el correo ofrece Omitir", async () => {
    const date = await preregField.enter(ctx({ preRegistration: { ...START, field: "birth_date" } }), makeEnv());
    expect(date.kind === "prompt" && date.input).toBe("date");
    const email = await preregField.enter(ctx({ preRegistration: { ...START, field: "email" } }), makeEnv());
    expect(email.kind === "prompt" && email.options.map((o) => o.value)).toEqual(["prereg:skip"]);
  });

  it("el resumen va redactado y confirmar declara el pre-registro", async () => {
    const entered = await preregConfirm.enter(ctx({ preRegistration: FULL }), makeEnv());
    expect(entered.lines[0]?.redacted).toBe(true);
    const handled = await preregConfirm.handle(opt("prereg:confirm"), ctx({ preRegistration: FULL }), makeEnv());
    expect(handled.effect).toEqual({
      kind: "pre_register",
      data: {
        documentType: "CC",
        documentNumber: "99887766",
        givenNames: "Ana",
        familyNames: "Paz",
        birthDate: "1990-03-07",
        phone: "3001234567",
        email: null,
      },
    });
    const done = handled.then?.(okOutcome({ medicalRecordId: "mr-new" }));
    expect(done).toMatchObject({ goto: "appointments_menu", context: { patientId: "mr-new" } });
    expect(done?.context.preRegistration).toBeUndefined();
    const taken = handled.then?.({ ok: false, failure: "document_taken" });
    expect(taken?.goto).toBe("id_document_type");
  });

  it("valida los campos para la UX", () => {
    expect(parseField("given_names", "  Ana   María ", "2026-10-05")).toBe("Ana María");
    expect(parseField("phone", "+57 300 123 4567", "2026-10-05")).toBe("3001234567");
    expect(parseField("phone", "6011234567", "2026-10-05")).toBeNull();
    expect(parseField("birth_date", "1990-02-30", "2026-10-05")).toBeNull();
    expect(parseField("email", "Ana@Correo.com", "2026-10-05")).toBe("ana@correo.com");
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-pre-registro.test.ts` → FAIL.

- [ ] **Step 2: `pre-registration-fields.ts`**

```ts
import type { PreRegField } from "./types";

/**
 * Validacion campo a campo para la UX del chat. La autoritativa es la de patients
 * (refinamiento 14); si cambian las reglas, cambian en ambos lados.
 */
export const PREREG_FIELDS: readonly PreRegField[] = [
  "given_names",
  "family_names",
  "birth_date",
  "phone",
  "email",
];

const NAME = /^[\p{L}][\p{L}' -]{0,99}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE = /^3\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function nextField(field: PreRegField): PreRegField | null {
  return PREREG_FIELDS[PREREG_FIELDS.indexOf(field) + 1] ?? null;
}

function parseName(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  return NAME.test(value) ? value : null;
}

function parseDate(raw: string, today: string): string | null {
  const value = raw.trim();
  if (!DATE.test(value) || value > today || value < "1900-01-01") {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : null;
}

function parsePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
  return MOBILE.test(national) ? national : null;
}

function parseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return EMAIL.test(value) && value.length <= 254 ? value : null;
}

/** Valor normalizado del campo, o `null` si no es valido. */
export function parseField(field: PreRegField, raw: string, today: string): string | null {
  switch (field) {
    case "given_names":
    case "family_names":
      return parseName(raw);
    case "birth_date":
      return parseDate(raw, today);
    case "phone":
      return parsePhone(raw);
    case "email":
      return parseEmail(raw);
  }
}
```

- [ ] **Step 3: `steps/pre-registration.ts`**

```ts
import { localDate } from "../format";
import { nextField, parseField } from "../pre-registration-fields";
import { choice, go, isOption, prompt, redirect, resetFlow, retry } from "../step-kit";
import { type ConversationTextKey, line, t } from "../text";
import type {
  ConversationContext,
  EffectOutcome,
  HandleResult,
  PatientInput,
  PreRegField,
  PreRegistrationDraft,
  PreRegistrationPayload,
  Step,
} from "../types";

const PROMPT: Record<PreRegField, ConversationTextKey> = {
  given_names: "prereg_given_names_prompt",
  family_names: "prereg_family_names_prompt",
  birth_date: "prereg_birth_date_prompt",
  phone: "prereg_phone_prompt",
  email: "prereg_email_prompt",
};

const DRAFT_KEY = {
  given_names: "givenNames",
  family_names: "familyNames",
  birth_date: "birthDate",
  phone: "phone",
  email: "email",
} as const satisfies Record<PreRegField, keyof PreRegistrationDraft>;

export const privacyNotice: Step = {
  id: "privacy_notice",
  globals: "full",
  echo: "label",
  async enter(context) {
    const options = [choice("privacy:accept", t("option_accept")), choice("privacy:decline", t("option_decline"))];
    return prompt(context, [line("privacy_notice")], options);
  },
  async handle(input, context) {
    const draft = context.preRegistration;
    if (!draft) {
      return go("main_menu", resetFlow(context));
    }
    if (isOption(input, "privacy:accept")) {
      return go("prereg_field", { ...context, preRegistration: { ...draft, field: "given_names" } });
    }
    if (isOption(input, "privacy:decline")) {
      return go("main_menu", resetFlow(context), [line("privacy_declined")]);
    }
    return retry("privacy_notice", context);
  },
};

/** Valor del campo; `undefined` si es invalido. El correo admite Omitir (`null`). */
function valueFor(field: PreRegField, input: PatientInput, today: string): string | null | undefined {
  if (field === "email" && isOption(input, "prereg:skip")) {
    return null;
  }
  if (input.kind !== "text") {
    return undefined;
  }
  return parseField(field, input.text, today) ?? undefined;
}

export const preregField: Step = {
  id: "prereg_field",
  globals: "full",
  echo: "redacted",
  async enter(context) {
    const draft = context.preRegistration;
    if (!draft) {
      return redirect("main_menu", resetFlow(context));
    }
    const options = draft.field === "email" ? [choice("prereg:skip", t("option_skip"))] : [];
    const input = draft.field === "birth_date" ? "date" : "text";
    return prompt(context, [line(PROMPT[draft.field])], options, input);
  },
  async handle(input, context, env) {
    const draft = context.preRegistration;
    if (!draft) {
      return go("main_menu", resetFlow(context));
    }
    const value = valueFor(draft.field, input, localDate(env.now, env.timeZone));
    if (value === undefined) {
      return retry("prereg_field", context, "prereg_invalid");
    }
    const next = nextField(draft.field);
    const updated = { ...draft, [DRAFT_KEY[draft.field]]: value, field: next ?? draft.field };
    return go(next ? "prereg_field" : "prereg_confirm", { ...context, preRegistration: updated });
  },
};

export function completeDraft(draft?: PreRegistrationDraft): PreRegistrationPayload | null {
  if (!draft?.givenNames || !draft.familyNames || !draft.birthDate || !draft.phone) {
    return null;
  }
  if (draft.email === undefined) {
    return null;
  }
  return {
    documentType: draft.documentType,
    documentNumber: draft.documentNumber,
    givenNames: draft.givenNames,
    familyNames: draft.familyNames,
    birthDate: draft.birthDate,
    phone: draft.phone,
    email: draft.email,
  };
}

function afterPreRegister(outcome: EffectOutcome, context: ConversationContext): HandleResult {
  if (outcome.ok && outcome.medicalRecordId) {
    const verified = { ...resetFlow(context), patientId: outcome.medicalRecordId };
    return go("appointments_menu", verified, [line("prereg_done")]);
  }
  if (!outcome.ok && outcome.failure === "document_taken") {
    return go("id_document_type", resetFlow(context), [line("prereg_document_taken")]);
  }
  return go("main_menu", resetFlow(context), [line("generic_error")]);
}

/** Resumen con datos personales: linea redactada en el historial (refinamiento 5). */
export const preregConfirm: Step = {
  id: "prereg_confirm",
  globals: "full",
  echo: "label",
  async enter(context) {
    const data = completeDraft(context.preRegistration);
    if (!data) {
      return redirect("main_menu", resetFlow(context), [line("generic_error")]);
    }
    const summary = line(
      "prereg_confirm_prompt",
      {
        given_names: data.givenNames,
        family_names: data.familyNames,
        birth_date: data.birthDate,
        phone: data.phone,
        email: data.email ?? "—",
      },
      true,
    );
    const options = [choice("prereg:confirm", t("option_confirm")), choice("prereg:restart", t("option_restart"))];
    return prompt(context, [summary], options);
  },
  async handle(input, context) {
    const draft = context.preRegistration;
    const data = completeDraft(draft);
    if (!draft || !data) {
      return go("main_menu", resetFlow(context));
    }
    if (isOption(input, "prereg:restart")) {
      return go("prereg_field", { ...context, preRegistration: { ...draft, field: "given_names" } });
    }
    if (!isOption(input, "prereg:confirm")) {
      return retry("prereg_confirm", context);
    }
    return {
      goto: "prereg_confirm",
      context,
      lines: [],
      effect: { kind: "pre_register", data },
      then: (outcome) => afterPreRegister(outcome, context),
    };
  },
};
```

- [ ] **Step 4: Correr pruebas y commit**

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-pre-registro.test.ts` → PASS.

```bash
git add backend/src/modules/conversation/domain/pre-registration-fields.ts backend/src/modules/conversation/domain/steps/pre-registration.ts backend/tests/dominio/flujo-pre-registro.test.ts
git commit -m "feat(conversation): pre-registro con aviso de datos y resumen redactado"
```

---

### Task 12: Pasos de citas (agendar, reprogramar, cancelar) y registro de pasos

**Files:**
- Create: `backend/src/modules/conversation/domain/steps/appointments.ts`
- Create: `backend/src/modules/conversation/domain/steps/booking.ts`
- Create: `backend/src/modules/conversation/domain/steps/index.ts`
- Create: `backend/tests/dominio/flujo-citas.test.ts`
- Create: `backend/tests/dominio/flujo-recorrido.test.ts`

**Interfaces:**
- Consumes: T8–T11.
- Produces: `appointmentsMenu`, `pickAppointment`, `cancelConfirm`, `failureLines(outcome)` (en `appointments.ts`); `bookService`, `bookPractitioner`, `bookDay`, `bookSlot`, `bookConfirm` (en `booking.ts`); `STEPS: StepRegistry` (en `steps/index.ts`).

- [ ] **Step 1: Pruebas de pasos (fallan)**

`backend/tests/dominio/flujo-citas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatLocalDay } from "@/modules/conversation/domain/format";
import { appointmentsMenu, cancelConfirm, pickAppointment } from "@/modules/conversation/domain/steps/appointments";
import { bookConfirm, bookDay, bookPractitioner, bookSlot } from "@/modules/conversation/domain/steps/booking";
import type { AvailableSlot } from "@/modules/conversation/domain/reads";
import { ctx, fakeReads, keysOf, makeEnv, NOW, okOutcome, opt, TZ } from "./flujo-support";

const HOUR = 3_600_000;
const slot = (id: string, hoursFromNow: number): AvailableSlot => ({
  id,
  startAt: new Date(NOW.getTime() + hoursFromNow * HOUR),
  serviceName: "Medicina general",
  practitionerName: "Dra. Ruiz",
});
// Lunes 08:00 Bogota: +1h y +2h el lunes, +25h el martes, +49h el miercoles.
const SLOTS = [slot("s1", 1), slot("s2", 2), slot("s3", 25), slot("s4", 49)];
const APPOINTMENT = {
  id: "ap1",
  startAt: new Date(NOW.getTime() + 72 * HOUR),
  serviceId: "svc1",
  serviceName: "Medicina general",
  practitionerName: "Dra. Ruiz",
};
const reads = fakeReads({
  listPractitioners: async () => [{ id: "p1", name: "Dra. Ruiz" }],
  listAvailableSlots: async (_t, f) => SLOTS.filter((s) => s.startAt >= f.from && s.startAt < f.to),
  listUpcomingAppointments: async () => [APPOINTMENT],
});
const env = makeEnv(reads);
const booking = { kind: "book" as const, serviceId: "svc1", practitionerId: null, dayOffset: 0 };

describe("flujo: citas", () => {
  it("el submenu exige paciente verificado", async () => {
    expect(await appointmentsMenu.enter(ctx(), env)).toMatchObject({ kind: "goto", goto: "id_document_type" });
    const handled = await appointmentsMenu.handle(opt("appt:book"), ctx({ patientId: "mr" }), env);
    expect(handled).toMatchObject({ goto: "book_service", context: { booking: { kind: "book" } } });
  });

  it("profesional: lista y Cualquiera", async () => {
    const entered = await bookPractitioner.enter(ctx({ booking: { kind: "book", serviceId: "svc1" } }), env);
    expect(entered.kind === "prompt" && entered.options.map((o) => o.value)).toEqual(["prac:p1", "prac:any"]);
    const any = await bookPractitioner.handle(opt("prac:any"), ctx({ booking: { kind: "book", serviceId: "svc1" } }), env);
    expect(any.context.booking).toMatchObject({ practitionerId: null, dayOffset: 0 });
  });

  it("dias con cupo, en orden y con su etiqueta local", async () => {
    const entered = await bookDay.enter(ctx({ booking }), env);
    expect(entered.kind === "prompt" && entered.options.map((o) => o.value)).toEqual([
      "day:2026-10-05",
      "day:2026-10-06",
      "day:2026-10-07",
    ]);
    expect(entered.kind === "prompt" && entered.options[0]?.label).toEqual({
      literal: formatLocalDay("2026-10-05", TZ),
    });
  });

  it("sin cupos vuelve al submenu con aviso", async () => {
    const empty = makeEnv(fakeReads());
    const entered = await bookDay.enter(ctx({ booking }), empty);
    expect(entered).toMatchObject({ kind: "goto", goto: "appointments_menu" });
    expect(keysOf(entered.lines)).toEqual(["book_no_days"]);
  });

  it("horas del dia elegido y confirmacion con datos de dominio", async () => {
    const withDay = ctx({ patientId: "mr", booking: { ...booking, day: "2026-10-05", slotOffset: 0 } });
    const hours = await bookSlot.enter(withDay, env);
    expect(hours.kind === "prompt" && hours.options.map((o) => o.value)).toEqual(["slot:s1", "slot:s2"]);
    const chosen = await bookSlot.handle(opt("slot:s2"), withDay, env);
    const confirm = await bookConfirm.enter(chosen.context, env);
    expect(confirm.kind === "prompt" && confirm.lines[0]?.text).toMatchObject({
      key: "book_confirm_prompt",
      params: { service: "Medicina general", practitioner: "Dra. Ruiz" },
    });
    const handled = await bookConfirm.handle(opt("book:confirm"), chosen.context, env);
    expect(handled.effect).toEqual({ kind: "request_appointment", medicalRecordId: "mr", command: { kind: "book", slotId: "s2" } });
    const created = handled.then?.(okOutcome({ expiresAt: new Date(NOW.getTime() + 4 * HOUR) }));
    expect(created?.goto).toBe("appointments_menu");
    expect(keysOf(created?.lines ?? [])).toEqual(["request_created"]);
    const taken = handled.then?.({ ok: false, failure: "slot_unavailable" });
    expect(taken?.goto).toBe("book_slot");
    expect(taken?.context.booking?.slotId).toBeUndefined();
    const capped = handled.then?.({ ok: false, failure: "pending_limit_reached", max: 2 });
    expect(capped?.lines[0]).toEqual({ text: { key: "pending_limit", params: { max: "2" } } });
  });

  it("reprogramar parte de la cita elegida con su servicio", async () => {
    const context = ctx({ patientId: "mr", booking: { kind: "reschedule" } });
    const handled = await pickAppointment.handle(opt("pick:ap1"), context, env);
    expect(handled).toMatchObject({
      goto: "book_day",
      context: { booking: { kind: "reschedule", appointmentId: "ap1", serviceId: "svc1", practitionerId: null } },
    });
  });

  it("cancelar declara la solicitud de cancelacion", async () => {
    const context = ctx({ patientId: "mr", booking: { kind: "cancel", appointmentId: "ap1" } });
    const entered = await cancelConfirm.enter(context, env);
    expect(entered.kind === "prompt" && entered.lines[0]?.text).toMatchObject({ key: "cancel_confirm_prompt" });
    const handled = await cancelConfirm.handle(opt("cancel:confirm"), context, env);
    expect(handled.effect).toEqual({ kind: "request_appointment", medicalRecordId: "mr", command: { kind: "cancel", appointmentId: "ap1" } });
    const pending = handled.then?.({ ok: false, failure: "appointment_change_pending" });
    expect(keysOf(pending?.lines ?? [])).toEqual(["change_pending"]);
  });
});
```

- [ ] **Step 2: `steps/appointments.ts`**

```ts
import { formatWhen } from "../format";
import type { UpcomingAppointment } from "../reads";
import { choice, go, isOption, optionValue, prompt, redirect, resetFlow, retry } from "../step-kit";
import { type BotLine, line, literal, t } from "../text";
import type { ConversationContext, EffectOutcome, HandleResult, Step, StepEnv } from "../types";

const MAX_APPOINTMENTS = 10;

/** Traduce el fallo de una solicitud al mensaje del bot (sin codigos nuevos, §2). */
export function failureLines(outcome: EffectOutcome): BotLine[] {
  if (outcome.ok) {
    return [];
  }
  switch (outcome.failure) {
    case "slot_unavailable":
      return [line("slot_taken")];
    case "pending_limit_reached":
      return [line("pending_limit", { max: String(outcome.max ?? "") })];
    case "appointment_change_pending":
      return [line("change_pending")];
    case "not_available":
      return [line("appointment_unavailable")];
    case "document_taken":
      return [line("generic_error")];
  }
}

export const appointmentsMenu: Step = {
  id: "appointments_menu",
  globals: "full",
  echo: "label",
  async enter(context) {
    if (!context.patientId) {
      return redirect("id_document_type", resetFlow(context));
    }
    const options = [
      choice("appt:book", t("option_book")),
      choice("appt:reschedule", t("option_reschedule")),
      choice("appt:cancel", t("option_cancel_appointment")),
    ];
    return prompt(resetFlow(context), [line("appointments_menu_prompt")], options);
  },
  async handle(input, context) {
    if (isOption(input, "appt:book")) {
      return go("book_service", { ...context, booking: { kind: "book" } });
    }
    if (isOption(input, "appt:reschedule")) {
      return go("pick_appointment", { ...context, booking: { kind: "reschedule" } });
    }
    if (isOption(input, "appt:cancel")) {
      return go("pick_appointment", { ...context, booking: { kind: "cancel" } });
    }
    return retry("appointments_menu", context);
  },
};

function appointmentLabel(appointment: UpcomingAppointment, timeZone: string): string {
  return `${formatWhen(appointment.startAt, timeZone)} · ${appointment.serviceName} · ${appointment.practitionerName}`;
}

async function upcoming(context: ConversationContext, env: StepEnv): Promise<UpcomingAppointment[]> {
  return context.patientId
    ? env.reads.listUpcomingAppointments(env.tenantId, context.patientId, env.now)
    : [];
}

export const pickAppointment: Step = {
  id: "pick_appointment",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const list = (await upcoming(context, env)).slice(0, MAX_APPOINTMENTS);
    if (list.length === 0) {
      return redirect("appointments_menu", context, [line("no_upcoming_appointments")]);
    }
    const options = list.map((a) => choice(`pick:${a.id}`, literal(appointmentLabel(a, env.timeZone))));
    return prompt(context, [line("pick_appointment_prompt")], options);
  },
  async handle(input, context, env) {
    const id = optionValue(input, "pick:");
    const kind = context.booking?.kind;
    if (id === null || !kind) {
      return retry("pick_appointment", context);
    }
    const found = (await upcoming(context, env)).find((a) => a.id === id);
    if (!found) {
      return go("appointments_menu", context, [line("appointment_unavailable")]);
    }
    if (kind === "cancel") {
      return go("cancel_confirm", { ...context, booking: { kind, appointmentId: id } });
    }
    const booking = { kind: "reschedule" as const, appointmentId: id, serviceId: found.serviceId, practitionerId: null, dayOffset: 0 };
    return go("book_day", { ...context, booking });
  },
};

export const cancelConfirm: Step = {
  id: "cancel_confirm",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const appointmentId = context.booking?.appointmentId;
    const found = (await upcoming(context, env)).find((a) => a.id === appointmentId);
    if (!found) {
      return redirect("appointments_menu", context, [line("appointment_unavailable")]);
    }
    const when = formatWhen(found.startAt, env.timeZone);
    return prompt(context, [line("cancel_confirm_prompt", { when })], [choice("cancel:confirm", t("option_confirm"))]);
  },
  async handle(input, context) {
    const appointmentId = context.booking?.appointmentId;
    if (!isOption(input, "cancel:confirm") || !appointmentId || !context.patientId) {
      return retry("cancel_confirm", context);
    }
    return {
      goto: "cancel_confirm",
      context,
      lines: [],
      effect: {
        kind: "request_appointment",
        medicalRecordId: context.patientId,
        command: { kind: "cancel", appointmentId },
      },
      then: (outcome): HandleResult =>
        go("appointments_menu", context, outcome.ok ? [line("cancel_request_created")] : failureLines(outcome)),
    };
  },
};
```

- [ ] **Step 3: `steps/booking.ts`**

```ts
import { dayBounds, formatLocalDay, formatTime, formatWhen, localDate } from "../format";
import type { AvailableSlot } from "../reads";
import { choice, go, isOption, optionValue, prompt, redirect, retry } from "../step-kit";
import { line, literal, t } from "../text";
import type {
  AppointmentCommand,
  BookingDraft,
  ConversationContext,
  EffectOutcome,
  HandleResult,
  Step,
  StepEnv,
} from "../types";
import { failureLines } from "./appointments";

const DAYS_PER_PAGE = 5;
const SLOTS_PER_PAGE = 6;
const HORIZON_DAYS = 30;
const SLOT_LIMIT = 200;
const DAY_MS = 86_400_000;

function slotsBetween(booking: BookingDraft, env: StepEnv, from: Date, to: Date): Promise<AvailableSlot[]> {
  if (!booking.serviceId) {
    return Promise.resolve([]);
  }
  return env.reads.listAvailableSlots(env.tenantId, {
    serviceId: booking.serviceId,
    practitionerId: booking.practitionerId ?? null,
    from,
    to,
    limit: SLOT_LIMIT,
  });
}

function slotsOfDay(booking: BookingDraft, env: StepEnv): Promise<AvailableSlot[]> {
  if (!booking.day) {
    return Promise.resolve([]);
  }
  const bounds = dayBounds(booking.day, env.timeZone);
  const from = bounds.from > env.now ? bounds.from : env.now;
  return slotsBetween(booking, env, from, bounds.to);
}

function withBooking(context: ConversationContext, booking: BookingDraft): ConversationContext {
  return { ...context, booking };
}

export const bookService: Step = {
  id: "book_service",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const services = await env.reads.listServices(env.tenantId);
    if (services.length === 0) {
      return redirect("appointments_menu", context, [line("book_no_services")]);
    }
    const options = services.map((s) => choice(`svc:${s.id}`, literal(s.name)));
    return prompt(context, [line("book_service_prompt")], options);
  },
  async handle(input, context) {
    const serviceId = optionValue(input, "svc:");
    if (serviceId === null || !context.booking) {
      return retry("book_service", context);
    }
    return go("book_practitioner", withBooking(context, { ...context.booking, serviceId }));
  },
};

export const bookPractitioner: Step = {
  id: "book_practitioner",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const serviceId = context.booking?.serviceId;
    if (!serviceId) {
      return redirect("book_service", context);
    }
    const list = await env.reads.listPractitioners(env.tenantId, serviceId);
    const options = [
      ...list.map((p) => choice(`prac:${p.id}`, literal(p.name))),
      choice("prac:any", t("option_any_practitioner")),
    ];
    return prompt(context, [line("book_practitioner_prompt")], options);
  },
  async handle(input, context) {
    const id = optionValue(input, "prac:");
    if (id === null || !context.booking) {
      return retry("book_practitioner", context);
    }
    const practitionerId = id === "any" ? null : id;
    return go("book_day", withBooking(context, { ...context.booking, practitionerId, dayOffset: 0 }));
  },
};

export const bookDay: Step = {
  id: "book_day",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const booking = context.booking;
    if (!booking) {
      return redirect("appointments_menu", context);
    }
    const horizon = new Date(env.now.getTime() + HORIZON_DAYS * DAY_MS);
    const slots = await slotsBetween(booking, env, env.now, horizon);
    const days = [...new Set(slots.map((s) => localDate(s.startAt, env.timeZone)))].sort();
    const offset = booking.dayOffset ?? 0;
    const page = days.slice(offset, offset + DAYS_PER_PAGE);
    if (page.length === 0) {
      return redirect("appointments_menu", context, [line("book_no_days")]);
    }
    const more = days.length > offset + DAYS_PER_PAGE ? [choice("day:more", t("option_more"))] : [];
    const options = page.map((d) => choice(`day:${d}`, literal(formatLocalDay(d, env.timeZone))));
    return prompt(context, [line("book_day_prompt")], [...options, ...more]);
  },
  async handle(input, context) {
    const booking = context.booking;
    const day = optionValue(input, "day:");
    if (!booking || day === null) {
      return retry("book_day", context);
    }
    if (day === "more") {
      const dayOffset = (booking.dayOffset ?? 0) + DAYS_PER_PAGE;
      return go("book_day", withBooking(context, { ...booking, dayOffset }));
    }
    return go("book_slot", withBooking(context, { ...booking, day, slotOffset: 0 }));
  },
};

export const bookSlot: Step = {
  id: "book_slot",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const booking = context.booking;
    if (!booking?.day) {
      return redirect("book_day", context);
    }
    const slots = await slotsOfDay(booking, env);
    const offset = booking.slotOffset ?? 0;
    const page = slots.slice(offset, offset + SLOTS_PER_PAGE);
    if (page.length === 0) {
      return redirect("book_day", withBooking(context, { ...booking, dayOffset: 0 }), [line("slot_taken")]);
    }
    const more = slots.length > offset + SLOTS_PER_PAGE ? [choice("slot:more", t("option_more"))] : [];
    const options = page.map((s) =>
      choice(`slot:${s.id}`, literal(`${formatTime(s.startAt, env.timeZone)} · ${s.practitionerName}`)),
    );
    return prompt(context, [line("book_slot_prompt")], [...options, ...more]);
  },
  async handle(input, context) {
    const booking = context.booking;
    const slotId = optionValue(input, "slot:");
    if (!booking || slotId === null) {
      return retry("book_slot", context);
    }
    if (slotId === "more") {
      const slotOffset = (booking.slotOffset ?? 0) + SLOTS_PER_PAGE;
      return go("book_slot", withBooking(context, { ...booking, slotOffset }));
    }
    return go("book_confirm", withBooking(context, { ...booking, slotId }));
  },
};

function commandOf(booking: BookingDraft | undefined): AppointmentCommand | null {
  if (!booking?.slotId) {
    return null;
  }
  if (booking.kind === "book") {
    return { kind: "book", slotId: booking.slotId };
  }
  if (booking.kind === "reschedule" && booking.appointmentId) {
    return { kind: "reschedule", appointmentId: booking.appointmentId, slotId: booking.slotId };
  }
  return null;
}

function withoutSlot(booking: BookingDraft): BookingDraft {
  const { slotId: _slotId, ...rest } = booking;
  return rest;
}

function afterRequest(outcome: EffectOutcome, context: ConversationContext, env: StepEnv): HandleResult {
  if (outcome.ok) {
    const holdUntil = formatWhen(outcome.expiresAt ?? env.now, env.timeZone);
    return go("appointments_menu", context, [line("request_created", { hold_until: holdUntil })]);
  }
  if (outcome.failure === "slot_unavailable" && context.booking) {
    return go("book_slot", withBooking(context, withoutSlot(context.booking)), failureLines(outcome));
  }
  return go("appointments_menu", context, failureLines(outcome));
}

export const bookConfirm: Step = {
  id: "book_confirm",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const booking = context.booking;
    const slot = booking?.slotId
      ? (await slotsOfDay(booking, env)).find((s) => s.id === booking.slotId)
      : undefined;
    if (!booking || !slot) {
      return redirect("book_slot", context, [line("slot_taken")]);
    }
    const params = {
      service: slot.serviceName,
      when: formatWhen(slot.startAt, env.timeZone),
      practitioner: slot.practitionerName,
    };
    return prompt(context, [line("book_confirm_prompt", params)], [choice("book:confirm", t("option_confirm"))]);
  },
  async handle(input, context, env) {
    const command = commandOf(context.booking);
    if (!isOption(input, "book:confirm") || !command || !context.patientId) {
      return retry("book_confirm", context);
    }
    return {
      goto: "book_confirm",
      context,
      lines: [],
      effect: { kind: "request_appointment", medicalRecordId: context.patientId, command },
      then: (outcome) => afterRequest(outcome, context, env),
    };
  },
};
```

Nota: si Biome marca `_slotId` como no usado, cámbialo por `Object.fromEntries(Object.entries(booking).filter(([k]) => k !== "slotId")) as BookingDraft`.

- [ ] **Step 4: Registro `steps/index.ts`**

```ts
import type { StepRegistry } from "../types";
import { appointmentsMenu, cancelConfirm, pickAppointment } from "./appointments";
import { bookConfirm, bookDay, bookPractitioner, bookService, bookSlot } from "./booking";
import { idDocumentNumber, idDocumentType } from "./identification";
import { kbQuery, kbResults } from "./knowledge";
import { closed, mainMenu, verificationBlocked } from "./menu";
import { preregConfirm, preregField, privacyNotice } from "./pre-registration";
import { verifyQuestion } from "./verification";

/** Unico lugar que conoce todos los pasos; ningun paso importa este archivo (0 ciclos). */
export const STEPS: StepRegistry = {
  main_menu: mainMenu,
  closed,
  kb_query: kbQuery,
  kb_results: kbResults,
  id_document_type: idDocumentType,
  id_document_number: idDocumentNumber,
  verify_question: verifyQuestion,
  verification_blocked: verificationBlocked,
  privacy_notice: privacyNotice,
  prereg_field: preregField,
  prereg_confirm: preregConfirm,
  appointments_menu: appointmentsMenu,
  pick_appointment: pickAppointment,
  cancel_confirm: cancelConfirm,
  book_service: bookService,
  book_practitioner: bookPractitioner,
  book_day: bookDay,
  book_slot: bookSlot,
  book_confirm: bookConfirm,
};
```

- [ ] **Step 5: Recorrido completo con el motor**

`backend/tests/dominio/flujo-recorrido.test.ts` — recorre el flujo con `runTurn`, `STEPS` y lecturas en memoria, eligiendo opciones por su valor:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS } from "@/modules/bot-config/domain/bot-config";
import { runTurn, startConversation, type TurnOutput } from "@/modules/conversation/domain/engine";
import { STEPS } from "@/modules/conversation/domain/steps";
import { CONVERSATION_TEXT_KEYS } from "@/modules/conversation/domain/text";
import type { Effect, EffectOutcome } from "@/modules/conversation/domain/types";
import { fakeReads, makeEnv, NOW } from "./flujo-support";

const env = makeEnv(
  fakeReads({
    listServices: async () => [{ id: "svc1", name: "Medicina general" }],
    listPractitioners: async () => [{ id: "p1", name: "Dra. Ruiz" }],
    listAvailableSlots: async (_t, f) =>
      [{ id: "s1", startAt: new Date(NOW.getTime() + 3_600_000), serviceName: "Medicina general", practitionerName: "Dra. Ruiz" }].filter(
        (s) => s.startAt >= f.from && s.startAt < f.to,
      ),
  }),
);

function pick(out: TurnOutput, value: string): { optionId: string } {
  const option = out.state.context.options.find((o) => o.value === value);
  if (!option) {
    throw new Error(`Sin opcion ${value} en ${out.state.step}`);
  }
  return { optionId: option.id };
}

describe("flujo: recorrido", () => {
  it("todas las claves del chat tienen texto predeterminado", () => {
    expect(CONVERSATION_TEXT_KEYS.filter((key) => !(key in DEFAULT_TEXTS))).toEqual([]);
  });

  it("documento nuevo → pre-registro → agendar declara una solicitud book", async () => {
    const effects: Effect[] = [];
    const runEffect = async (effect: Effect): Promise<EffectOutcome> => {
      effects.push(effect);
      if (effect.kind === "pre_register") return { ok: true, medicalRecordId: "mr-new" };
      if (effect.kind === "request_appointment") return { ok: true, expiresAt: new Date(NOW.getTime() + 3_600_000) };
      return { ok: true };
    };
    let out = await startConversation(env, STEPS);
    const say = async (message: { optionId: string } | { text: string }) => {
      out = await runTurn(out.state, message, env, runEffect, STEPS);
      return out;
    };
    await say(pick(out, "menu:appointments"));
    await say(pick(out, "doc:CC"));
    await say({ text: "99887766" });
    await say(pick(out, "privacy:accept"));
    for (const value of ["Ana", "Paz", "1990-03-07", "3001234567"]) {
      await say({ text: value });
    }
    await say(pick(out, "prereg:skip"));
    await say(pick(out, "prereg:confirm"));
    expect(out.state.step).toBe("appointments_menu");
    await say(pick(out, "appt:book"));
    await say(pick(out, "svc:svc1"));
    await say(pick(out, "prac:any"));
    await say(pick(out, "day:2026-10-05"));
    await say(pick(out, "slot:s1"));
    await say(pick(out, "book:confirm"));
    expect(effects.map((e) => e.kind)).toEqual(["pre_register", "request_appointment"]);
    expect(effects[1]).toEqual({ kind: "request_appointment", medicalRecordId: "mr-new", command: { kind: "book", slotId: "s1" } });
    expect(out.state.step).toBe("appointments_menu");
    expect(out.state.context.preRegistration).toBeUndefined();
  });
});
```

- [ ] **Step 6: Correr pruebas y commit**

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-citas.test.ts tests/dominio/flujo-recorrido.test.ts tests/fronteras.test.ts` → PASS.
Run: `npm --prefix backend run typecheck && npm run ci` → sin errores.

```bash
git add backend/src/modules/conversation/domain/steps backend/tests/dominio/flujo-citas.test.ts backend/tests/dominio/flujo-recorrido.test.ts
git commit -m "feat(conversation): agendar, reprogramar y cancelar como solicitudes; registro de pasos"
```

---
### Task 13: Capa de aplicación de la conversación

**Files:**
- Create: `backend/src/modules/conversation/domain/ports.ts`
- Create: `backend/src/modules/conversation/application/render.ts`
- Create: `backend/src/modules/conversation/application/conversation.ts`
- Create: `backend/tests/dominio/flujo-aplicacion.test.ts`

**Interfaces:**
- Consumes: T8–T12 (`startConversation`, `runTurn`, `TurnOutput`, `STEPS`, tipos), `AuditActor`, `Clock`, `IdGenerator`, `Random`, `TenantId`.
- Produces:
  - `ports.ts`: `StoredConversation`, `NewMessage = { author: "bot" | "patient"; text: string; redacted: boolean }`, `HistoryMessage = NewMessage & { createdAt: Date }`, `ConversationRepository`, `MessageRepository`, `ConversationConfig = { texts: Readonly<Record<string, string>>; clinicName: string; params: ConversationParams }`, `ConversationConfigReader`, `EffectContext = { tenantId: string; conversationId: string; actor: AuditActor }`, `EffectRunner = (effect, context) => Promise<EffectOutcome>`.
  - `render.ts`: `renderText(text, config): string`, `renderOptions(context, config): RenderedOption[]`, `RenderedOption = { id; label }`, `RenderedMessage = { text; redacted }`.
  - `conversation.ts`: `ConversationDeps`, `ConversationRequest = AuditActor & { tenantId: TenantId; sessionId: string }`, `TurnView = { messages: RenderedMessage[]; options: RenderedOption[]; input: InputMode }`, `HistoryView = { messages: HistoryMessage[]; options; input }`, `createGetConversation(deps) → (request) => Promise<HistoryView>`, `createHandleMessage(deps) → (request & { message: IncomingMessage }) => Promise<TurnView>`.

- [ ] **Step 1: `domain/ports.ts`**

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { ConversationParams, ConversationState, Effect, EffectOutcome } from "./types";

export type StoredConversation = {
  readonly id: string;
  readonly tenantId: string;
  readonly widgetSessionId: string;
  readonly state: ConversationState;
  readonly messageCount: number;
};

export type NewMessage = {
  readonly author: "bot" | "patient";
  /** Ya redactado si `redacted`: el repositorio nunca recibe el contenido sensible. */
  readonly text: string;
  readonly redacted: boolean;
};

export type HistoryMessage = NewMessage & { readonly createdAt: Date };

export type ConversationRepository = {
  /**
   * Crea la conversacion de la sesion si no existe (ON CONFLICT DO NOTHING) y la devuelve
   * bloqueada FOR UPDATE: los turnos de una misma sesion se serializan.
   */
  open(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly widgetSessionId: string;
    readonly state: ConversationState;
    readonly now: Date;
  }): Promise<{ readonly conversation: StoredConversation; readonly created: boolean }>;
  save(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly state: ConversationState;
    readonly medicalRecordId: string | null;
    readonly messageCount: number;
    readonly now: Date;
  }): Promise<void>;
};

export type MessageRepository = {
  append(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly firstSeq: number;
    readonly messages: readonly NewMessage[];
    readonly now: Date;
  }): Promise<void>;
  list(tenantId: string, conversationId: string): Promise<HistoryMessage[]>;
};

export type ConversationConfig = {
  readonly texts: Readonly<Record<string, string>>;
  readonly clinicName: string;
  readonly params: ConversationParams;
};

export type ConversationConfigReader = (tenantId: string) => Promise<ConversationConfig>;

export type EffectContext = {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly actor: AuditActor;
};

/** Lo cumple el composition root con los casos de uso de cada modulo, dentro de un SAVEPOINT. */
export type EffectRunner = (effect: Effect, context: EffectContext) => Promise<EffectOutcome>;
```

- [ ] **Step 2: Pruebas (fallan)**

`backend/tests/dominio/flujo-aplicacion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS } from "@/modules/bot-config/domain/bot-config";
import {
  type ConversationDeps,
  createGetConversation,
  createHandleMessage,
} from "@/modules/conversation/application/conversation";
import type {
  ConversationRepository,
  HistoryMessage,
  MessageRepository,
  StoredConversation,
} from "@/modules/conversation/domain/ports";
import { STEPS } from "@/modules/conversation/domain/steps";
import type { Effect, EffectOutcome } from "@/modules/conversation/domain/types";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { Challenge } from "@/modules/verification/domain/challenge";
import { fakeReads, firstRandom, NOW, TZ } from "./flujo-support";

const RECORD = { id: "mr-1", birthDate: "1990-03-07", phone: "3001234567", email: null };
const CHALLENGE: Challenge = {
  id: "v1",
  tenantId: "t1",
  medicalRecordId: "mr-1",
  questionIds: ["birth_day", "phone_last_4"],
  failedAttempts: 0,
  lockedUntil: null,
};

function memory() {
  const rows = new Map<string, StoredConversation>();
  const messages: (HistoryMessage & { conversationId: string; seq: number })[] = [];
  const conversations: ConversationRepository = {
    async open(input) {
      const existing = rows.get(input.widgetSessionId);
      if (existing) return { conversation: existing, created: false };
      const created = { id: input.id, tenantId: input.tenantId, widgetSessionId: input.widgetSessionId, state: input.state, messageCount: 0 };
      rows.set(input.widgetSessionId, created);
      return { conversation: created, created: true };
    },
    async save(input) {
      for (const [key, row] of rows) {
        if (row.id === input.id) rows.set(key, { ...row, state: input.state, messageCount: input.messageCount });
      }
    },
  };
  const store: MessageRepository = {
    async append(input) {
      input.messages.forEach((m, i) => messages.push({ ...m, createdAt: input.now, conversationId: input.conversationId, seq: input.firstSeq + i }));
    },
    async list(_t, conversationId) {
      return messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.seq - b.seq);
    },
  };
  return { rows, messages, conversations, store };
}

function setup(runEffect: (effect: Effect) => Promise<EffectOutcome> = async () => ({ ok: true })) {
  const mem = memory();
  let next = 0;
  const deps: ConversationDeps = {
    conversations: mem.conversations,
    messages: mem.store,
    config: async () => ({ texts: DEFAULT_TEXTS, clinicName: "Clínica Sol", params: { kbMaxResults: 3 } }),
    reads: fakeReads({
      findPatient: async (_t, _type, number) => (number === "1020304050" ? RECORD : null),
      getPatient: async () => RECORD,
      challenge: async () => CHALLENGE,
    }),
    runEffect: (effect) => runEffect(effect),
    clock: { now: () => NOW },
    ids: { next: () => `id-${++next}` },
    random: firstRandom,
    timeZone: TZ,
    steps: STEPS,
  };
  const request = { tenantId: toTenantId("t1"), sessionId: "s1", actorSubject: "widget:s1", actorRole: "widget", requestId: "r1" };
  return { mem, get: createGetConversation(deps), send: createHandleMessage(deps), request };
}

describe("flujo: aplicacion", () => {
  it("la primera lectura crea la conversacion con bienvenida una sola vez", async () => {
    const { get, request } = setup();
    const first = await get(request);
    const again = await get(request);
    expect(first.messages.map((m) => m.text)).toEqual([
      "Hola, soy el asistente virtual de Clínica Sol. ¿En qué te puedo ayudar?",
      "Elige una opción.",
    ]);
    expect(again.messages).toHaveLength(2);
    expect(first.options.map((o) => o.label)).toEqual(["Mis citas", "Consultas generales", "Hablar con un asesor"]);
  });

  it("las respuestas de verificacion no llegan ni a los mensajes ni al estado", async () => {
    const { get, send, request, mem } = setup(async (effect) =>
      effect.kind === "verification_attempt"
        ? { ok: true, verification: { result: "verified", remainingAttempts: 3, lockedUntil: null } }
        : { ok: true },
    );
    type View = {
      readonly messages: readonly { readonly text: string }[];
      readonly options: readonly { readonly id: string; readonly label: string }[];
    };
    let view: View = await get(request);
    const choose = async (label: string) => {
      const option = view.options.find((o) => o.label === label);
      view = { ...view, ...(await send({ ...request, message: { optionId: option?.id ?? "?" } })) };
    };
    const type = async (text: string) => {
      view = { ...view, ...(await send({ ...request, message: { text } })) };
    };
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await type("1020304050");
    await type("07");
    await type("4567");
    expect(view.messages.map((m) => m.text)).toContain("Verificamos tu identidad.");
    const stored = JSON.stringify([...mem.messages, ...mem.rows.values()]);
    expect(stored).not.toContain('"07"');
    expect(stored).not.toContain("4567");
    expect(mem.messages.filter((m) => m.author === "patient").map((m) => m.text)).toEqual([
      "Mis citas",
      "Cédula de ciudadanía",
      "CC ••••4050",
      "[redactado]",
      "[redactado]",
    ]);
  });
});
```

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-aplicacion.test.ts` → FAIL.

- [ ] **Step 3: `application/render.ts`**

```ts
import type { ConversationConfig } from "../domain/ports";
import type { BotText } from "../domain/text";
import type { ConversationContext } from "../domain/types";

const PLACEHOLDER = /\{([^{}]*)\}/g;

export type RenderedOption = { readonly id: string; readonly label: string };
export type RenderedMessage = { readonly text: string; readonly redacted: boolean };

/** Texto final: plantilla del tenant (o predeterminada) con sus marcadores; o el literal. */
export function renderText(text: BotText, config: ConversationConfig): string {
  if ("literal" in text) {
    return text.literal;
  }
  const params: Record<string, string> = { clinic_name: config.clinicName, ...text.params };
  const template = config.texts[text.key] ?? text.key;
  const rendered = template.replace(PLACEHOLDER, (match, name: string) => params[name] ?? match);
  return text.append ? `${rendered}: ${text.append}` : rendered;
}

export function renderOptions(context: ConversationContext, config: ConversationConfig): RenderedOption[] {
  return context.options.map((option) => ({ id: option.id, label: renderText(option.label, config) }));
}
```

- [ ] **Step 4: `application/conversation.ts`**

```ts
import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { Random } from "@/modules/shared/domain/ports/random";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { runTurn, startConversation, type TurnOutput } from "../domain/engine";
import type {
  ConversationConfig,
  ConversationConfigReader,
  ConversationRepository,
  EffectRunner,
  HistoryMessage,
  MessageRepository,
  NewMessage,
  StoredConversation,
} from "../domain/ports";
import type { ConversationReads } from "../domain/reads";
import { REDACTED } from "../domain/text";
import type { IncomingMessage, InputMode, StepEnv, StepRegistry } from "../domain/types";
import { type RenderedMessage, type RenderedOption, renderOptions, renderText } from "./render";

export type ConversationDeps = {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly config: ConversationConfigReader;
  readonly reads: ConversationReads;
  readonly runEffect: EffectRunner;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: Random;
  readonly timeZone: string;
  readonly steps: StepRegistry;
};

export type ConversationRequest = AuditActor & {
  readonly tenantId: TenantId;
  readonly sessionId: string;
};

export type TurnView = {
  readonly messages: readonly RenderedMessage[];
  readonly options: readonly RenderedOption[];
  readonly input: InputMode;
};

export type HistoryView = {
  readonly messages: readonly HistoryMessage[];
  readonly options: readonly RenderedOption[];
  readonly input: InputMode;
};

type Opened = { readonly conversation: StoredConversation; readonly messageCount: number };

function envFor(deps: ConversationDeps, tenantId: string, config: ConversationConfig, now: Date): StepEnv {
  return { tenantId, now, timeZone: deps.timeZone, params: config.params, random: deps.random, reads: deps.reads };
}

/** Lo que se guarda: el eco del paciente y las lineas del bot, redactadas donde corresponde. */
function toMessages(output: TurnOutput, config: ConversationConfig): NewMessage[] {
  const echo: NewMessage[] = output.echo
    ? [
        {
          author: "patient",
          text: output.echo.redacted ? REDACTED : renderText(output.echo.text, config),
          redacted: output.echo.redacted,
        },
      ]
    : [];
  const bot = output.lines.map((l): NewMessage => {
    const redacted = l.redacted === true;
    return { author: "bot", text: redacted ? REDACTED : renderText(l.text, config), redacted };
  });
  return [...echo, ...bot];
}

async function persist(
  deps: ConversationDeps,
  conversation: StoredConversation,
  count: number,
  output: TurnOutput,
  config: ConversationConfig,
  now: Date,
): Promise<number> {
  const messages = toMessages(output, config);
  const { id, tenantId } = conversation;
  await deps.messages.append({ tenantId, conversationId: id, firstSeq: count + 1, messages, now });
  const messageCount = count + messages.length;
  const medicalRecordId = output.state.context.patientId ?? null;
  await deps.conversations.save({ id, tenantId, state: output.state, medicalRecordId, messageCount, now });
  return messageCount;
}

/** Abre (o crea con bienvenida) la conversacion de la sesion, bloqueada para este turno. */
async function openConversation(
  deps: ConversationDeps,
  request: ConversationRequest,
  config: ConversationConfig,
  now: Date,
): Promise<Opened> {
  const start = await startConversation(envFor(deps, request.tenantId, config, now), deps.steps);
  const { conversation, created } = await deps.conversations.open({
    id: deps.ids.next(),
    tenantId: request.tenantId,
    widgetSessionId: request.sessionId,
    state: start.state,
    now,
  });
  if (!created) {
    return { conversation, messageCount: conversation.messageCount };
  }
  const messageCount = await persist(deps, conversation, 0, start, config, now);
  return { conversation: { ...conversation, state: start.state }, messageCount };
}

export type GetConversation = (request: ConversationRequest) => Promise<HistoryView>;

export function createGetConversation(deps: ConversationDeps): GetConversation {
  return async (request) => {
    const now = deps.clock.now();
    const config = await deps.config(request.tenantId);
    const { conversation } = await openConversation(deps, request, config, now);
    const messages = await deps.messages.list(request.tenantId, conversation.id);
    const { context } = conversation.state;
    return { messages, options: renderOptions(context, config), input: context.input };
  };
}

export type HandleMessage = (
  request: ConversationRequest & { readonly message: IncomingMessage },
) => Promise<TurnView>;

export function createHandleMessage(deps: ConversationDeps): HandleMessage {
  return async (request) => {
    const now = deps.clock.now();
    const config = await deps.config(request.tenantId);
    const { conversation, messageCount } = await openConversation(deps, request, config, now);
    const { actorSubject, actorRole, requestId } = request;
    const effectContext = {
      tenantId: request.tenantId,
      conversationId: conversation.id,
      actor: { actorSubject, actorRole, requestId },
    };
    const output = await runTurn(
      conversation.state,
      request.message,
      envFor(deps, request.tenantId, config, now),
      (effect) => deps.runEffect(effect, effectContext),
      deps.steps,
    );
    await persist(deps, conversation, messageCount, output, config, now);
    const { context } = output.state;
    const messages = output.lines.map((l) => ({ text: renderText(l.text, config), redacted: l.redacted === true }));
    return { messages, options: renderOptions(context, config), input: context.input };
  };
}
```

- [ ] **Step 5: Correr pruebas y commit**

Run: `npm --prefix backend exec vitest run tests/dominio/flujo-aplicacion.test.ts tests/fronteras.test.ts` → PASS.

```bash
git add backend/src/modules/conversation/domain/ports.ts backend/src/modules/conversation/application backend/tests/dominio/flujo-aplicacion.test.ts
git commit -m "feat(conversation): apertura con bienvenida, turno con efectos y persistencia redactada"
```

---

### Task 14: Infraestructura, cableado, rutas HTTP y contrato

**Files:**
- Create: `backend/src/modules/shared/infrastructure/prisma-savepoint.ts`
- Create: `backend/src/modules/conversation/infrastructure/prisma-conversation-repository.ts`
- Create: `backend/src/modules/conversation/infrastructure/prisma-message-repository.ts`
- Create: `backend/src/modules/conversation/infrastructure/prisma-conversation-reads.ts`
- Create: `backend/src/composition/sim-wiring.ts` (mueve `simReads` desde `composition-root.ts`)
- Create: `backend/src/composition/conversation-effects.ts`
- Create: `backend/src/composition/conversation-wiring.ts`
- Modify: `backend/src/composition-root.ts`
- Modify: `backend/src/http/idempotency-core.ts`, `backend/src/http/idempotent-route.ts` (hash con clave)
- Modify: `backend/src/http/widget-session-response.ts` (`sessionIdOf`, repetición por sesión)
- Modify: `backend/src/app/api/v1/widget/sessions/refresh/route.ts` (usa `sessionIdOf`)
- Create: `backend/src/http/serializers-conversation.ts`
- Modify: `backend/src/http/openapi-paths-conversation.ts`
- Create: `backend/src/app/api/v1/widget/conversation/route.ts`
- Create: `backend/src/app/api/v1/widget/conversation/messages/route.ts`
- Create: `backend/tests/db/chat-support.ts`
- Create: `backend/tests/db/flujo-http.test.ts`
- Modify: `backend/tests/db/aislamiento-tenant.test.ts`

**Interfaces:**
- Consumes: T1–T13.
- Produces: `withSavepoint(db, run)`; `createPrismaConversationRepository(db)`, `createPrismaMessageRepository(db, ids)`, `createPrismaConversationReads(db)` (con `listActiveKnowledge` y `clinicName` extra); `createEffectRunner(db, ports): EffectRunner`; `conversationWritePorts(db, config, auditLog, createAppointmentRequest)` → `{ getConversation, handleConversationMessage }` en `WritePorts`; `readIdempotentRequest(request, actorSubject, minKeyLength?, hashKey?)`; opción `sensitiveBody` de `idempotentRoute`; `sessionIdOf(actor)`; `conversationTurnJson`, `storedTurnJson`, `conversationHistoryJson`.

- [ ] **Step 1: Hacer sitio en `composition-root.ts`**

Mueve `simReads` y sus imports de `hermes-simulator/infrastructure/prisma-stores` (solo los que usa `simReads`) a `backend/src/composition/sim-wiring.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import {
  createPrismaSimHealthcareServiceStore,
  createPrismaSimPatientStore,
  createPrismaSimPractitionerStore,
  createPrismaSimScheduleStore,
} from "../modules/hermes-simulator/infrastructure/prisma-stores";

/** Lecturas del simulador para el contenedor. Aparte para no pasar de 400 lineas en el root. */
export function simReads(prisma: PrismaClient) {
  // cuerpo identico al que tenia composition-root.ts
}
```

En `composition-root.ts` importa `simReads` de `./composition/sim-wiring` y borra la función local. Run: `npm --prefix backend run typecheck` → sin errores.

- [ ] **Step 2: `prisma-savepoint.ts`**

```ts
import type { PrismaExecutor } from "./prisma-client";

const SAVEPOINT = "conversation_effect";

/**
 * Ejecuta `run` dentro de un SAVEPOINT de la transaccion en curso. Si falla, vuelve al punto y
 * relanza: Postgres aborta la transaccion ante una sentencia rechazada (p. ej. P2002) y sin el
 * punto no se podria seguir escribiendo la conversacion (refinamiento 2).
 */
export async function withSavepoint<T>(db: PrismaExecutor, run: () => Promise<T>): Promise<T> {
  await db.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const result = await run();
    await db.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return result;
  } catch (error) {
    await db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    throw error;
  }
}
```

- [ ] **Step 3: Repositorios Prisma de la conversación**

`prisma-conversation-repository.ts`:
```ts
import type { Prisma } from "@prisma/client";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { ConversationRepository, StoredConversation } from "../domain/ports";
import type { ConversationContext, ConversationState, StepId } from "../domain/types";

function toStored(row: {
  id: string;
  tenantId: string;
  widgetSessionId: string;
  step: string;
  context: Prisma.JsonValue;
  messageCount: number;
}): StoredConversation {
  const state: ConversationState = {
    step: row.step as StepId,
    context: row.context as unknown as ConversationContext,
  };
  return { id: row.id, tenantId: row.tenantId, widgetSessionId: row.widgetSessionId, state, messageCount: row.messageCount };
}

const asJson = (context: ConversationContext) => context as unknown as Prisma.InputJsonValue;

export function createPrismaConversationRepository(db: PrismaExecutor): ConversationRepository {
  return {
    async open(input) {
      const { tenantId, widgetSessionId } = input;
      const inserted = await db.conversation.createMany({
        data: [
          {
            id: input.id,
            tenantId,
            widgetSessionId,
            step: input.state.step,
            context: asJson(input.state.context),
            createdAt: input.now,
            updatedAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
      await db.$queryRaw`
        SELECT "id" FROM "public"."conversations"
        WHERE "tenant_id" = ${tenantId} AND "widget_session_id" = ${widgetSessionId} FOR UPDATE`;
      const row = await db.conversation.findUniqueOrThrow({
        where: { tenantId_widgetSessionId: { tenantId, widgetSessionId } },
      });
      return { conversation: toStored(row), created: inserted.count === 1 };
    },

    async save(input) {
      await db.conversation.update({
        where: { id: input.id },
        data: {
          step: input.state.step,
          context: asJson(input.state.context),
          medicalRecordId: input.medicalRecordId,
          messageCount: input.messageCount,
          updatedAt: input.now,
        },
      });
    },
  };
}
```

`prisma-message-repository.ts`:
```ts
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { MessageRepository } from "../domain/ports";

export function createPrismaMessageRepository(db: PrismaExecutor, ids: IdGenerator): MessageRepository {
  return {
    async append(input) {
      await db.conversationMessage.createMany({
        data: input.messages.map((message, index) => ({
          id: ids.next(),
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          seq: input.firstSeq + index,
          author: message.author,
          text: message.text,
          redacted: message.redacted,
          createdAt: input.now,
        })),
      });
    },

    async list(tenantId, conversationId) {
      return db.conversationMessage.findMany({
        where: { tenantId, conversationId },
        orderBy: { seq: "asc" },
        select: { author: true, text: true, redacted: true, createdAt: true },
      });
    },
  };
}
```

`prisma-conversation-reads.ts` (verifica en `schema.prisma` los nombres de relación `schedules`, `schedule`, `practitioner`, `healthcareService`):
```ts
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { VerifiableRecord } from "@/modules/verification/domain/questions";
import type { ConversationReads } from "../domain/reads";

const MAX_UPCOMING = 10;

function toRecord(row: { id: string; birthDate: Date; phone: string | null; email: string | null }): VerifiableRecord {
  return { id: row.id, birthDate: row.birthDate.toISOString().slice(0, 10), phone: row.phone, email: row.email };
}

const withNames = { schedule: { include: { practitioner: true, healthcareService: true } } } as const;

type PrismaReads = Omit<ConversationReads, "challenge" | "searchKnowledge"> & {
  listActiveKnowledge(tenantId: string): Promise<
    { id: string; question: string; answer: string; detail: string | null; keywords: string[]; position: number; active: boolean }[]
  >;
  clinicName(tenantId: string): Promise<string>;
};

/** Lecturas del chat sobre tablas de dominio. El desafio y la busqueda los compone el root. */
export function createPrismaConversationReads(db: PrismaExecutor): PrismaReads {
  return {
    async findPatient(tenantId, documentType, documentNumber) {
      const row = await db.medicalRecord.findUnique({
        where: { tenantId_documentType_documentNumber: { tenantId, documentType, documentNumber } },
      });
      return row ? toRecord(row) : null;
    },
    async getPatient(tenantId, id) {
      const row = await db.medicalRecord.findFirst({ where: { tenantId, id } });
      return row ? toRecord(row) : null;
    },
    async getKnowledge(tenantId, id) {
      const row = await db.knowledgeEntry.findFirst({ where: { tenantId, id, active: true } });
      return row && { id: row.id, question: row.question, answer: row.answer, detail: row.detail };
    },
    listActiveKnowledge(tenantId) {
      return db.knowledgeEntry.findMany({ where: { tenantId, active: true } });
    },
    listServices(tenantId) {
      return db.healthcareService.findMany({
        where: { tenantId, schedules: { some: { active: true } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    },
    listPractitioners(tenantId, serviceId) {
      return db.practitioner.findMany({
        where: { tenantId, schedules: { some: { active: true, healthcareServiceId: serviceId } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    },
    async listAvailableSlots(tenantId, filter) {
      const rows = await db.slot.findMany({
        where: {
          tenantId,
          status: "free",
          startAt: { gte: filter.from, lt: filter.to },
          schedule: {
            active: true,
            healthcareServiceId: filter.serviceId,
            ...(filter.practitionerId ? { practitionerId: filter.practitionerId } : {}),
          },
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: filter.limit,
        include: withNames,
      });
      return rows.map((row) => ({
        id: row.id,
        startAt: row.startAt,
        serviceName: row.schedule.healthcareService.name,
        practitionerName: row.schedule.practitioner.name,
      }));
    },
    async listUpcomingAppointments(tenantId, medicalRecordId, now) {
      const rows = await db.appointment.findMany({
        where: { tenantId, medicalRecordId, status: "booked", startAt: { gt: now } },
        orderBy: { startAt: "asc" },
        take: MAX_UPCOMING,
        include: withNames,
      });
      return rows.map((row) => ({
        id: row.id,
        startAt: row.startAt,
        serviceId: row.schedule.healthcareServiceId,
        serviceName: row.schedule.healthcareService.name,
        practitionerName: row.schedule.practitioner.name,
      }));
    },
    async clinicName(tenantId) {
      const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      return tenant?.name ?? "";
    },
  };
}
```

- [ ] **Step 4: Ejecutor de efectos `composition/conversation-effects.ts`**

```ts
import type { CreateHandoffTicket } from "../modules/handoff/application/create-handoff-ticket";
import type { EffectRunner } from "../modules/conversation/domain/ports";
import type { Effect, EffectFailure, EffectOutcome } from "../modules/conversation/domain/types";
import type { PreRegisterPatient } from "../modules/patients/application/pre-register-patient";
import type {
  CreateAppointmentRequest,
  CreateAppointmentRequestCommand,
} from "../modules/scheduling/application/create-appointment-request";
import type { AuditActor } from "../modules/shared/domain/audit-event";
import { ConflictError } from "../modules/shared/domain/conflict-error";
import { NotFoundError } from "../modules/shared/domain/not-found-error";
import { type TenantId, toTenantId } from "../modules/shared/domain/tenant-id";
import { ValidationError } from "../modules/shared/domain/validation-error";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { withSavepoint } from "../modules/shared/infrastructure/prisma-savepoint";
import type {
  OpenChallenge,
  RecordVerificationAttempt,
} from "../modules/verification/application/verification";

export type EffectPorts = {
  readonly createAppointmentRequest: CreateAppointmentRequest;
  readonly preRegisterPatient: PreRegisterPatient;
  readonly createHandoffTicket: CreateHandoffTicket;
  readonly openChallenge: OpenChallenge;
  readonly recordVerificationAttempt: RecordVerificationAttempt;
};

const KNOWN: ReadonlySet<string> = new Set<EffectFailure>([
  "slot_unavailable",
  "pending_limit_reached",
  "appointment_change_pending",
  "document_taken",
]);

/** Errores de dominio esperables → fallo que el paso traduce; el resto sigue siendo 500. */
function failureOf(error: unknown): EffectOutcome | null {
  if (error instanceof ConflictError) {
    const details = (error.details ?? {}) as { reason?: string; max?: number };
    if (!details.reason || !KNOWN.has(details.reason)) {
      return null;
    }
    const failure = details.reason as EffectFailure;
    return details.max === undefined ? { ok: false, failure } : { ok: false, failure, max: details.max };
  }
  if (error instanceof ValidationError || error instanceof NotFoundError) {
    return { ok: false, failure: "not_available" };
  }
  return null;
}

async function guarded(db: PrismaExecutor, run: () => Promise<EffectOutcome>): Promise<EffectOutcome> {
  try {
    return await withSavepoint(db, run);
  } catch (error) {
    const failure = failureOf(error);
    if (failure) {
      return failure;
    }
    throw error;
  }
}

function toCommand(
  tenantId: TenantId,
  effect: Extract<Effect, { kind: "request_appointment" }>,
  actor: AuditActor,
): CreateAppointmentRequestCommand {
  const base = { tenantId, medicalRecordId: effect.medicalRecordId, actor };
  const command = effect.command;
  switch (command.kind) {
    case "book":
      return { ...base, kind: "book", slotId: command.slotId };
    case "reschedule":
      return { ...base, kind: "reschedule", appointmentId: command.appointmentId, slotId: command.slotId };
    case "cancel":
      return { ...base, kind: "cancel", appointmentId: command.appointmentId };
  }
}

/** Cumple los efectos del motor con los casos de uso de cada modulo (refinamiento 2). */
export function createEffectRunner(db: PrismaExecutor, ports: EffectPorts): EffectRunner {
  return async (effect, context) => {
    const tenantId = toTenantId(context.tenantId);
    const { actor } = context;
    switch (effect.kind) {
      case "request_appointment":
        return guarded(db, async () => {
          const request = await ports.createAppointmentRequest(toCommand(tenantId, effect, actor));
          return { ok: true, expiresAt: request.expiresAt };
        });
      case "pre_register":
        return guarded(db, async () => {
          const record = await ports.preRegisterPatient({ ...actor, tenantId, data: effect.data });
          return { ok: true, medicalRecordId: record.id };
        });
      case "handoff":
        await ports.createHandoffTicket({
          ...actor,
          tenantId,
          conversationId: context.conversationId,
          reason: effect.reason,
          medicalRecordId: effect.medicalRecordId,
        });
        return { ok: true };
      case "open_challenge":
        return { ok: true, questionIds: await ports.openChallenge({ tenantId, ...effect }) };
      case "verification_attempt":
        return {
          ok: true,
          verification: await ports.recordVerificationAttempt({ ...actor, tenantId, ...effect }),
        };
    }
  };
}
```

(`{ tenantId, ...effect }` arrastra `kind`; si el tipo de entrada de `openChallenge`/`recordVerificationAttempt` lo rechaza como propiedad extra, pasa los campos uno a uno.)

- [ ] **Step 5: `composition/conversation-wiring.ts`**

```ts
import type { AppConfig } from "../config/env";
import { createReadBotParams } from "../modules/bot-config/application/widget-access";
import { EMPTY_OVERRIDES, effectiveConfig } from "../modules/bot-config/domain/bot-config";
import type { BotConfigRepository } from "../modules/bot-config/domain/ports/repositories";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import {
  type ConversationDeps,
  createGetConversation,
  createHandleMessage,
} from "../modules/conversation/application/conversation";
import type { ConversationConfigReader } from "../modules/conversation/domain/ports";
import type { ConversationReads } from "../modules/conversation/domain/reads";
import { STEPS } from "../modules/conversation/domain/steps";
import { createPrismaConversationReads } from "../modules/conversation/infrastructure/prisma-conversation-reads";
import { createPrismaConversationRepository } from "../modules/conversation/infrastructure/prisma-conversation-repository";
import { createPrismaMessageRepository } from "../modules/conversation/infrastructure/prisma-message-repository";
import { createCreateHandoffTicket } from "../modules/handoff/application/create-handoff-ticket";
import { createPrismaHandoffRepository } from "../modules/handoff/infrastructure/prisma-handoff-repository";
import { searchEntries } from "../modules/knowledge/domain/search";
import { createPreRegisterPatient } from "../modules/patients/application/pre-register-patient";
import { createPrismaMedicalRecordRepository } from "../modules/patients/infrastructure/prisma-medical-record-repository";
import { createExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import type { CreateAppointmentRequest } from "../modules/scheduling/application/create-appointment-request";
import { createPrismaRequestExpirer } from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import { toTenantId } from "../modules/shared/domain/tenant-id";
import { cryptoRandom } from "../modules/shared/infrastructure/crypto-random";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";
import {
  createOpenChallenge,
  createReadChallenge,
  createRecordVerificationAttempt,
} from "../modules/verification/application/verification";
import { createPrismaChallengeRepository } from "../modules/verification/infrastructure/prisma-challenge-repository";
import { createEffectRunner } from "./conversation-effects";

/** Cableado del chat (3.3). Aparte para no empujar composition-root.ts por encima de 400 lineas. */
function configReader(
  configs: BotConfigRepository,
  clinicName: (tenantId: string) => Promise<string>,
): ConversationConfigReader {
  return async (tenantId) => {
    const effective = effectiveConfig((await configs.get(toTenantId(tenantId))) ?? EMPTY_OVERRIDES);
    const texts = Object.fromEntries(Object.entries(effective.texts).map(([key, text]) => [key, text.value]));
    return { texts, clinicName: await clinicName(tenantId), params: { kbMaxResults: effective.params.kb_max_results } };
  };
}

function readsFor(db: PrismaExecutor, prismaReads: ReturnType<typeof createPrismaConversationReads>): ConversationReads {
  const readChallenge = createReadChallenge({ repo: createPrismaChallengeRepository(db), clock: systemClock });
  const expire = createExpireDueRequests({ expirer: createPrismaRequestExpirer(db), clock: systemClock });
  return {
    ...prismaReads,
    challenge: (tenantId, id) => readChallenge(toTenantId(tenantId), id),
    async searchKnowledge(tenantId, query, max) {
      const entries = await prismaReads.listActiveKnowledge(tenantId);
      return searchEntries(entries, query, max).map(({ id, question, answer, detail }) => ({ id, question, answer, detail }));
    },
    async listAvailableSlots(tenantId, filter) {
      await expire(toTenantId(tenantId));
      return prismaReads.listAvailableSlots(tenantId, filter);
    },
  };
}

export function conversationWritePorts(
  db: PrismaExecutor,
  config: AppConfig,
  auditLog: AuditLog,
  createAppointmentRequest: CreateAppointmentRequest,
) {
  const botConfigs = createPrismaBotConfigRepository(db);
  const readParams = createReadBotParams(botConfigs);
  const prismaReads = createPrismaConversationReads(db);
  const challenges = createPrismaChallengeRepository(db);
  const base = { ids: uuidV7Generator, clock: systemClock, audit: auditLog };
  const runEffect = createEffectRunner(db, {
    createAppointmentRequest,
    preRegisterPatient: createPreRegisterPatient({ ...base, repo: createPrismaMedicalRecordRepository(db) }),
    createHandoffTicket: createCreateHandoffTicket({ ...base, repo: createPrismaHandoffRepository(db) }),
    openChallenge: createOpenChallenge({ repo: challenges, ids: uuidV7Generator, clock: systemClock }),
    recordVerificationAttempt: createRecordVerificationAttempt({
      repo: challenges,
      clock: systemClock,
      random: cryptoRandom,
      audit: auditLog,
      policy: async (tenantId) => {
        const params = await readParams(tenantId);
        return { maxAttempts: params.verification_max_attempts, lockMinutes: params.verification_lock_minutes };
      },
      records: (tenantId, id) => prismaReads.getPatient(tenantId, id),
    }),
  });
  const deps: ConversationDeps = {
    conversations: createPrismaConversationRepository(db),
    messages: createPrismaMessageRepository(db, uuidV7Generator),
    config: configReader(botConfigs, prismaReads.clinicName),
    reads: readsFor(db, prismaReads),
    runEffect,
    clock: systemClock,
    ids: uuidV7Generator,
    random: cryptoRandom,
    timeZone: config.appTimezone,
    steps: STEPS,
  };
  return { getConversation: createGetConversation(deps), handleConversationMessage: createHandleMessage(deps) };
}
```

`createReadBotParams` lanza `NotFoundError` si el tenant no tiene `bot_configs`; todo tenant con widget lo tiene (alta de la 3.1).

- [ ] **Step 6: Cablear en el root**

En `composition-root.ts`:
```ts
import { conversationWritePorts } from "./composition/conversation-wiring";
// ...
type ConversationWritePorts = ReturnType<typeof conversationWritePorts>;
export type WritePorts = BaseWritePorts & /* ...los que ya estan... */ & PreAgendaWritePorts & ConversationWritePorts;
```
y en `buildWritePorts`, sustituye `...preAgendaWritePorts(db, auditLog),` por:
```ts
    ...preAgenda,
    ...conversationWritePorts(db, config, auditLog, preAgenda.createAppointmentRequest),
```
declarando antes del `return`: `const preAgenda = preAgendaWritePorts(db, auditLog);`.

Run: `npm --prefix backend run typecheck` → sin errores. Comprueba `wc -l backend/src/composition-root.ts` ≤ 400.

- [ ] **Step 7: Hash con clave para cuerpos sensibles (refinamiento 15)**

En `http/idempotency-core.ts` importa `createHmac` y cambia:
```ts
function requestHash(method: string, path: string, bodyText: string, hashKey?: string): string {
  const payload = `${method}\n${path}\n${bodyText}`;
  return hashKey
    ? createHmac("sha256", hashKey).update(payload).digest("hex")
    : createHash("sha256").update(payload).digest("hex");
}

export async function readIdempotentRequest(
  request: Request,
  actorSubject: string,
  minKeyLength = 1,
  hashKey?: string,
): Promise<IdempotentRequest> {
  // ...igual, pero: hash: requestHash(request.method, path, bodyText, hashKey),
}
```
Comentario encima de `requestHash`: «Con `hashKey` (HMAC) el hash no permite recuperar por fuerza bruta un cuerpo corto, como una respuesta de verificación de 4 dígitos (GOBERNANZA §1.5).»

En `http/idempotent-route.ts`, añade a `IdempotentRouteOptions`:
```ts
  /** El cuerpo puede llevar respuestas de verificacion: hash con clave (refinamiento 15). */
  readonly sensitiveBody?: boolean;
```
y en el handler: `const idempotent = await readIdempotentRequest(request, actor.subject, 1, options.sensitiveBody ? container.config.jwt.secret : undefined);`.

- [ ] **Step 8: Utilidades HTTP del widget y serializadores**

En `http/widget-session-response.ts` añade (y úsalo en `widget/sessions/refresh/route.ts`, borrando su `sessionIdOf` local):
```ts
/** Sesion del token de widget; sin ella el token no sirve para el chat. */
export function sessionIdOf(actor: Actor): string {
  if (!actor.sessionId) {
    throw unauthorized();
  }
  return actor.sessionId;
}
```
(importa `Actor` de `@/modules/auth/domain/actor` y `unauthorized` de `@/modules/auth/domain/auth-error`).

`http/serializers-conversation.ts`:
```ts
import type { HistoryView, TurnView } from "@/modules/conversation/application/conversation";
import { REDACTED } from "@/modules/conversation/domain/text";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { IdempotentResult } from "./idempotency-core";

export function conversationTurnJson(turn: TurnView) {
  return { messages: turn.messages.map((m) => m.text), options: turn.options, input: turn.input };
}

/** Lo que se guarda en idempotency_keys: sin las lineas redactadas (refinamiento 10). */
export function storedTurnJson(turn: TurnView, sessionId: string) {
  const messages = turn.messages.map((m) => (m.redacted ? REDACTED : m.text));
  return { session_id: sessionId, body: { messages, options: turn.options, input: turn.input } };
}

/** Repeticion: solo para la misma sesion; otra sesion del tenant con la misma clave es 409. */
export function replayTurn(stored: IdempotentResult, sessionId: string): IdempotentResult {
  const body = stored.body as { session_id?: unknown; body?: unknown } | null;
  if (body?.session_id !== sessionId) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion");
  }
  return { status: stored.status, body: body.body };
}

export function conversationHistoryJson(view: HistoryView) {
  return {
    messages: view.messages.map((m) => ({
      author: m.author,
      text: m.text,
      redacted: m.redacted,
      created_at: m.createdAt.toISOString(),
    })),
    options: view.options,
    input: view.input,
  };
}
```

- [ ] **Step 9: Rutas**

`backend/src/app/api/v1/widget/conversation/route.ts`:
```ts
import { getContainer } from "@/composition-root";
import { assertSessionOrigin, widgetPreflight, withWidgetCors } from "@/http/cors";
import { privateRoute } from "@/http/route";
import { conversationHistoryJson } from "@/http/serializers-conversation";
import { sessionIdOf } from "@/http/widget-session-response";

export const dynamic = "force-dynamic";

/** Turno actual e historial redactado; crea la conversacion con la bienvenida si no existe. */
const getConversation = privateRoute(["widget"], async ({ actor, requestId, request }) => {
  const container = getContainer();
  const sessionId = sessionIdOf(actor);
  assertSessionOrigin(request, await container.getActiveWidgetSession(actor.tenantId, sessionId));
  const view = await container.withWriteTransaction((ports) =>
    ports.getConversation({
      tenantId: actor.tenantId,
      sessionId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    }),
  );
  return conversationHistoryJson(view);
});

export const GET = withWidgetCors(getConversation);
export const OPTIONS = widgetPreflight;
```

`backend/src/app/api/v1/widget/conversation/messages/route.ts`:
```ts
import { getContainer } from "@/composition-root";
import { assertSessionOrigin, widgetPreflight, withWidgetCors } from "@/http/cors";
import { idempotentRoute } from "@/http/idempotent-route";
import { conversationTurnJson, replayTurn, storedTurnJson } from "@/http/serializers-conversation";
import { sessionIdOf } from "@/http/widget-session-response";
import { parseIncomingMessage } from "@/modules/conversation/domain/message-input";

export const dynamic = "force-dynamic";

/** Un turno del chat. La conversacion sale de la sesion del token, nunca del cuerpo. */
const postMessage = idempotentRoute(
  ["widget"],
  async ({ actor, requestId, body, ports, request }) => {
    const sessionId = sessionIdOf(actor);
    assertSessionOrigin(request, await getContainer().getActiveWidgetSession(actor.tenantId, sessionId));
    const turn = await ports.handleConversationMessage({
      tenantId: actor.tenantId,
      sessionId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
      message: parseIncomingMessage(body),
    });
    return { status: 200, body: conversationTurnJson(turn), stored: storedTurnJson(turn, sessionId) };
  },
  {
    sensitiveBody: true,
    rebuild: async (stored, actor) => replayTurn(stored, sessionIdOf(actor)),
  },
);

export const POST = withWidgetCors(postMessage);
export const OPTIONS = widgetPreflight;
```

- [ ] **Step 10: Contrato OpenAPI**

En `http/openapi-paths-conversation.ts` importa también `errorResponses` y `authErrors` y añade a `CONVERSATION_SCHEMAS`:
```ts
  ConversationOption: {
    type: "object",
    required: ["id", "label"],
    properties: { id: { type: "string" }, label: { type: "string" } },
  },
  ConversationTurn: {
    type: "object",
    required: ["messages", "options", "input"],
    properties: {
      messages: { type: "array", items: { type: "string" } },
      options: { type: "array", items: { $ref: "#/components/schemas/ConversationOption" } },
      input: { type: "string", enum: ["none", "text", "date"] },
    },
  },
  ConversationHistory: {
    type: "object",
    required: ["messages", "options", "input"],
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          required: ["author", "text", "redacted", "created_at"],
          properties: {
            author: { type: "string", enum: ["bot", "patient"] },
            text: { type: "string" },
            redacted: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
          },
        },
      },
      options: { type: "array", items: { $ref: "#/components/schemas/ConversationOption" } },
      input: { type: "string", enum: ["none", "text", "date"] },
    },
  },
  ConversationMessageInput: {
    type: "object",
    additionalProperties: false,
    description: "Exactamente uno de option_id o text.",
    properties: {
      option_id: { type: "string", maxLength: 64 },
      text: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
```
y a `CONVERSATION_PATHS`:
```ts
  "/widget/conversation": {
    get: {
      operationId: "getWidgetConversation",
      description:
        "Solo rol widget: turno actual e historial redactado de su sesion. Crea la conversacion con la bienvenida si no existe.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER],
      responses: { ...okJson({ $ref: "#/components/schemas/ConversationHistory" }), ...authErrors },
    },
  },
  "/widget/conversation/messages": {
    post: {
      operationId: "sendWidgetMessage",
      description:
        "Solo rol widget: un turno. option_id de una opcion vigente (409 stale_option si no) o text donde el turno lo pide.",
      security: bearer,
      parameters: [REQUEST_ID_PARAMETER, IDEMPOTENCY_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ConversationMessageInput" } },
        },
      },
      responses: { ...okJson({ $ref: "#/components/schemas/ConversationTurn" }), ...writeErrors },
    },
  },
```

Run: `npm --prefix backend run openapi:generate`, `npm --prefix backend exec vitest run tests/contrato-api.test.ts` → PASS. `npm --prefix frontend run api:generate` y `npm run typecheck` → sin errores.

- [ ] **Step 11: Soporte de pruebas HTTP**

`backend/tests/db/chat-support.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { POST as postMessage } from "@/app/api/v1/widget/conversation/messages/route";
import { GET as getConversation } from "@/app/api/v1/widget/conversation/route";
import { POST as openSession } from "@/app/api/v1/widget/sessions/route";
import { authedRequest } from "../helpers/token";

export const CHAT_ORIGIN = "https://clinica-chat.test";
const BASE = "http://localhost/api/v1/widget";

export type ChatBody = {
  messages: unknown[];
  options: { id: string; label: string }[];
  input: string;
};

/** Da de alta el widget sobre un tenant ya sembrado (seedWorld no crea bot-config). */
export async function enableWidget(prisma: PrismaClient, tenantId: string, slug: string): Promise<string> {
  const widgetKey = `wk_${slug.repeat(43).slice(0, 43)}`;
  await prisma.botConfig.create({ data: { tenantId, allowedOrigins: [CHAT_ORIGIN] } });
  await prisma.widgetKey.create({ data: { id: `${tenantId}-key`, tenantId, key: widgetKey, createdAt: new Date() } });
  return widgetKey;
}

export async function openChat(widgetKey: string): Promise<{ token: string; sessionId: string }> {
  const response = await openSession(
    new Request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: CHAT_ORIGIN, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ widget_key: widgetKey }),
    }),
  );
  const body = await response.json();
  return { token: body.token, sessionId: body.session_id };
}

export function getChat(token: string, headers: Record<string, string> = {}) {
  return getConversation(authedRequest(`${BASE}/conversation`, token, { headers }));
}

export function sendChat(
  token: string,
  message: { option_id: string } | { text: string },
  key: string = randomUUID(),
  headers: Record<string, string> = {},
) {
  return postMessage(
    authedRequest(`${BASE}/conversation/messages`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...headers },
      body: JSON.stringify(message),
    }),
  );
}

export function optionId(body: ChatBody, label: string): string {
  const option = body.options.find((o) => o.label === label);
  if (!option) {
    throw new Error(`Sin opcion «${label}»: ${body.options.map((o) => o.label).join(" | ")}`);
  }
  return option.id;
}
```

- [ ] **Step 12: Prueba de punta a punta (falla hasta que todo esté cableado)**

`backend/tests/db/flujo-http.test.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listInbox } from "@/app/api/sim/v1/inbox/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/token";
import { type ChatBody, enableWidget, getChat, openChat, optionId, sendChat } from "./chat-support";
import { HOUR_MS, seedWorld, type World } from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

describe("flujo: punta a punta por HTTP", () => {
  let world: World;
  let token: string;
  let body: ChatBody;

  const say = async (message: { option_id: string } | { text: string }) => {
    const response = await sendChat(token, message);
    expect(response.status).toBe(200);
    body = await response.json();
    return body;
  };
  const choose = (label: string) => say({ option_id: optionId(body, label) });
  const first = () => say({ option_id: body.options[0]?.id ?? "?" });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    const start = new Date(Math.ceil((Date.now() + 2 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    world = await seedWorld(prisma, "chat", start);
    ({ token } = await openChat(await enableWidget(prisma, world.tenantId, "chat")));
    body = await (await getChat(token)).json();
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  async function verifyExistingPatient() {
    // El chat normaliza el documento a mayusculas: el del seed (`1000chat`) no se encontraria.
    await prisma.medicalRecord.update({
      where: { id: world.medicalRecordId },
      data: { phone: "3001234567", documentNumber: "10002030" },
    });
    const now = new Date();
    await prisma.verificationChallenge.create({
      data: {
        id: "vc",
        tenantId: world.tenantId,
        medicalRecordId: world.medicalRecordId,
        questionIds: ["birth_day", "phone_last_4"],
        createdAt: now,
        updatedAt: now,
      },
    });
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "10002030" });
    await say({ text: "15" });
    await say({ text: "4567" });
  }

  it("documento nuevo: pre-registro y solicitud que llega a la bandeja", async () => {
    expect(body.messages[0]).toBe("Hola, soy el asistente virtual de Tenant chat. ¿En qué te puedo ayudar?");
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "99887766" });
    await choose("Acepto");
    for (const value of ["Ana", "Paz", "1990-03-07", "3001234567"]) {
      await say({ text: value });
    }
    await choose("Omitir");
    expect(String(body.messages[0])).toContain("Ana Paz");
    await choose("Confirmar");
    await choose("Agendar una cita");
    await choose("Serv chat");
    await choose("Cualquiera");
    await first();
    await first();
    await choose("Confirmar");
    expect(String(body.messages[0])).toMatch(/^Enviamos tu solicitud/);

    const request = await prisma.appointmentRequest.findFirstOrThrow({ where: { tenantId: world.tenantId } });
    expect(request).toMatchObject({ kind: "book", status: "pending" });
    expect((await prisma.medicalRecord.findUniqueOrThrow({ where: { id: request.medicalRecordId } })).status).toBe("pre_registered");
    const admin = await signToken({ role: "admin", tenantId: world.tenantId });
    const inbox = await (await listInbox(authedRequest("http://localhost/api/sim/v1/inbox", admin))).json();
    expect(inbox.data.map((r: { id: string }) => r.id)).toContain(request.id);

    const history = await (await getChat(token)).json();
    expect(JSON.stringify(history)).not.toContain("3001234567");
    expect(JSON.stringify(history)).not.toContain("Ana Paz");
  });

  it("paciente existente: verificacion y cancelacion sin dejar respuestas en ningun lado", async () => {
    await verifyExistingPatient();
    expect(body.messages).toContain("Verificamos tu identidad.");
    await choose("Cancelar una cita");
    await first();
    await choose("Confirmar");
    expect(body.messages[0]).toBe("Enviamos tu solicitud de cancelación. Tenant chat la confirmará.");
    expect(await prisma.appointmentRequest.findFirstOrThrow({ where: { tenantId: world.tenantId } })).toMatchObject({ kind: "cancel" });

    const texts = (await prisma.conversationMessage.findMany()).map((m) => m.text);
    expect(texts).not.toContain("15");
    expect(texts).not.toContain("4567");
    const context = JSON.stringify((await prisma.conversation.findMany()).map((c) => c.context));
    expect(context).not.toContain('"4567"');
    const responses = JSON.stringify((await prisma.idempotencyKey.findMany()).map((k) => k.responseBody));
    expect(responses).not.toContain('"4567"');
    const audits = await prisma.auditEvent.findMany({ where: { tenantId: world.tenantId } });
    expect(audits.map((a) => a.action)).toContain("verification.succeeded");
  });

  it("el hash de la peticion lleva clave: no se recupera la respuesta corta", async () => {
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "1000chat" });
    const key = randomUUID();
    const bodyText = JSON.stringify({ text: "15" });
    await sendChat(token, { text: "15" }, key);
    const row = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    const plain = createHash("sha256").update(`POST\n/api/v1/widget/conversation/messages\n${bodyText}`).digest("hex");
    expect(row.requestHash).not.toBe(plain);
  });

  it("un cupo tomado entre la eleccion y la confirmacion no rompe la conversacion", async () => {
    await verifyExistingPatient();
    await choose("Agendar una cita");
    await choose("Serv chat");
    await choose("Cualquiera");
    await first();
    await first();
    await prisma.slot.update({ where: { id: world.freeSlotIds[0] }, data: { status: "busy" } });
    await choose("Confirmar");
    expect(body.messages[0]).toBe("Ese horario se acaba de ocupar. Elige otro.");
    expect(await prisma.appointmentRequest.count()).toBe(0);
    expect(body.options.length).toBeGreaterThan(0);
  });

  it("un documento registrado a mitad del pre-registro sigue con la verificacion (SAVEPOINT)", async () => {
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "55443322" });
    await choose("Acepto");
    for (const value of ["Ana", "Paz", "1990-03-07", "3001234567"]) {
      await say({ text: value });
    }
    await choose("Omitir");
    await prisma.medicalRecord.create({
      data: {
        id: "mr-race",
        tenantId: world.tenantId,
        identifierSystem: "urn:hermes:patient",
        identifierValue: "MR-race",
        documentType: "CC",
        documentNumber: "55443322",
        givenNames: "Otra",
        familyNames: "Persona",
        birthDate: new Date("1980-01-01"),
      },
    });
    await choose("Confirmar");
    expect(body.messages[0]).toBe("Ese documento ya está registrado. Vamos a verificar tu identidad.");
    const actions = (await prisma.auditEvent.findMany()).map((a) => a.action);
    expect(actions).not.toContain("patient.pre_registered");
  });

  it("opcion de un turno anterior: 409 stale_option", async () => {
    const old = optionId(body, "Mis citas");
    await choose("Consultas generales");
    const response = await sendChat(token, { option_id: old });
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({ reason: "stale_option" });
  });

  it("idempotencia: misma clave repite; la misma clave desde otra sesion es 409", async () => {
    const key = randomUUID();
    const message = { option_id: optionId(body, "Mis citas") };
    const firstResponse = await (await sendChat(token, message, key)).json();
    const count = await prisma.conversationMessage.count();
    expect(await (await sendChat(token, message, key)).json()).toEqual(firstResponse);
    expect(await prisma.conversationMessage.count()).toBe(count);

    const other = await openChat(`wk_${"chat".repeat(43).slice(0, 43)}`);
    await getChat(other.token);
    expect((await sendChat(other.token, message, key)).status).toBe(409);
  });

  it("roles, sesion vencida y origen ajeno", async () => {
    const operator = await signToken({ role: "operator", tenantId: world.tenantId });
    expect((await getChat(operator)).status).toBe(403);
    expect((await getChat(token, { Origin: "https://otra.test" })).status).toBe(403);
    await prisma.widgetSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await getChat(token)).status).toBe(401);
  });
});
```

Run: `npm --prefix backend run test:db -- flujo-http` → PASS (8 tests). Si alguna etiqueta no coincide, el mensaje de `optionId` lista las disponibles.

- [ ] **Step 13: Aislamiento entre tenants**

En `backend/tests/db/aislamiento-tenant.test.ts` añade un `describe` (importa `enableWidget`, `openChat`, `getChat`, `sendChat` de `./chat-support` y `signToken` si no está):

```ts
describe("aislamiento-tenant: chat", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("un token con la sesion de otro tenant no alcanza esa conversacion", async () => {
    const a = await seedTenantDomain(prisma, "chat-a");
    const b = await seedTenantDomain(prisma, "chat-b");
    const session = await openChat(await enableWidget(prisma, a.tenantId, "chat-a"));
    await getChat(session.token);
    const forged = await signToken({ role: "widget", tenantId: b.tenantId, sessionId: session.sessionId, subject: `widget:${session.sessionId}` });
    expect((await getChat(forged)).status).toBe(401);
    expect((await sendChat(forged, { text: "hola" })).status).toBe(401);
    expect(await prisma.conversation.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });
});
```

(Si el archivo limpia la base en un `beforeEach` con otro nombre de variable para `prisma`, reutilízala.) Una sesión de otro tenant responde `401` porque la sesión no existe para ese tenant, igual que en `refresh`; queda anotado en la §9 de la spec (refinamiento 16).

Run: `npm --prefix backend run test:db -- aislamiento-tenant` → PASS.

- [ ] **Step 14: Puertas y commit**

Run: `npm run ci`, `npm run typecheck`, `npm test`, `npm --prefix backend run test:db` → todo en verde.

```bash
git add backend/src/modules/shared/infrastructure/prisma-savepoint.ts backend/src/modules/conversation/infrastructure backend/src/composition backend/src/composition-root.ts backend/src/http backend/src/app/api/v1/widget backend/openapi.json backend/tests/db/chat-support.ts backend/tests/db/flujo-http.test.ts backend/tests/db/aislamiento-tenant.test.ts frontend/src/api
git commit -m "feat(conversation): rutas del chat del widget con efectos en savepoint e idempotencia por sesion"
```

---

### Task 15: Gobernanza, documentación y cierre

**Files:**
- Modify: `GOBERNANZA.md` (§1.4, §1.5, §2.2, §5.1)
- Modify: `CLAUDE.md` (estado de la 3.3 y lista de suites)
- Modify: `docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md` (estado)

- [ ] **Step 1: `GOBERNANZA.md`**

- §1.4 (alcance del widget): añade «El widget alcanza `GET /widget/conversation` y `POST /widget/conversation/messages` de su propia sesión. Las rutas del widget responden CORS con el origen exacto si algún tenant lo admite; con token, un `Origin` distinto al de la sesión es `403`.»
- §1.5 (no divulgación): añade un párrafo:
  «Verificación de identidad: dos preguntas de un banco en código (`verification/domain/questions.ts`), con un par fijo por expediente que se guarda al sortearlo y solo se re-sortea tras verificar. A los `verification_max_attempts` fallos el documento queda bloqueado `verification_lock_minutes` y el chat ofrece un asesor. Las respuestas se comparan en memoria: nunca llegan a `conversation_messages`, `conversations.context`, `audit_events`, logs ni respuestas HTTP. Todo texto libre del paciente se guarda como `[redactado]` (también las consultas a la KB) salvo el documento, enmascarado (`CC ••••5678`); el resumen del pre-registro también se redacta. El hash de la petición del chat en `idempotency_keys` es un HMAC.»
- §2.2 (dependencias): añade «`conversation` solo importa `shared`, `auth` y `verification/domain`; las escrituras del chat son efectos que cumple `composition/conversation-effects.ts`, cada uno en un `SAVEPOINT`.»
- §5.1 (suites): añade `cors` y `flujo` con su alcance (motor, pasos, recorrido, HTTP).

- [ ] **Step 2: `CLAUDE.md`**

Cambia la viñeta de la 3.3 a:
```markdown
- **3.3 motor conversacional — implementada** en la rama `fase-3-3-motor-conversacional` (spec en `docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md`): conversaciones con historial redactado, verificación con banco de preguntas y par fijo, pre-registro, handoff-tickets (solo creación), CORS del widget y alta/baja de orígenes. 3.4 frontend (`/chat`, bandeja, KB, config): pendiente.
```
y quita la frase «Requisito de entrada de la primera que toque el widget: resolver CORS/proxy» (ya resuelto). En la lista de suites añade `cors`.

- [ ] **Step 3: Estado de la spec**

En la spec, la línea de estado pasa a «**implementada** en la rama `fase-3-3-motor-conversacional` (pendiente de merge por el usuario)».

- [ ] **Step 4: Verificación final**

Run, en orden, y confirma la salida de cada uno:
- `npm run ci` → «No fixes applied», sin errores.
- `npm run typecheck` → sin errores.
- `npm test` → todo verde (incluye `flujo-*`, `verificacion`, `pre-registro`, `fronteras`, `sin-ia`, `contrato-api`).
- `npm --prefix backend run test:db` → todo verde (incluye `flujo-http`, `cors`, `verificacion`, `pre-registro-handoff`, `conversacion-esquema`, `aislamiento-tenant`, `simetria-seed`).
- `wc -l backend/src/composition-root.ts backend/src/modules/conversation/domain/steps/*.ts` → ningún archivo de lógica pasa de 400.

- [ ] **Step 5: Commit**

```bash
git add GOBERNANZA.md CLAUDE.md docs/superpowers/specs/2026-10-02-fase-3-3-motor-conversacional-design.md
git commit -m "docs: gobernanza de verificacion, redaccion y CORS; estado de la 3.3"
```
