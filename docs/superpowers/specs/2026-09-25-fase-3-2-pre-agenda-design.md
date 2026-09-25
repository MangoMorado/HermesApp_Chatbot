# Fase 3.2 — Pre-agenda (diseño)

> Estado: **diseño aprobado**, pendiente de plan.
> Fuente del alcance: `ROADMAP.md` §Fase 3, entregables 6, 8 y 10; corte de sub-proyectos en la
> §1 de `2026-09-22-fase-3-1-tenant-listo-design.md`. Manda `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

La 3.2 deja lista la mecánica de **solicitudes** sobre la agenda: el chatbot aparta un cupo o
pide un cambio sobre una cita en firme, Hermes (hoy el simulador) aprueba o rechaza desde su
bandeja, y cupos y citas quedan coherentes en `public` y en `hermes_sim`. No hay chat: las
solicitudes nacen de un caso de uso de aplicación que consumirá el motor conversacional de la
3.3 (§4.3).

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Resolución sin FHIR | El chatbot expone el caso de uso «Hermes resuelve la solicitud»; en la 3.2 lo invoca el simulador en proceso; en la Fase 4 lo invoca el adaptador FHIR (`PUT Appointment`/`Task`) | Nada se tira en la Fase 4; el chatbot nunca confirma por sí mismo |
| Origen de las solicitudes | Solo el caso de uso y sus tests; sin ruta REST de creación ni solicitudes en el seed | El chat (3.3) es el único originador previsto; no abrir contrato que nadie pidió |
| Apartado atómico | `UPDATE` condicional `status='free'` + bloqueo `FOR UPDATE` de la historia clínica + índices únicos parciales | Correcto con el aislamiento por defecto, sin reintentos; la base se protege sola |
| Plazo del apartado | `request_hold_minutes`: 240 por defecto, rango 15–4320, recortado al inicio del cupo | Cubre una jornada de recepción con revisiones cada pocas horas |
| Tope de pendientes | `max_pending_requests_per_patient`: 2 por defecto, rango 1–5, cuenta solo `book` y `reschedule` vivas | Lo que acapara cupos es el apartado; cancelar no acapara |
| Cambios sobre una cita | Una sola solicitud viva (`reschedule` o `cancel`) por cita, por índice único parcial | Evita decisiones contradictorias de Hermes sobre la misma cita |
| Vencimiento | Al leer y al crear, con un `UPDATE` por conjunto; el barrido de la Fase 5 reutiliza el mismo caso de uso | Regla de gobernanza §3: Hermes nunca ve un apartado vencido como vigente |
| Orden en la bandeja | Primero escribe `hermes_sim`, después resuelve en el chatbot; si el chatbot rechaza por vencimiento, el simulador deshace lo suyo | Hermes es la fuente de verdad; el chatbot refleja su decisión |
| Errores | Sin códigos nuevos: `409 conflict` con `details.reason` | El contrato de errores REST no cambia |

## 3. Arquitectura del backend

### 3.1 Módulos

```
backend/src/modules/
  scheduling/        # se amplía: solicitudes, apartado, vencimiento, resolución
  hermes-simulator/  # se amplía: bandeja (listar, aprobar, rechazar)
backend/src/composition/
  pre-agenda-wiring.ts  # cableado nuevo; composition-root.ts ya va por 369 líneas
```

- `scheduling` no importa `bot-config`: declara el puerto `PreAgendaPolicy` y el composition
  root lo cumple con la lectura de parámetros efectivos de `bot-config`.
- `hermes-simulator` no importa `scheduling` ni ningún otro módulo del chatbot: declara el
  puerto `ChatbotRequestsGateway` y el composition root lo cumple llamando en proceso a los
  casos de uso de `scheduling`. En la Fase 4 ese adaptador se reemplaza por un cliente FHIR con
  token `service` y la bandeja no cambia. Lo vigila `fronteras`.
- El chatbot sigue sin conocer el simulador.

### 3.2 Modelo de datos (schema `public`)

Tabla nueva `appointment_requests`, con FK compuestas `(tenant_id, …)` como el resto del
esquema:

| Campo | Notas |
| --- | --- |
| `id`, `tenant_id` | UUID v7 del `IdGenerator` |
| `kind` | enum `appointment_request_kind`: `book` · `reschedule` · `cancel` |
| `status` | enum `appointment_request_status`: `pending` · `approved` · `rejected` · `expired` |
| `medical_record_id` | Paciente (`active` o `pre_registered`) |
| `slot_id` | Cupo apartado; obligatorio en `book`/`reschedule`, nulo en `cancel` |
| `appointment_id` | Cita en firme afectada; obligatoria en `reschedule`/`cancel`, nula en `book` |
| `expires_at` | `timestamptz`; ver §5.2 |
| `resolution_reason` | Solo en `rejected`: `slot_unavailable` · `declined` |
| `resulting_appointment_id` | Cita creada al aprobar `book`/`reschedule` |
| `created_at`, `resolved_at` | `resolved_at` se llena en `approved`, `rejected` y `expired` |

Restricciones (en SQL crudo dentro de la misma migración de Prisma, porque Prisma no las expresa):

- `CHECK` de forma: `book` ⇒ `slot_id` no nulo y `appointment_id` nulo; `reschedule` ⇒ ambos
  no nulos; `cancel` ⇒ `slot_id` nulo y `appointment_id` no nulo.
- `CHECK`: `resolution_reason` no nulo si y solo si `status = 'rejected'`.
- Índice único parcial `(tenant_id, slot_id) WHERE status = 'pending'`.
- Índice único parcial `(tenant_id, appointment_id) WHERE status = 'pending'`.
- Índices `(tenant_id, status, expires_at)` y `(tenant_id, medical_record_id, status)`.

La tabla no guarda nada propio de FHIR. En la Fase 4 una solicitud `pending` se expone como
`Appointment` `proposed` (`book`/`reschedule`) o `Task` (`cancel`).

## 4. Casos de uso y puertos (`scheduling`)

### 4.1 Dominio (`domain/appointment-request.ts`, sin I/O)

- Tipos `AppointmentRequest`, `AppointmentRequestKind`, `AppointmentRequestStatus`,
  `ResolutionReason`.
- `computeExpiresAt(now, holdMinutes, slotStart | null)`.
- `isLive(request, now)`: `status = 'pending'` y `now < expires_at`.
- `assertSlotBookable(slot, schedule, now)`: agenda activa y `start_at > now` (si no ⇒ `422`);
  cupo distinto de `free` ⇒ `409 slot_unavailable`. La garantía final ante carreras la da
  `holdSlot`, no esta comprobación previa.
- `assertAppointmentChangeable(appointment, medicalRecordId, now)`: `booked`, del paciente, futura.
- `assertBelowPendingCap(liveHolds, max)`.
- `resolutionEffects(request, outcome)`: lista de cambios sobre cupos y citas (§5.3).

### 4.2 Puertos (`domain/ports/`)

- `PreAgendaUnitOfWork.run(tenantId, medicalRecordId, work)`: abre transacción, bloquea la
  fila de la historia clínica (`SELECT … FOR UPDATE`; si no existe en el tenant ⇒ `not_found`)
  y entrega a `work` un `PreAgendaTx`:
  `getSlot`, `getSchedule`, `getAppointment`, `countLiveHolds`, `expireDueOnSlot`,
  `expireDueOnAppointment`, `holdSlot` (UPDATE condicional → `boolean`), `insertRequest`,
  `getRequestForUpdate`, `setSlotStatus`, `insertAppointment`, `setAppointmentStatus`,
  `markResolved`. Las reglas viven en aplicación y dominio; el adaptador Prisma solo ejecuta.
- `RequestExpirer.expireDue(tenantId, now)`: un `UPDATE` por conjunto que pasa a `expired` las
  pendientes con `expires_at <= now` y devuelve a `free` los cupos que tenían apartados.
- `AppointmentRequestReader`: `list(tenantId, filtro, cursor)` y `get(tenantId, id)`, con los
  datos de paciente, cupo y cita ya unidos (identificadores Hermes incluidos).
- `PreAgendaPolicy.read(tenantId)` → `{ holdMinutes, maxPendingHolds }`.
- Reutiliza `Clock`, `IdGenerator` y `AuditLog` de `shared`.

### 4.3 Casos de uso (`application/`)

| Caso de uso | Consumidor |
| --- | --- |
| `createAppointmentRequest(cmd)` | Motor conversacional (3.3) y tests |
| `resolveAppointmentRequest(tenantId, id, resolution)` | Bandeja del simulador (3.2); `PUT` FHIR (Fase 4) |
| `expireDueRequests(tenantId)` | Lecturas y creación; barrido (Fase 5) |
| `listAppointmentRequests`, `getAppointmentRequest` | Bandeja del simulador; búsquedas FHIR (Fase 4) |

`cmd` es una unión discriminada por `kind`, con `tenantId`, `medicalRecordId`, `actor` y
`slotId` y/o `appointmentId` según el `kind`. Devuelve la solicitud creada.

`resolution` es `{ outcome: "approved", appointmentIdentifier: HermesIdentifier }` (el
identificador se ignora en `cancel`) o `{ outcome: "rejected", reason: ResolutionReason }`.

**Contrato para la 3.3:** las firmas de `createAppointmentRequest` y los motivos de error de
§6 son estables; la 3.3 programa contra ellos.

`list-availability` y `list-schedule-slots`, que ya existen, llaman primero a
`expireDueRequests`.

## 5. Reglas de dominio

### 5.1 Creación

Dentro de `PreAgendaUnitOfWork.run` (paciente bloqueado):

1. `expireDueOnSlot` / `expireDueOnAppointment` sobre los recursos implicados.
2. `book`: `assertSlotBookable`; `assertBelowPendingCap`.
3. `reschedule`: `assertAppointmentChangeable`; cupo nuevo distinto del de la cita;
   `assertSlotBookable`; `assertBelowPendingCap`.
4. `cancel`: `assertAppointmentChangeable`.
5. `holdSlot` (si hay cupo): si devuelve `false` ⇒ `slot_unavailable`.
6. `insertRequest`. Una violación del índice parcial de cita ⇒ `appointment_change_pending`;
   del de cupo ⇒ `slot_unavailable`.
7. Auditoría del hecho (`appointment_request.created`).

### 5.2 Vencimiento

- `expires_at = min(now + request_hold_minutes, start_at del cupo)`; en `cancel` (sin cupo),
  `now + request_hold_minutes`.
- Una solicitud es vencida si `now >= expires_at`, esté o no marcada todavía.
- `expireDueRequests` se ejecuta antes de listar disponibilidad, cupos de agenda y bandeja, y
  sobre los recursos implicados al crear y al resolver.
- Vencer: `status = 'expired'`, `resolved_at = now`, cupo apartado → `free`.

### 5.3 Resolución

`resolveAppointmentRequest` bloquea la solicitud (`getRequestForUpdate`); si no está viva ⇒
`request_not_pending` (si venció, se marca `expired` antes de responder).

| Solicitud | `approved` | `rejected` |
| --- | --- | --- |
| `book` | cupo → `busy`; cita nueva `booked` con el identificador de Hermes | cupo → `free` |
| `reschedule` | cita vieja → `cancelled` y su cupo → `free`; cupo nuevo → `busy`; cita nueva `booked` | cupo nuevo → `free`; cita vieja intacta |
| `cancel` | cita → `cancelled`; su cupo → `free` | sin cambios |

Vencida equivale a `rejected` en efectos. Auditoría del hecho (`appointment_request.approved` /
`.rejected`), con el rol y el `sub` de quien resuelve.

## 6. Errores

| Situación | Respuesta |
| --- | --- |
| Cupo ya apartado, ocupado o tomado en la carrera | `409 conflict`, `details.reason = slot_unavailable` |
| Tope de pendientes alcanzado | `409 conflict`, `details.reason = pending_limit_reached` |
| La cita ya tiene una solicitud viva | `409 conflict`, `details.reason = appointment_change_pending` |
| Resolver una solicitud resuelta o vencida | `409 conflict`, `details.reason = request_not_pending` |
| Aprobar con un paciente que el simulador no conoce | `409 conflict`, `details.reason = patient_not_in_hermes` |
| Cupo pasado o de agenda inactiva; reprogramar al mismo cupo; cita no futura o no `booked` | `422 validation_failed` |
| Paciente, cupo, cita o solicitud de otro tenant | `404 not_found` |

## 7. Bandeja del simulador (`hermes-simulator`)

### 7.1 Puerto

`ChatbotRequestsGateway` (en `hermes-simulator/domain/ports`): `list`, `get`, `resolve`. Solo
intercambia identificadores de Hermes (paciente, cupo, cita), nunca ids de `public`.

### 7.2 Casos de uso (`application/inbox.ts`)

- `listInbox`: pendientes vivas vía gateway.
- `approveRequest(id)`:
  1. `get`; si no está `pending` ⇒ `request_not_pending`.
  2. En transacción de `hermes_sim`, busca el paciente por identificador; si falta ⇒
     `patient_not_in_hermes` (la 3.3 lo amplía con el pre-registro).
  3. `book`/`reschedule`: si el cupo del simulador no está `free`, Hermes decide:
     `resolve(rejected, slot_unavailable)` y responde **200** con la solicitud rechazada. Si está
     libre: cupo → `busy`, `SimAppointment` `booked` con identificador nuevo; en `reschedule`,
     la cita vieja → `cancelled` y su cupo → `free`.
  4. `cancel`: cita → `cancelled`, su cupo → `free`.
  5. Tras el commit, `resolve(approved, appointmentIdentifier)`. Si el chatbot responde
     `request_not_pending` (venció entre medias), deshace lo escrito en `hermes_sim` y responde
     `409 request_not_pending`.
- `rejectRequest(id)`: `resolve(rejected, declined)`.

### 7.3 Rutas (`/api/sim/v1`, solo `admin`, `404` con el simulador apagado)

| Método y ruta | Notas |
| --- | --- |
| `GET /inbox?cursor=&limit=` | Pendientes vivas; cursor, 50 por defecto, 200 máximo |
| `POST /inbox/{id}/approve` | `Idempotency-Key`; devuelve la solicitud resuelta (`approved` o `rejected` con motivo) |
| `POST /inbox/{id}/reject` | `Idempotency-Key`; devuelve la solicitud `rejected` (`declined`) |

Cada elemento: `id`, `kind`, `status`, `created_at`, `expires_at`; paciente (identificador,
tipo y número de documento, nombre); cupo (identificador, `start_at`, `end_at`); cita afectada
(identificador y horario). Datos de identificación, ningún dato clínico.

Declaradas en `openapi-sim.ts`; `openapi.json` y el cliente orval del simulador se regeneran.
Sin rutas nuevas en `/api/v1`: el único efecto visible en el panel es que un cupo apartado deja
de figurar libre en la disponibilidad.

## 8. Parámetros de `bot-config`

| Clave | Predeterminado | Rango |
| --- | --- | --- |
| `request_hold_minutes` | 240 | 15–4320 |
| `max_pending_requests_per_patient` | 2 | 1–5 |

Se añaden a `PARAM_SPECS`; no requieren migración (JSONB).

## 9. Gobernanza

`GOBERNANZA.md` documenta en la misma PR la política de apartado: plazo, recorte al inicio del
cupo, tope, qué cuenta para el tope y la regla de una solicitud viva por cita (criterio de
aceptación 5 de la Fase 3).

## 10. Pruebas

| Suite | Cobertura |
| --- | --- |
| `dominio` | `computeExpiresAt` (con recorte), `isLive`, validaciones de cupo, cita y tope, `resolutionEffects` por `kind` y resultado |
| `pre-agenda` (Postgres) | 10 creaciones paralelas sobre el mismo cupo ⇒ exactamente 1; 5 del mismo paciente sobre cupos distintos con tope 2 ⇒ exactamente 2; vencimiento al leer con reloj falso (el cupo reaparece libre; resolver una vencida ⇒ `request_not_pending`); efectos de cada resolución; bandeja por HTTP con coherencia `public` ↔ `hermes_sim` tras aprobar, rechazar y `slot_unavailable`; vencimiento durante la aprobación deshace `hermes_sim` |
| `aislamiento-tenant` | La bandeja de A no ve solicitudes de B; aprobar o rechazar una de B con token de A ⇒ `404` |
| `idempotencia` | `approve`/`reject` repetidos ⇒ misma respuesta y una sola cita; misma clave con otro cuerpo ⇒ `409` |
| `roles` | Bandeja solo `admin` (`operator`/`widget` ⇒ `403`); simulador apagado ⇒ `404` |
| `conocimiento-config` | Rangos de los dos parámetros nuevos |
| `fronteras` | `hermes-simulator` no importa módulos del chatbot |
| `contrato-api` | Rutas de la bandeja declaradas; `openapi.json` regenerado |

## 11. Frontend

Solo se regenera el cliente orval del simulador. La interfaz de la bandeja es de la 3.4.

## 12. Fuera de alcance

Chat, conversaciones, verificación y pre-registro (3.3); interfaz de la bandeja (3.4); FHIR
(Fase 4); barrido periódico (Fase 5); ruta REST de creación de solicitudes y solicitudes en el
seed.

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
