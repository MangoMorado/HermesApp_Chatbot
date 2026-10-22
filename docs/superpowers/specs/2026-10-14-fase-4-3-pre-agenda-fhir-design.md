# Fase 4.3 — FHIR: pre-agenda (diseño)

> Estado: **cerrada en `main`** mediante la [PR #11](https://github.com/MangoMorado/HermesApp_Chatbot/pull/11).
> Fuente del alcance: `ROADMAP.md` §Fase 4, entregables 3, 4 y 7, y el criterio 5. Corte de
> sub-proyectos en la §1 de `2026-10-13-fase-4-1-fhir-base-lectura-design.md`. Los hallazgos
> 15 a 17 de `docs/FHIR_R4_REVIEW.md` quedan cerrados aquí. Manda `GOBERNANZA.md` ante
> cualquier conflicto.
> Versión FHIR: **R4 (`4.0.1`)**.

## 1. Objetivo y corte

Hermes lee la pre-agenda por `/fhir` y la resuelve con un `PUT` por id. El chatbot sigue sin
confirmar citas: book y reschedule salen como `Appointment` `proposed`; cancel sale como
`Task`. Aprobar o rechazar llama a `resolveAppointmentRequest`.

| Sub-proyecto | Contenido | Entregables | Criterios |
| --- | --- | --- | --- |
| 4.1 Base y lectura | Cerrada en `main` | 1, 9, 11, 5 (lectura), 7 (`Slot`) | 7 (parcial), 5 (parcial) |
| 4.2 Escritura de maestros | Cerrada en `main` | 2, 5 (escritura), 6, 8 | 2, 3, 4, 6 |
| **4.3 Pre-agenda por FHIR** (esta spec) | Cerrada en `main` | 3, 4, 7 | 5 |
| 4.4 Simulador por FHIR | Cerrada en `main` (PR #12) | 10 | 1, 7 (cierre) |

No hay migración. El id de la cita en firme de un book o un reschedule pasa a ser el id de la
solicitud. `replaces` sale de `appointment_requests.appointment_id`.

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Identidad | El id del `Appointment` proposed y del `Task` es el de la solicitud. Al aprobar book o reschedule, la cita en firme se inserta con ese id | El `PUT` por id no puede cambiar el id del recurso |
| Extensión | `http://hl7.org/fhir/5.0/StructureDefinition/extension-Appointment.replaces` con `valueReference` a `Appointment/{id}`. Solo en reschedule. El literal vive en `profiles.ts` | Hallazgo 15. En R4 no existe `Appointment.replaces` |
| `Task` | `intent` fijo `proposal`. Viva `requested`, aprobada `completed`, rechazada `rejected`, vencida `cancelled`. `focus` es el `Appointment` que se cancela; `for` es el `Patient`. El motivo va en `statusReason` | Hallazgo 16 |
| Participantes | En `proposed`, el paciente va `accepted` y el profesional y el servicio `needs-action`. En cita en firme, los tres van `accepted` | Hallazgo 17. `participant.status` es 1..1 |
| Resolución | `PUT /fhir/Appointment/{id}` y `PUT /fhir/Task/{id}`. No hay `PUT` condicional de estos tipos. `booked` aprueba; `cancelled` rechaza. `completed` aprueba la cancelación; `rejected` la rechaza | El roadmap pide `PUT`, no actualización condicional |
| Identificador al aprobar | El cuerpo de un `Appointment` `booked` trae un identificador de negocio distinto de `urn:ingenius:appointment-request`, de los systems de documento y de `urn:ingenius:pre-registration`. Mientras la solicitud no está aprobada, el recurso se lee con `urn:ingenius:appointment-request\|{id}` | Hermes asigna el identificador de la cita en firme. El de la solicitud solo identifica la pre-agenda |
| Motivo | `slot_unavailable` solo si `cancelationReason` o `statusReason` trae ese código. Si no, `declined` | El cupo ocupado por Hermes ya se rechaza en la 4.2 al escribir el `Slot` |
| Lectura terminal | Book o reschedule rechazada o vencida se lee como `Appointment` `cancelled`. Cancel rechazada se lee como `Task` `rejected`; vencida, como `Task` `cancelled`. La aprobada no se duplica: la representa la cita en firme | El id sigue siendo legible y `status=proposed` o `requested` no las devuelve |
| Vencimiento | Antes de leer o resolver `Appointment` y `Task` se vence igual que en `Slot` | Criterio 5: cupo `free` y sin `proposed` ni `requested` |
| Cita en firme | `PUT` sobre una cita que ya no es una solicitud viva → `409`. Id de otro tenant o desconocido → `404` | Hermes distingue «ya resuelta» de «no existe», sin filtrar otro tenant |
| Maestros | El `PUT` condicional de los cinco tipos no cambia. `PUT /fhir/Patient/{id}` sigue en `405` | La 4.2 dejó el `PUT` por id para la resolución de la pre-agenda |
| Idempotencia y auditoría | `Idempotency-Key` obligatoria. Cada `PUT` aplicado añade `appointment.written_by_hermes` o `task.written_by_hermes`, además del evento de la resolución. Sin cuerpo | Gobernanza §1.5 y §1.6 |
| Cuerpo | Se ignoran `meta` (salvo que no se persiste), `text` y extensiones que no sean `replaces`. `modifierExtension` y un elemento con significado que no se guarda → `422`. Un campo guardado que no coincide con el recurso → `422` | La misma tolerancia que la 4.2 §10.2 |
| Dueño | `fhir` parsea y traduce. `scheduling` lee la unión y resuelve. El composition root cablea el puerto. `fhir` no importa `scheduling` | El mismo corte que la 4.1 y la 4.2 |

## 3. Arquitectura

`GET` de `Appointment` y `Task` vence y luego lee. La lectura de `Appointment` une citas en
firme con solicitudes `book` y `reschedule` que no están `approved`, ordenadas por inicio e
id, con `_count` y `_offset`. `Task` son solo las solicitudes `cancel`, ordenadas por el
inicio de la cita que cancelan.

`PUT` entra por el mismo envoltorio idempotente de la 4.2. El despacho distingue
`PUT /fhir/{Tipo}?identifier=` (cinco maestros) de `PUT /fhir/Appointment/{id}` y
`PUT /fhir/Task/{id}`. Dentro de la transacción: vencer, leer, validar el eco del cuerpo,
`resolveAppointmentRequest`, auditar `*.written_by_hermes` y devolver el recurso ya resuelto.

`Appointment` y `Task` declaran `update` con documentación de `PUT` por id,
`conditionalUpdate: false` y `updateCreate: false`. Los cinco maestros conservan
`conditionalUpdate: true` y la documentación del `PUT` condicional.

### 3.1 Qué se lee

| Recurso | Origen | Estado FHIR | Identificador |
| --- | --- | --- | --- |
| `Appointment` | Cita en firme | el de la fila | el de Hermes |
| `Appointment` | Solicitud `book` o `reschedule` pendiente | `proposed` | `urn:ingenius:appointment-request\|{id}` |
| `Appointment` | Esa solicitud `rejected` o `expired` | `cancelled` | el mismo |
| `Task` | Solicitud `cancel` pendiente | `requested` | el mismo system |
| `Task` | `approved` / `rejected` / `expired` | `completed` / `rejected` / `cancelled` | el mismo system |

`replaces` solo cuando la solicitud es `reschedule`: apunta a `appointment_id`. En la cita en
firme, sale de la solicitud cuyo `resulting_appointment_id` es esa cita.

Búsqueda de `Appointment`: `identifier`, `patient`, `slot`, `status`, `date`. Búsqueda de
`Task`: `identifier`, `status`, `focus`, `patient`.

### 3.2 Qué acepta el `PUT`

| Cuerpo | Efecto | Respuesta |
| --- | --- | --- |
| `Appointment` `booked` de una solicitud viva `book` o `reschedule` | Aprueba. El identificador del cuerpo queda en la cita en firme | `200` y el `Appointment` `booked` |
| `Appointment` `cancelled` de esa solicitud | Rechaza y libera el cupo | `200` y el `Appointment` `cancelled` |
| `Task` `completed` de una solicitud viva `cancel` | Aprueba: la cita pasa a `cancelled` y su cupo a `free` | `200` y el `Task` `completed` |
| `Task` `rejected` | Rechaza. La cita en firme no cambia | `200` y el `Task` `rejected` |

Otro `status` → `422`. El `id` del cuerpo puede faltar; si viene y no es el de la URL, `400`.
`intent` puede faltar; si viene y no es `proposal`, `422`.

## 4. Errores

`OperationOutcome` con `application/fhir+json`. El orden es el de la 4.2: rol, ruta, media
type, clave, cuerpo.

| Situación | Status | Código | `Allow` |
| --- | --- | --- | --- |
| Rol distinto de `service` | 403 | `forbidden` | |
| Id desconocido o de otro tenant | 404 | `not-found` | |
| `PUT /fhir/Appointment` o `PUT /fhir/Task` sin id | 405 | `not-supported` | `GET` |
| `PUT` por id de un maestro, o `PUT` condicional de `Appointment` o `Task` | 405 | `not-supported` | `GET` |
| `DELETE` de `Appointment` o `Task` | 405 | `not-supported` | `GET, PUT` |
| `Content-Type` distinto de `application/fhir+json` o `application/json` | 415 | `not-supported` | |
| JSON mal formado, `resourceType` distinto, `id` del cuerpo que no coincide, sin `Idempotency-Key` | 400 | `invalid` | |
| Query en un `PUT` por id | 400 | `not-supported` | |
| Estado no resoluble, identificador de negocio inválido, `intent` distinto de `proposal` | 422 | `processing` | |
| `modifierExtension`, elemento no guardado, o un campo que no coincide con el recurso | 422 | `structure` | |
| Solicitud que ya no está pendiente, o cita en firme | 409 | `conflict` | |
| Misma clave con otro cuerpo | 409 | `conflict` | |

## 5. Pruebas

`fhir-conformance` cubre la lectura de `proposed` y de `Task` `requested` (extensión solo en
reschedule, participantes del hallazgo 17), el `PUT` que aprueba o rechaza, la repetición
idempotente, el criterio 5 y un `metadata` que declara `update` por id solo en `Appointment`
y `Task`. `aislamiento-tenant` cubre el `GET` y el `PUT` de una solicitud de otro tenant. Los
tests de pre-agenda comprueban que la cita en firme usa el id de la solicitud.

No hay cambios en `/api/v1` ni en el frontend. No se regenera OpenAPI.

## 6. Cierre

Puertas: Biome, typecheck, tests unitarios y `test:db`. Documentación en la misma entrega:
`README.md` (la 4.3 es lo que está en curso) y `backend/AGENTS.md` (el `PUT` por id no se
marca como `writable`). `CLAUDE.md` y `ROADMAP.md` los edita quien cierra la fase.

## 7. Fuera de alcance

El cliente FHIR del simulador y la sincronización de maestros (4.4). `PUT` por id de
maestros, `PATCH`, borrado, `If-Match` y versiones. Barrido periódico (Fase 6).
Keycloak, Postman, OpenAPI y Swagger (Fase 5).
