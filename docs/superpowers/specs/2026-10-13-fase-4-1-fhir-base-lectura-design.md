# Fase 4.1 — FHIR: base y lectura (diseño)

> Estado: **cerrada en `main`** mediante la [PR #9](https://github.com/MangoMorado/HermesApp_Chatbot/pull/9).
> Fuente del alcance: `ROADMAP.md` §Fase 4, entregables 1, 9 y 11, la mitad de lectura del 5 y
> la parte de `Slot` del 7. Manda `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

La Fase 4 convierte `/fhir` en la integración con Hermes. Se parte en cuatro sub-proyectos, en
orden estricto, cada uno con su spec, su plan y su PR:

| Sub-proyecto | Contenido | Entregables del roadmap | Criterios |
| --- | --- | --- | --- |
| **4.1 Base y lectura** (esta spec) | Adaptador `/fhir`, `OperationOutcome`, módulo de perfiles, `metadata`, lectura y búsqueda de maestros y citas en firme | 1, 9, 11, 5 (lectura), 7 (`Slot`) | 7 (parcial), 5 (parcial) |
| 4.2 Escritura de maestros | `PUT` condicional de `Patient`, `Practitioner`, `HealthcareService`, `Schedule`, `Slot`; idempotencia; auditoría; conflicto de cupo; confirmación del pre-registro | 2, 5 (escritura), 6, 8 | 2, 3, 4, 6 |
| 4.3 Pre-agenda por FHIR | `Appointment` `proposed` con `replaces-appointment`, resolución por `PUT`, `Task` de cancelación, vencimiento al leer de ambos | 3, 4, 7 | 5 |
| 4.4 Simulador por FHIR | Cliente FHIR con token `service` en lugar del gateway en proceso, sincronización de maestros, suite `hermes-simulador` | 10 | 1, 7 (cierre) |

La 4.1 deja en pie la superficie `/fhir` en **solo lectura**: seis recursos con `read` y
`search-type`, errores como `OperationOutcome` y un `CapabilityStatement` que declara
exactamente eso. `/fhir/metadata` crece en cada sub-proyecto, siempre generado de lo que existe.

Supuesto de partida: no hay un contrato FHIR entregado por el equipo de Hermes. El simulador es
el contrato ejecutable (roadmap §4).

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Roles en `/fhir` | Solo `service`, en lectura y en escritura. `operator`, `admin` y `widget` reciben `403` | Superficie exclusiva de Hermes; una sola regla de rol. El panel sigue en `/api/v1` |
| `GET /fhir/metadata` | Pública, sin token | Lo espera FHIR R4 y no expone datos de ningún tenant; igual que `/api/v1/health` |
| Ubicación del código | Módulo `modules/fhir/` con `domain` y `application` | Todo FHIR bajo un mismo módulo |
| Cruce con el dominio | `fhir` declara sus puertos de lectura; el composition root los cumple con `scheduling` y `patients` | `fhir` no importa otros módulos de negocio; mismo patrón que `conversation` y `hermes-simulator` |
| Enrutado | Una ruta comodín `app/fhir/[...path]/route.ts` que despacha contra un registro de recursos | `metadata` sale del mismo registro que enruta: no puede divergir. Un tipo desconocido responde `OperationOutcome`, no el 404 de Next |
| `id` lógico | El id interno del recurso; el identificador Hermes va en `identifier` | Convención FHIR; el `PUT` condicional de la 4.2 busca por `identifier` |
| Estados | Mapeo uno a uno de `Slot.status` y `Appointment.status` | El esquema ya usa el vocabulario R4 |
| Pre-registro | `meta.tag` `pre-registered` y búsqueda `_tag` entran en la 4.1 | Si `Patient` se lee desde ya, un pre-registro sin marcar se confunde con un paciente confirmado |
| Parámetros desconocidos | `400` `not-supported`, no se ignoran | Hermes nunca debe creer que filtró cuando no fue así |
| Rango de fechas | Sin rango obligatorio ni `max_query_range_days` | Hermes sincroniza agendas completas; el tamaño lo acota `_count` |
| Paginación | `_count` (50 por defecto, máximo 200, se recorta) y `_offset`; `Bundle.total` | Entregable 1 del roadmap |
| Auditoría | La 4.1 no audita | Es solo lectura, como las lecturas REST; «escrito por Hermes» llega con la 4.2 |
| Proveedor de identidad | `/fhir` autentica por el puerto `TokenVerifier` existente | La Fase 5 (Keycloak) cambia el adaptador sin tocar esta superficie |

## 3. Arquitectura del backend

### 3.1 Módulos y archivos

```
backend/src/modules/fhir/
  domain/
    profiles.ts             # systems, URLs de perfil, tags y extensiones. Unico lugar con literales FHIR
    resources/              # tipos R4 del subconjunto expuesto
    mappers/                # un mapper puro por recurso, sin unificar
      patient.ts  practitioner.ts  healthcare-service.ts
      schedule.ts  slot.ts  appointment.ts
    search.ts               # parseo de token, reference, date con prefijo, _count, _offset
    operation-outcome.ts    # construccion de OperationOutcome
    bundle.ts               # Bundle searchset con total y enlaces
    registry.ts             # por recurso: interacciones y parametros de busqueda
    capability-statement.ts # CapabilityStatement generado del registro
    fhir-error.ts           # error del modulo con issue.code y estado HTTP
    ports/sources.ts        # un puerto de lectura por recurso
  application/
    read-resource.ts
    search-resources.ts
    get-capability-statement.ts
backend/src/composition/
  fhir-wiring.ts            # cumple los puertos de fhir con scheduling y patients
backend/src/http/
  fhir-route.ts             # envoltorio: autentica, exige service, application/fhir+json, OperationOutcome
backend/src/app/fhir/
  [...path]/route.ts        # unica ruta; despacha contra el registro
```

- `fhir` solo importa `shared` y `auth`. Ningún otro módulo importa `fhir`. Lo vigila `fronteras`.
- Los puertos de `fhir/domain/ports/sources.ts` declaran la forma de los registros que
  necesitan (`{ id, identifier, name, active }`, etc.). Las entidades de `scheduling` y
  `patients` cumplen esa forma por tipado estructural; donde no (ver §3.2) el wiring adapta.
- `fhir-route.ts` no comparte nada con `http/errors.ts`: las dos envolturas nunca se mezclan.
- `fhir` no tiene `infrastructure/` en la 4.1: no hace I/O propio.

### 3.2 Lecturas nuevas en `scheduling` y `patients`

Los repositorios actuales paginan por cursor y casi ninguno lee por id ni por identificador
Hermes. Se añaden puertos y adaptadores Prisma nuevos, sin tocar los que usa REST:

| Módulo | Lecturas nuevas |
| --- | --- |
| `scheduling` | Por id y búsqueda con desplazamiento de `Practitioner`, `HealthcareService`, `Schedule`, `Slot` y `Appointment`, con los filtros de la §4.2 |
| `patients` | Por id y búsqueda con desplazamiento de `MedicalRecord` por identificador (Hermes o documento) y por estado `pre_registered` |

- `shared/domain/pagination.ts` gana `OffsetPage<T> = { data, total }`.
- La lectura de `Appointment` devuelve además `practitionerId` y `healthcareServiceId` de su
  agenda, que el mapper necesita para `participant`.
- Todas reciben el `TenantId` como parámetro explícito (gobernanza §1.3).
- Sin migración de datos. Si alguna búsqueda necesita un índice, lo fija el plan.

### 3.3 Vencimiento al leer

`fhir-wiring.ts` ejecuta `expireDueRequests` del tenant antes de leer o buscar `Slot`. Un cupo
cuyo apartado venció se devuelve `free`. `Appointment` `proposed` y `Task` no existen aún en
FHIR: su vencimiento al leer es de la 4.3.

## 4. Contrato FHIR

Base: `/fhir`. Versión R4 (`4.0.1`), solo JSON. Toda respuesta, también los errores, lleva
`Content-Type: application/fhir+json` y la cabecera `X-Request-Id`.

### 4.1 Interacciones

| Interacción | Ruta | Recursos |
| --- | --- | --- |
| `capabilities` | `GET /fhir/metadata` | — (pública) |
| `read` | `GET /fhir/{Tipo}/{id}` | los seis |
| `search-type` | `GET /fhir/{Tipo}?…` | los seis |

No hay `vread`, `history`, `_include`, `_revinclude`, `_sort`, `_summary` ni `POST _search`.
`metadata` no los declara.

### 4.2 Recursos y parámetros de búsqueda

| Recurso | Origen | Contenido | Parámetros |
| --- | --- | --- | --- |
| `Patient` | `medical_records` | `identifier` (Hermes y documento), `name`, `birthDate`, `telecom`; `meta.tag` `pre-registered` si `status = pre_registered` | `identifier`, `_tag` |
| `Practitioner` | `practitioners` | `identifier`, `name`, `active` | `identifier`, `active` |
| `HealthcareService` | `healthcare_services` | `identifier`, `name`, `active` | `identifier`, `active` |
| `Schedule` | `schedules` | `identifier`, `active`, `actor` (profesional y servicio) | `identifier`, `actor`, `active` |
| `Slot` | `slots` | `identifier`, `schedule`, `status`, `start`, `end` | `identifier`, `schedule`, `status`, `start` |
| `Appointment` | `appointments` | `identifier`, `status`, `start`, `end`, `slot`, `participant` (paciente, profesional, servicio) | `identifier`, `patient`, `slot`, `status`, `date` |

- `Patient.identifier` lleva dos entradas: el identificador Hermes (`identifier_system` /
  `identifier_value`) y el documento, con un `system` por tipo de documento definido en
  `profiles.ts`. La búsqueda `identifier` coincide con cualquiera de las dos.
- `Appointment` expone solo citas en firme (`booked`, `cancelled`, `fulfilled`, `noshow`). Las
  solicitudes pendientes no aparecen hasta la 4.3.
- `Slot.status`: `free`, `busy`, `busy_tentative` → `busy-tentative`,
  `busy_unavailable` → `busy-unavailable`.
- El paciente es dato demográfico, no clínico: no rompe la no divulgación (gobernanza §1.5).

### 4.3 Reglas de búsqueda

- `identifier` exige `system|value`. Sin `system` → `400` `invalid`: el valor solo no es único.
- Las referencias son relativas (`Patient/{id}`), en los recursos y en los parámetros
  `schedule`, `patient`, `slot` y `actor`. `actor` acepta `Practitioner/{id}` o
  `HealthcareService/{id}`.
- `start` y `date` aceptan los prefijos `eq`, `ge`, `gt`, `le`, `lt` y se pueden repetir para
  formar un rango. Con offset se usan tal cual; una fecha sin hora es el día completo en
  `APP_TIMEZONE`, con `startOfDayInZone`.
- `active` acepta `true` o `false`. `status` acepta un valor del value set del recurso.
- `_tag` acepta `system|code`; el único tag que existe es `pre-registered`.
- Un parámetro que el registro no declara para ese recurso → `400` `not-supported`.
- Varios parámetros se combinan con `AND`.

### 4.4 Paginación y orden

- `_count`: 50 por defecto; un valor mayor a 200 se recorta a 200; no entero o menor que 1 →
  `400` `invalid`.
- `_offset`: 0 por defecto; no entero o negativo → `400` `invalid`.
- El `Bundle` es `searchset`, con `total` y enlaces `self`, `next` y `previous` cuando existen.
  Cada `entry` lleva `fullUrl` y `search.mode = match`.
- Orden estable: maestros y `Patient` por `id`; `Slot` y `Appointment` por inicio y luego `id`.

### 4.5 Tenant y existencia

El tenant sale solo del claim del token, en toda consulta. Un id inexistente o de otro tenant
responde `404` `not-found`, indistinguibles. Ninguna búsqueda devuelve recursos de otro
tenant, tampoco al filtrar por la referencia a un recurso ajeno (resultado vacío).

### 4.6 Errores

| Situación | HTTP | `issue.code` |
| --- | --- | --- |
| Sin token, inválido o vencido | 401 | `login` |
| Rol distinto de `service` | 403 | `forbidden` |
| Id inexistente o de otro tenant; tipo de recurso desconocido | 404 | `not-found` |
| Parámetro de búsqueda no soportado | 400 | `not-supported` |
| Valor de parámetro mal formado | 400 | `invalid` |
| Verbo no implementado sobre un recurso conocido | 405 | `not-supported` |
| Error no previsto | 500 | `exception` |

- Cada `issue` lleva `severity: error` y un `diagnostics` en español, sin detalle interno. El
  `401` no revela la causa.
- El cuerpo nunca es la envoltura REST `{ error: … }`.
- **Orden de comprobación:** autenticación y rol primero, enrutado después. Sin token
  `service`, cualquier ruta bajo `/fhir` responde `401` o `403` y nunca `404`, para que no se
  pueda sondear qué recursos existen. Única excepción: `GET /fhir/metadata`.

### 4.7 `CapabilityStatement`

Generado desde `registry.ts`: `fhirVersion` `4.0.1`, `kind` `instance`, `format` `json`,
`status` `active`, y un `rest` en modo `server` con, por recurso, sus interacciones y sus
parámetros de búsqueda con tipo (`token`, `reference`, `date`). Declara seguridad por token
portador, sin SMART. Es idéntico para todos los tenants.

## 5. Pruebas

| Suite | Proyecto | Qué prueba |
| --- | --- | --- |
| `fhir-conformance` (unitaria) | Vitest por defecto | Mappers contra la forma R4 (campos obligatorios, value sets de `status`, referencias relativas); parseo de búsqueda; `OperationOutcome` y `Bundle`; `CapabilityStatement` generado |
| `fhir-conformance` (HTTP) | `test:db` | `read` y `search` de los seis recursos con el seed; paginación con `total` y enlaces; cada fila de la §4.6; `Content-Type` en éxito y error; ninguna respuesta con la envoltura REST |
| `aislamiento-tenant` | `test:db` | Sobre `/fhir`: `read` de un id ajeno → 404; ninguna búsqueda devuelve recursos ajenos, tampoco por `identifier` ni por referencia a un recurso de otro tenant |
| `roles` | Vitest por defecto | `operator`, `admin` y `widget` → 403 `OperationOutcome`; sin token → 401; `metadata` sin token → 200 |
| `fronteras` | Vitest por defecto | `fhir` solo importa `shared` y `auth`; ningún módulo importa `fhir` |

Dos pruebas sostienen los criterios de la fase:

- **Metadata exacta (criterio 7).** Por cada interacción y parámetro que declara `metadata`,
  la prueba hace la petición y espera `200`; por cada parámetro no declarado, espera `400`.
- **Vencimiento al leer en `Slot` (criterio 5, parcial).** Con una solicitud vencida en base
  de datos, leer o buscar su `Slot` por FHIR lo devuelve `free`.

## 6. Cierre

**Puertas.** Biome, typecheck, tests unitarios y `test:db` en verde. No toca `/api/v1`:
`openapi.json` y los clientes orval no cambian. No toca `frontend/`: no aplica React Doctor.
Umbrales de Clean Code de la gobernanza §4, en particular 400 líneas por archivo de lógica y
`process.env` solo en `config/env.ts`.

**Documentación en la misma PR.**

- `GOBERNANZA.md` §3: `/fhir` es solo `service` en lectura y escritura; `metadata` es pública.
- `CLAUDE.md` y `AGENTS.md`: estado de la Fase 4, sus sub-proyectos y el módulo `fhir`.
- `README.md`: superficie `/fhir` y cómo probarla con un token `service`.
- `ROADMAP.md`: solo si hace falta reflejar el corte 4.1–4.4.

## 7. Fuera de alcance

Toda escritura FHIR (`PUT` condicional, idempotencia, auditoría) y la confirmación del
pre-registro (4.2); `Appointment` `proposed`, `Task` y sus vencimientos (4.3); el cliente FHIR
del simulador y la sincronización de maestros (4.4); el barrido periódico (Fase 6); Keycloak, la colección Postman, OpenAPI y Swagger (Fase 5).

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
