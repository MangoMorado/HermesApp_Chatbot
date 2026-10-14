# Fase 4.4 — Simulador por FHIR (diseño)

> Estado: **en implementación**.
> Fuente del alcance: `ROADMAP.md` §Fase 4, entregable 10 y criterios 1 y 7 (cierre). Corte de
> sub-proyectos en la §1 de `2026-10-13-fase-4-1-fhir-base-lectura-design.md`. El `409` de un
> cupo apartado se reintenta más tarde (spec 4.2 §10.7). Manda `GOBERNANZA.md` ante cualquier
> conflicto.
> Versión FHIR: **R4 (`4.0.1`)**. El servidor `/fhir` no gana interacciones.

## 1. Objetivo y corte

Hermes deja de resolver la pre-agenda en proceso. Un cliente HTTP con token `service` es el
único camino del simulador hacia el chatbot: la bandeja y un script que cierra el ciclo sin
clics. `hermes_sim` sigue siendo la base de Hermes. El CRUD `/api/sim/v1` no hace doble
escritura.

| Sub-proyecto | Contenido | Entregables | Criterios |
| --- | --- | --- | --- |
| 4.1 Base y lectura | Cerrada en `main` | 1, 9, 11, 5 (lectura), 7 (`Slot`) | 7 (parcial), 5 (parcial) |
| 4.2 Escritura de maestros | Cerrada en `main` | 2, 5 (escritura), 6, 8 | 2, 3, 4, 6 |
| 4.3 Pre-agenda por FHIR | Cerrada en el árbol | 3, 4, 7 | 5 |
| **4.4 Simulador por FHIR** (esta spec) | Cliente FHIR, sincronización de maestros, suite `hermes-simulador` | 10 | 1, 7 (cierre) |

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Dos consumidores | La bandeja conserva su REST. El script `hermes:sync` recorre el ciclo solo. Los dos usan el mismo cliente | El puerto ya decía que el gateway en proceso lo reemplaza un cliente FHIR. El criterio 1 pide el ciclo sin pasos manuales |
| Transporte | `fetch` contra `FHIR_BASE_URL` en el proceso que sirve y en el script. Las pruebas usan un transporte que invoca los handlers, sin abrir un puerto | El repo ya prueba `/fhir` llamando al handler. `FHIR_BASE_URL` es obligatoria cuando el simulador está encendido y el transporte es `fetch` |
| Token | JWT `service` del emisor actual, uno por tenant, sujeto `hermes-{tenantId}`, 15 minutos. Keycloak queda en la Fase 6 | El núcleo no cambia de verificador |
| Literales | El simulador copia en `fhir-contract.ts` los que tiene que enviar. No importa `fhir`. Un test de paridad los compara con `profiles.ts` | `fronteras` prohíbe que otro módulo importe `fhir`. Hermes no comparte el módulo del chatbot |
| Referencias | El `PUT` de `Schedule` y `Slot` usa el `id` que devolvió el `PUT` anterior, no el id de `hermes_sim` | El id interno de `public` lo asigna el servidor |
| Citas de `hermes_sim` | No se empujan como `Appointment`. La cita en firme nace al aprobar | El `PUT` condicional no existe para `Appointment` |
| Identificador al aprobar | `urn:hermes:appointment\|AP-{requestId}` | Repetir el `PUT` es idempotente. Si Hermes ya reservó y el proceso murió antes del `PUT`, la siguiente corrida reenvía y no rechaza por cupo ocupado |
| Transacción | Se confirma `hermes_sim` y después se hace el `PUT`. Si el `PUT` falla, se deshace lo escrito en Hermes | Un HTTP no cabe en la transacción de la 3.2. El orden deja a Hermes como fuente de verdad aunque el proceso se caiga en medio |
| Decisión | La de la bandeja de hoy: cupo libre reserva; si no, `slot_unavailable`; cancel solo si Hermes conoce la cita. El script no rechaza por `declined` | El script aplica la misma política, sin un operador |
| `409` de cupo | No aborta la corrida. Cuenta como reintento. `401`, `422` y `5xx` sí la abortan | Spec 4.2 §10.7 |
| Pre-registro | Después de la pre-agenda. `Patient?_tag=pre-registered`, `PUT` condicional sin el tag, identificador de negocio de Hermes | Spec 4.2: confirmar es escribir un `Patient` activo |
| Fechas de la bandeja | `created_at` y `expires_at` salen del `start` del cupo o de la cita | FHIR no los expone y esta entrega no cambia el servidor. El vencimiento real sigue al leer: `status=proposed` no devuelve una solicitud vencida |
| Auditoría | La escribe el `PUT`, como escrito por Hermes | El operador que pulsa la bandeja no es el actor FHIR |
| Paginación de la bandeja | El cursor REST codifica el desplazamiento sobre la lista ya unida de `Appointment` `proposed` y `Task` `requested` | El contrato REST no cambia de forma |

## 3. Arquitectura

```
backend/src/modules/hermes-simulator/
  domain/
    fhir-contract.ts          # copia de los literales que el cliente envía
    fingerprint.ts
    ports/fhir-http.ts        # FhirHttp y ServiceTokenIssuer
  application/
    service-tokens.ts
    fhir-gateway.ts           # ChatbotRequestsGateway sobre HTTP
    fhir-bodies.ts            # cuerpos PUT
    inbox.ts                  # decide, confirma hermes_sim, luego resolve
    hermes-sync.ts            # maestros, pre-agenda, pre-registro
  infrastructure/
    fetch-fhir-http.ts
    prisma-catalog.ts         # lectura de hermes_sim para el sync
    prisma-hermes-session.ts  # transacción que confirma antes del PUT
backend/src/composition/simulator-gateway.ts
backend/scripts/hermes-sync.ts
```

- `hermes-simulator` no importa `fhir`, `scheduling` ni `patients`.
- El composition root elige el transporte. `FHIR_GATEWAY=handlers` solo lo fijan las pruebas.
- El script siempre usa `fetch` y exige `FHIR_BASE_URL` y el simulador encendido.

### 3.1 Qué envía el cliente

| Acción | Petición |
| --- | --- |
| Pendientes | `Appointment?status=proposed` y `Task?status=requested`, páginas de 200 |
| Lectura | `GET /fhir/Appointment/{id}` y, si no existe, `GET /fhir/Task/{id}` |
| Aprobar book o reschedule | `PUT /fhir/Appointment/{id}` con `status=booked` y el identificador `AP-{requestId}` |
| Rechazar book o reschedule | `PUT` con `status=cancelled` y `cancelationReason` |
| Aprobar cancel | `PUT /fhir/Task/{id}` con `status=completed` |
| Rechazar cancel | `PUT` con `status=rejected` y `statusReason` |
| Maestro | `PUT /fhir/{Tipo}?identifier=system\|value` en el orden Practitioner, HealthcareService, Patient, Schedule, Slot |
| Pre-registro | `PUT /fhir/Patient?identifier=` del identificador de negocio, sin el tag |

`Idempotency-Key` de una resolución: `resolve:{requestId}:{outcome}` y, si rechaza, el motivo.
La de un maestro incluye una huella del cuerpo, así un cambio de datos no choca con la clave
anterior. `proposed` sin la extensión `replaces` es book; con ella, reschedule.

## 4. Orden de una corrida

1. Maestros. El `id` devuelto se guarda para las referencias siguientes. Un `Slot` que
   responde `409` se cuenta y se sigue. Cualquier otro error aborta.
2. Pre-agenda. Se listan las vivas y se aprueba cada una con la decisión de la §2. Si Hermes
   ya tiene la cita `AP-{requestId}`, no se vuelve a reservar: se reenvía el `PUT`.
3. Pre-registro. Por cada `Patient` con el tag, si `hermes_sim` tiene ese documento se usa su
   identificador; si no, `urn:hermes:patient|PR-{tipo}-{número}`.

La compensación de un `PUT` fallido borra la cita recién creada en Hermes y devuelve los cupos
y las citas previas a como estaban. Un rechazo por cupo ocupado no escribe en Hermes, así que
no hay nada que deshacer.

## 5. Errores

La bandeja sigue respondiendo la envoltura REST. El cliente traduce `404` a `NotFoundError` y
`409` de una resolución a `ConflictError` con `request_not_pending`. Un paciente o una cita que
Hermes no conoce siguen en `409` antes de escribir, como en la 3.2.

## 6. Pruebas

| Suite | Qué prueba |
| --- | --- |
| Unitaria del cliente | Cuerpos `PUT`, clasificación book / reschedule / cancel, clave de idempotencia |
| Unitaria de la bandeja | Identificador `AP-{id}`, compensación si el `PUT` falla, reintento si la cita ya existe |
| Unitaria del sync | Un `409` de `Slot` suma un reintento y la corrida sigue |
| Paridad | Los literales copiados coinciden con `profiles.ts` |
| `hermes-simulador` (`test:db`) | Los dos tenants: un maestro que solo está en `hermes_sim` aparece en `public`; book con cupo libre queda `booked` y repetir no duplica; book con cupo ocupado en Hermes queda `rejected` / `slot_unavailable`; cancel conocida deja la cita `cancelled` y el cupo `free`; un pre-registro queda `active` y sin tag; un `Slot` apartado con un cambio no permitido responde `409`, el inicio del cupo no cambia y la corrida termina; `metadata` no declara interacciones distintas de `read`, `search-type` y `update` |

La bandeja existente (`pre-agenda`, `idempotencia`, `aislamiento-tenant`) sigue pasando: ahora
resuelve por el transporte de handlers. Recorrido manual de `/simulador/bandeja`: aprobar y
rechazar.

## 7. Cierre

Puertas: Biome, typecheck, tests unitarios y `test:db`. Documentación en la misma entrega:
`README.md` (comando `hermes:sync` y `FHIR_BASE_URL` obligatoria con el simulador en modo
`fetch`), `backend/.env.example` y `backend/AGENTS.md`. `CLAUDE.md` y `ROADMAP.md` los edita
quien cierra la fase. Sin cambios de OpenAPI ni de frontend.

## 8. Fuera de alcance

Interacciones nuevas en `/fhir`. Doble escritura en el CRUD del simulador. Empujar las citas
de `hermes_sim`. Barrido periódico y Postman (Fase 5). Keycloak (Fase 6).
