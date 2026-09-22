# Fase 2 — Dominio persistido y APIs (diseño)

> Estado: aprobado en brainstorming el 2026-09-22. Fuente del alcance: `ROADMAP.md` §Fase 2.
> Manda `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

Modelo de datos y casos de uso de agenda e historial detrás de puertos, con un panel que
consume solo la API generada, y el módulo del simulador de Hermes con sus propios maestros.

La fase se ejecuta en **tres sub-proyectos**, cada uno con su propio plan en
`docs/superpowers/plans/` y cerrado con sus puertas en verde antes del siguiente:

1. **Persistencia base** — esquema y migraciones, puertos compartidos, adaptadores Prisma,
   seed, idempotencia y auditoría; suites `simetria-seed` y base de `aislamiento-tenant`.
2. **Casos de uso y API REST** — `/api/v1` (lectura + ajustes del tenant), `/api/sim/v1` de escritura, ambos
   OpenAPI; suites `dominio`, `aislamiento-tenant` completa, `idempotencia`,
   `contrato-api` y `fronteras` ampliadas.
3. **Frontend** — clientes orval, `/panel`, `/simulador`, pegado de token.

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Simulador | Módulo aislado `modules/hermes-simulator/` en el backend, schema Postgres `hermes_sim`, apagable por `HERMES_SIMULATOR_ENABLED` | Mismo contenedor y base; separación verificable por tests; se borra entero en producción |
| Expediente | Identidad + historial de citas. **Sin campos clínicos** | Los casos de uso no los necesitan; reduce superficie de no divulgación (§1.5) |
| Cupos | Filas explícitas, sin reglas de recurrencia en el chatbot. El simulador los genera sobre sus tablas | Hermes es dueño de la agenda y en Fase 4 empuja `Slot` por FHIR |
| Auth del frontend | Script `token:dev` firma JWT; el panel lo recibe pegado | La emisión de tokens es de la Fase 3; no se abre una puerta de emisión en el servidor |
| Módulos | Uno por contexto: `shared`, `tenancy`, `scheduling`, `patients`, `hermes-simulator` | Umbrales de tamaño y dependencias sin ciclos |
| Idempotencia | Desde esta fase en toda escritura (las del simulador) | GOBERNANZA §1.6 manda sobre el roadmap, que la ubicaba en Fase 3 |
| Identificador Hermes | Todo maestro y cita guarda `identifier_system` + `identifier_value`, únicos por tenant | Base del `PUT` condicional (Fase 4) y de `simetria-seed` |
| Citas | En Fase 2 el chatbot solo **lee** citas en firme; no las escribe | Las solicitudes son de la Fase 3; Hermes confirma (§1.2) |
| Tope de rango | `max_query_range_days` por tenant (defecto 31, entre 1 y 366), editable por `admin` desde el panel | Cada tenant decide su horizonte de consulta sin afectar a los demás |
| `conversations` | Se difiere a la Fase 3 junto con sus mensajes | Su forma depende del motor de flujo; ningún caso de uso de Fase 2 la usa |

## 3. Modelo de datos

IDs UUIDv7 generados por el puerto `IdGenerator` (ordenables: sirven de desempate en el
cursor). Todas las tablas de dominio llevan `tenant_id` y `created_at`/`updated_at`.
Identificador Hermes = par (`identifier_system`, `identifier_value`), único por
(`tenant_id`, `identifier_system`, `identifier_value`).

### 3.1 Schema `public` (chatbot)

| Tabla | Campos | Restricciones e índices |
| --- | --- | --- |
| `tenants` | `id`, `slug`, `name`, `max_query_range_days` | `slug` único; `max_query_range_days` entre 1 y 366, defecto 31. El claim `tenant_id` del JWT es `tenants.id` |
| `practitioners` | identificador, `name`, `active` | FK `tenant_id` |
| `healthcare_services` | identificador, `name`, `active` | FK `tenant_id` |
| `schedules` | identificador, `practitioner_id`, `healthcare_service_id`, `active` | FKs dentro del mismo tenant |
| `slots` | identificador, `schedule_id`, `start_at`, `end_at`, `status` | `status` ∈ `free`·`busy`·`busy_tentative`·`busy_unavailable`; índices (`tenant_id`,`schedule_id`,`start_at`) y (`tenant_id`,`status`,`start_at`); `end_at > start_at` |
| `medical_records` | identificador, `document_type`, `document_number`, `given_names`, `family_names`, `birth_date`, `phone`, `email`, `status` | `status` ∈ `active`·`pre_registered`; único (`tenant_id`,`document_type`,`document_number`) |
| `appointments` | identificador, `medical_record_id`, `schedule_id`, `slot_id`, `start_at`, `end_at`, `status` | `status` ∈ `booked`·`cancelled`·`fulfilled`·`noshow`; índices (`tenant_id`,`medical_record_id`,`start_at`) y (`tenant_id`,`schedule_id`,`start_at`) |
| `audit_events` | `tenant_id`, `actor_subject`, `actor_role`, `action`, `resource_type`, `resource_id`, `request_id`, `occurred_at` | Sin columnas de contenido: se registra el hecho, no el dato |
| `idempotency_keys` | PK (`tenant_id`, `key`), `actor_subject`, `method`, `path`, `request_hash`, `response_status`, `response_body`, `created_at` | Ver §5.3 |

Tipos de documento: `CC`, `TI`, `CE`, `PA`, `RC` (enum en dominio y en base).

### 3.2 Schema `hermes_sim` (simulador)

Las mismas seis entidades (`practitioners`, `healthcare_services`, `schedules`, `slots`,
`patients`, `appointments`) con los mismos campos e identificador Hermes. `tenant_id` es
texto **sin FK** a `public.tenants`: el simulador conoce el tenant como lo haría Hermes, sin
depender de las tablas del chatbot. En producción el schema se elimina completo.

## 4. Arquitectura del backend

### 4.1 Módulos

```
backend/src/modules/
  shared/            # Clock, IdGenerator (UUIDv7), TenantId, cursor de paginación
  tenancy/           # tenants
  scheduling/        # practitioners, services, schedules, slots, appointments (lectura)
  patients/          # medical_records + historial vía puerto AppointmentHistory
  hermes-simulator/  # maestros propios en hermes_sim, generador de cupos, CRUD
  auth/, health/     # existentes; el Clock de health se mueve a shared/
```

- Los puertos de consulta viven en `domain/` de cada módulo; **todo método recibe
  `tenantId` explícito** (§1.3).
- `patients` no importa `scheduling`: declara su puerto `AppointmentHistory` y su adaptador
  Prisma lee `appointments`.
- Ningún módulo del chatbot importa `hermes-simulator`; `hermes-simulator` solo importa
  `shared` y `auth`. Lo vigila `fronteras`.
- Un único cliente Prisma se construye en el composition root y se inyecta en los
  adaptadores. El composition root registra las rutas del simulador solo si
  `HERMES_SIMULATOR_ENABLED=true`.
- `config/env.ts` añade `HERMES_SIMULATOR_ENABLED` (por defecto `false`).

### 4.2 Paginación

Cursor opaco (base64url de la clave de orden + `id`). `limit` por defecto 50, máximo 200;
fuera de rango → `validation_failed`. Respuesta de lista: `{ data: [...], next_cursor:
string | null }`. Cursor malformado → `validation_failed`.

### 4.3 Fechas

`from`/`to` en ISO 8601. Con offset se usan tal cual; una fecha sin hora se interpreta
como el inicio del día en `APP_TIMEZONE` (`to` exclusivo). El rango máximo de consulta de
disponibilidad, agenda y citas es `max_query_range_days` del tenant del token (fuera →
`validation_failed`, con el tope vigente en `details`).

## 5. Contratos HTTP

### 5.1 `/api/v1` (chatbot)

Lectura para `operator` y `admin`; la única escritura es el ajuste del tenant. `widget` → `403 forbidden`. Recurso de otro tenant → `404`.

| Ruta | Descripción |
| --- | --- |
| `GET /practitioners` | Lista paginada; filtro `active` |
| `GET /healthcare-services` | Lista paginada; filtro `active` |
| `GET /schedules` | Filtros `practitioner_id`, `healthcare_service_id` |
| `GET /availability` | Cupos `free` en [`from`,`to`); filtros `healthcare_service_id`, `practitioner_id`, `schedule_id`; orden por `start_at` |
| `GET /schedules/{id}/slots` | Agenda: cupos en todos los estados en el rango |
| `GET /appointments` | Citas por `schedule_id` y rango |
| `GET /medical-records` | Búsqueda exacta por `document_type` + `document_number` |
| `GET /medical-records/{id}` | Detalle del expediente |
| `GET /medical-records/{id}/appointments` | Historial, orden `start_at` descendente |
| `GET /tenant-settings` | Ajustes del tenant del token (`operator`, `admin`) |
| `PATCH /tenant-settings` | Cambia `max_query_range_days`. Solo `admin`; exige `Idempotency-Key` y deja `audit_events` (`action` `tenant_settings.updated`, sin valores) |

### 5.2 `/api/sim/v1` (simulador)

Rol `admin`. Si `HERMES_SIMULATOR_ENABLED` no es `true`, toda ruta responde `404`. OpenAPI
propio en `backend/openapi-sim.json`, generado por el mismo script.

- CRUD (`GET` lista/detalle, `POST`, `PATCH`, `DELETE`) de `practitioners`,
  `healthcare-services`, `schedules` y `patients`. `DELETE` de un registro con dependientes
  (p. ej. una agenda con cupos o citas) → `409 conflict`; no hay borrado en cascada.
- `POST /schedules/{id}/slots:generate` con `from`, `to`, `duration_minutes`, franjas
  horarias por día de la semana. Omite cupos que se solapen con existentes; responde el
  número creado.
- Toda escritura exige `Idempotency-Key` (§5.3) y deja un `audit_events` con
  `resource_type` prefijado `sim.`.

### 5.3 Idempotencia

Cabecera `Idempotency-Key` obligatoria en escrituras (ausente → `validation_failed`).
Clave por (`tenant_id`, `key`). Primera vez: se ejecuta y se guarda estado y cuerpo de la
respuesta. Repetición con igual `request_hash` (método + ruta + cuerpo) → misma respuesta
sin re-ejecutar. Igual clave con distinto hash → `409 conflict`. Se implementa como
envoltura HTTP reutilizable (`idempotentRoute`) sobre un puerto `IdempotencyStore` con
adaptador Prisma; la escritura de negocio y el registro de la clave van en la misma
transacción.

### 5.4 Errores

Se añade `conflict` (`409`) a `ERROR_CODES`. El resto del contrato de errores no cambia.

## 6. Seed

- `npm --prefix backend run db:seed -- --anchor YYYY-MM-DD` (por defecto, hoy en
  `APP_TIMEZONE`).
- Un único módulo de datos describe los dos tenants (`clinica-norte`, `clinica-sur`), cada
  uno con 3 profesionales, 2 servicios, sus agendas, 14 días de cupos desde el ancla,
  5 pacientes (1 `pre_registered`) y citas pasadas `fulfilled` y futuras `booked` con su
  cupo `busy`.
- Dos escritores (chatbot → `public`, simulador → `hermes_sim`) consumen el mismo módulo.
- IDs fijos y fechas relativas al ancla: mismo ancla ⇒ mismo resultado. Es idempotente
  (upsert por identificador).

## 7. Frontend

- orval genera `src/api/` (desde `../backend/openapi.json`) y `src/sim/` (desde
  `../backend/openapi-sim.json`) con cliente fetch + TanStack Query. Código generado
  versionado; script `npm --prefix frontend run api:generate`.
- Pantalla de token: campo para pegar el JWT, guardado en `sessionStorage`, borrable. El
  script `npm --prefix backend run token:dev -- --tenant <id> --role <rol>` lo firma.
- `/panel`: disponibilidad, agenda de una agenda, búsqueda de expediente e historial. Los
  selectores de fecha limitan el rango con el tope que devuelve `GET /tenant-settings`
  (ayuda de forma; el backend decide).
- `/panel/ajustes` (solo `admin`): edita el tope de rango del tenant.
- `/simulador`: CRUD de maestros y «generar cupos».
- Solo validación de forma; ningún cálculo de negocio. Errores mostrados con `message` y
  `request_id` de la envoltura.

## 8. Pruebas

| Suite | Cubre | Contra |
| --- | --- | --- |
| `dominio` | Casos de uso: filtros, rangos, tope por tenant, cursor, límites 50/200, fechas en `APP_TIMEZONE` | Adaptadores en memoria |
| `aislamiento-tenant` | Toda ruta `/api/v1` con dos tenants: sin fugas en listas; ID ajeno → `404` | Postgres real |
| `simetria-seed` | Todo maestro de `hermes_sim` tiene gemelo en `public` (mismo identificador y campos) | Postgres real |
| `idempotencia` | Escrituras del simulador y `PATCH /tenant-settings`. Repetición → misma respuesta, sin duplicar filas ni auditoría; cuerpo distinto → `409` | Postgres real |
| `contrato-api` | Ampliada a ambos OpenAPI; ninguna ruta sin declarar | Sin base |
| `fronteras` | Ampliada: chatbot no importa `hermes-simulator` | Sin base |
| `roles` | Ampliada: `widget` → `403` en rutas de dominio; `PATCH /tenant-settings` y simulador solo `admin` | Sin base |

Las suites con Postgres leen `TEST_DATABASE_URL` y aplican migraciones en una base
dedicada. CI añade un servicio Postgres al job del backend.

## 9. Despliegue

- La imagen del backend incluye el CLI de Prisma; el arranque ejecuta
  `prisma migrate deploy` y luego el servidor.
- En Easypanel: `HERMES_SIMULATOR_ENABLED=true` en el entorno de pruebas; confirmar que
  existe la base `chatbot_hermes` antes del primer deploy; el seed se lanza a mano.
- El frontend recibe `NEXT_PUBLIC_API_BASE_URL` como build arg.

## 10. Criterios de aceptación (del roadmap)

1. `dominio` y `aislamiento-tenant` en verde.
2. El frontend no duplica reglas; solo llama a los clientes generados.
3. Cambiar el adaptador Prisma no exige tocar `domain` (puertos estables).
4. El seed deja dos tenants con datos coherentes.

## 11. Fuera de alcance

Emisión de tokens y login, conversaciones y mensajes, solicitudes y apartado de cupos,
vencimientos, FHIR y sincronización simulador → chatbot, rate limits, barrido periódico.
