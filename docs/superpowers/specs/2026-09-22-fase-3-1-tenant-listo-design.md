# Fase 3.1 — Tenant listo para chatear (diseño)

> Estado: **implementada** en la rama `fase-3-1-tenant-listo` (pendiente de merge por el usuario).
> Fuente del alcance: `ROADMAP.md` §Fase 3, entregables 1, 2 y 7. Manda `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

La Fase 3 se ejecuta en cuatro sub-proyectos, cada uno con su spec o plan y sus puertas en
verde antes del siguiente:

| # | Sub-proyecto | Entregables del roadmap |
| --- | --- | --- |
| **3.1** | **Tenant listo para chatear** (este documento) | 1, 2, 7 |
| 3.2 | Pre-agenda: solicitudes, apartado atómico, vencimiento al leer, bandeja del simulador | 6, 8, 10 |
| 3.3 | Motor conversacional: conversaciones, flujo, verificación, pre-registro, handoff-tickets | 3, 4, 9 |
| 3.4 | Frontend: consola `/chat`, bandeja, páginas de KB y config | 5 (+ UI de 7 y 8) |

La 3.1 deja un tenant dado de alta con configuración, base de conocimiento y clave de widget,
tokens emitidos por el servidor y sesiones de widget abiertas. No hay chat todavía.

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Tokens de panel | Sin usuarios: un secreto de plataforma emite tokens `operator` · `admin` · `service` con `sub` libre | Mínimo suficiente para el MVP; sin gestión de contraseñas |
| Puerta de plataforma | Superficie HTTP `/api/platform/v1` con OpenAPI propio, autenticada con `PLATFORM_SECRET` | Operable en Easypanel sin shell y automatizable desde Postman (Fase 5) |
| Tenant en plataforma | La plataforma es un actor fuera de todo tenant; el tenant viaja en el cuerpo **solo** en esta superficie | La regla «tenant solo del claim» sigue intacta en `/api/v1` y `/fhir` |
| Clave del widget | Pública por naturaleza, se guarda en claro, rotación con gracia, `allowed_origins` | Un hash no protege una clave que está en el HTML; la gracia evita cortar el widget |
| `bot-config` | Documento tipado: `texts` (catálogo con predeterminados del dominio) + `params` (rangos validados), JSONB con forma definida en el dominio | Cada sub-proyecto añade sus claves sin migración |
| Base de conocimiento | Menú por categorías + palabras clave con coincidencia exacta de tokens normalizados | Determinista (sin IA) y útil tanto navegando como escribiendo |
| `tenant-settings` | No se toca | Es ajuste de dominio, no del bot |
| Emisión de tokens | No lleva `Idempotency-Key` ni se persiste su respuesta; se audita el hecho | Firmar un JWT no escribe dominio; ningún token en `response_body` |
| Sesión del widget | Idempotente guardando solo `{ session_id }`; la repetición re-firma el token | Idempotencia sin persistir credenciales |

## 3. Arquitectura del backend

### 3.1 Módulos

```
backend/src/modules/
  platform/     # actor de plataforma, alta de tenant, emisión de tokens de panel/servicio
  bot-config/   # esquema de texts/params, allowed_origins, claves del widget y rotación
  knowledge/    # entradas de la KB, normalización y búsqueda por tokens (funciones puras)
  widget/       # sesiones: apertura por clave + Origin, refresh, puerto RateLimiter
  auth/         # se amplía con el puerto TokenIssuer y su adaptador jose
```

- Los módulos nuevos solo importan `shared` y `auth` de otros módulos (lo vigila `fronteras`).
  Como `patients` con `AppointmentHistory`, cada uno declara el puerto que necesita y el
  composition root lo cumple con el caso de uso del módulo dueño:
  - `platform` declara `TenantProvisioning`; lo cumplen casos de uso de `bot-config` y `knowledge`.
  - `widget` declara `WidgetKeyResolver` y `WidgetSettingsReader`; los cumple `bot-config`.
- Ningún módulo nuevo importa `hermes-simulator` (lo vigila `fronteras`).
- `config/env.ts` añade `PLATFORM_SECRET` (opcional; ausente ⇒ superficie de plataforma
  apagada) y `TRUST_PROXY` (por defecto `false`).

### 3.2 Modelo de datos (schema `public`)

FK compuestas por tenant como en la Fase 2. IDs UUIDv7 por el puerto `IdGenerator`.

| Tabla | Campos | Restricciones |
| --- | --- | --- |
| `bot_configs` | PK `tenant_id`, `texts` jsonb, `params` jsonb, `allowed_origins` text[], `updated_at` | Solo se guardan los textos y params **sobrescritos**; los predeterminados viven en el dominio |
| `widget_keys` | `id`, `tenant_id`, `key`, `created_at`, `retired_at?`, `grace_until?` | `key` único global; una sola clave vigente por tenant (`retired_at` nulo, índice único parcial) |
| `knowledge_entries` | `id`, `tenant_id`, `category`, `question`, `answer`, `detail?`, `keywords` text[], `position`, `active`, `created_at`, `updated_at` | Índice (`tenant_id`, `category`, `position`) |
| `widget_sessions` | `id`, `tenant_id`, `origin`, `created_at`, `expires_at`, `last_seen_at` | **No se guarda la IP** |
| `platform_idempotency_keys` | PK `key`, `method`, `path`, `request_hash`, `response_status`, `response_body`, `created_at` | Sin tenant: el alta lo crea |

La clave del widget tiene la forma `wk_` + 32 bytes aleatorios en base64url.

## 4. Contratos HTTP

### 4.1 Plataforma `/api/platform/v1`

OpenAPI propio en `backend/openapi-platform.json`, generado por el mismo script. Autenticación
`Authorization: Bearer <PLATFORM_SECRET>`, comparada en tiempo constante. Secreto ausente o
incorrecto → `401`. `PLATFORM_SECRET` sin definir → `404` en toda la superficie.

| Ruta | Descripción |
| --- | --- |
| `POST /tenants` | `{ slug, name, allowed_origins? }` + `Idempotency-Key` (en `platform_idempotency_keys`) → `201 { tenant, widget_key }`. En una transacción: tenant, `bot_config` con predeterminados, tres entradas de ejemplo en la KB (horarios, ubicación, cómo agendar) y la primera clave. Slug existente → `409` |
| `GET /tenants` | Lista paginada por cursor |
| `POST /tokens` | `{ tenant_id, role, subject, ttl_minutes? }` → `{ token, expires_at }`. `role` ∈ `operator`·`admin`·`service`; `widget` → `validation_failed`. TTL por defecto 480 min (panel) / 60 min (servicio); topes 720 / 1440. Tenant inexistente → `404`. Sin `Idempotency-Key`; audita `token.issued` (sujeto y rol, nunca el token) |

### 4.2 REST `/api/v1`

Tenant siempre del claim. Escrituras con `Idempotency-Key` obligatoria y `audit_events` sin
valores. Recurso de otro tenant → `404`.

| Ruta | Roles | Descripción |
| --- | --- | --- |
| `GET /bot-config` | operator, admin | Textos efectivos (predeterminado + sobrescritos, con marca `overridden`), `params` efectivos, `allowed_origins`, clave vigente y clave en gracia con `grace_until` |
| `PATCH /bot-config` | admin | Parcial sobre `texts`, `params`, `allowed_origins`. Texto o param en `null` ⇒ vuelve al predeterminado. Audita `bot_config.updated` |
| `POST /bot-config/widget-keys/rotate` | admin | Crea clave vigente; la anterior queda en gracia `widget_key_grace_hours`. Si ya había una en gracia, muere al instante (máximo dos válidas). Devuelve la nueva clave. Audita `widget_key.rotated` |
| `GET /knowledge-entries` | operator, admin | Paginada por cursor (50/200); filtros `category`, `active`; orden `category`, `position`, `id` |
| `GET /knowledge-entries/{id}` | operator, admin | Detalle |
| `POST /knowledge-entries` | admin | Alta; audita `knowledge_entry.created` |
| `PATCH /knowledge-entries/{id}` | admin | Cambio parcial; audita `knowledge_entry.updated` |
| `DELETE /knowledge-entries/{id}` | admin | Borrado real; audita `knowledge_entry.deleted` |
| `POST /widget/sessions` | pública | `{ widget_key }` + `Origin` + `Idempotency-Key` → `201 { session_id, token, expires_at }` |
| `POST /widget/sessions/refresh` | widget | Renueva la sesión del claim (ventana deslizante de `widget_session_ttl_minutes`) → `{ token, expires_at }` |

Errores de `POST /widget/sessions`: clave inexistente, retirada o fuera de gracia → `401`;
`Origin` ausente o fuera de `allowed_origins` → `403`; exceso por IP → `429`. `allowed_origins`
vacío niega todo. `refresh` con sesión vencida → `401`.

El rol `widget` recibe `403` en toda ruta de dominio, KB y config.

### 4.3 Idempotencia de la sesión del widget

La sesión se abre sin actor autenticado: el ámbito de la clave de idempotencia es el tenant
resuelto por la clave del widget, y `actor_subject` es `widget:anonymous`. Se añade una
variante de `idempotentRoute` que persiste una **referencia** (`{ session_id }`) y reconstruye
la respuesta: en la repetición se re-firma un token para esa sesión si sigue vigente (si
venció → `401`). `refresh` usa la misma variante. Ningún JWT queda en `response_body`.

Como la apertura es anónima, quien conozca la clave pública y la `Idempotency-Key` de otro
navegador obtendría un token de esa sesión al repetir la petición. Por eso en esta ruta la
`Idempotency-Key` actúa como secreto del cliente: debe tener al menos 32 caracteres (el
widget usa `crypto.randomUUID()`), más corta → `validation_failed`, y nunca se registra en
logs.

El núcleo de idempotencia (reservar, ejecutar, completar, repetir) se extrae a
`http/idempotency-core.ts` y lo comparten tres ámbitos: tenant (`idempotentRoute`),
plataforma y sesión del widget (DRY al tercer uso).

### 4.4 Errores

Se añade `rate_limited` (`429`) a `ERROR_CODES`, con cabecera `Retry-After` en segundos.

## 5. Reglas de dominio

### 5.1 `bot-config`

| `params` | Defecto | Rango |
| --- | --- | --- |
| `widget_session_ttl_minutes` | 30 | 5–120 |
| `widget_sessions_per_ip_per_minute` | 10 | 1–100 |
| `widget_key_grace_hours` | 24 | 0–168 |
| `kb_max_results` | 3 | 1–10 |

`texts` de la 3.1: `welcome` y `kb_see_more_label`. Texto plano (sin HTML) de 1 a 1000
caracteres; único marcador admitido `{clinic_name}`, que sale de `tenants.name`. Clave
desconocida, marcador desconocido o valor fuera de rango → `validation_failed` con el campo en
`details`. `allowed_origins`: como máximo 20, cada uno origen exacto `https://host[:puerto]`
(se admite `http://localhost:*` fuera de producción).

La 3.2 y la 3.3 añaden sus claves con predeterminado en su propia PR.

### 5.2 Base de conocimiento

- Límites: `category` 1–60, `question` 1–200, `answer` 1–1000, `detail` ≤ 4000, `keywords`
  ≤ 20, 500 entradas por tenant (exceso → `validation_failed`).
- Normalización (pura): minúsculas → NFD sin diacríticos → todo carácter no alfanumérico a
  espacio → tokens → sin stopwords de una lista fija en español → sin duplicados. Las
  `keywords` se guardan normalizadas.
- Búsqueda (pura, consumida en la 3.3): `score` = tokens normalizados de la consulta presentes
  en `keywords`; solo entradas `active` con `score` > 0; orden `score` desc, `position`, `id`;
  como máximo `kb_max_results`.

### 5.3 Sesiones, tokens y límites

- `TokenIssuer` firma HS256 con `JWT_SECRET`, `iss`/`aud` actuales. Token de widget:
  `sub = widget:<session_id>`, claim `session_id`, expira con la sesión.
- Las rutas del widget comprueban además que la sesión siga vigente en la base (al leer).
- `RateLimiter` in-memory de ventana fija por IP. IP = primera entrada de `X-Forwarded-For`
  solo con `TRUST_PROXY=true`; si no, un único cubo común. Store compartido en la Fase 5.
- `token:dev` aborta con `NODE_ENV=production`.
- Auditoría del actor de plataforma: `actor_subject = platform`, `actor_role = platform`,
  `tenant_id` del tenant afectado.

## 6. Gobernanza

En la misma PR, `GOBERNANZA.md` añade: la superficie de plataforma como tercer actor fuera
de todo tenant (y por qué no contradice §1.3), que la clave del widget es pública, que la
emisión de tokens no persiste su respuesta idempotente, y las suites `sesion-widget` y
`sin-ia` en el inventario. `CLAUDE.md` alinea su lista de suites (incluida `alta-chatbot`).

## 7. Pruebas

| Suite | Cubre | Contra |
| --- | --- | --- |
| `alta-chatbot` | Alta crea tenant, config, KB y clave; repetición idempotente; slug duplicado → `409`; la primera clave abre sesión | Postgres real |
| `conocimiento-config` | Esquema de `bot-config` (rangos, claves y marcadores desconocidos, `null` restaura), combinación de textos, gracia con reloj falso, CRUD de KB, normalización y orden de búsqueda | Memoria + Postgres |
| `sesion-widget` | Clave vigente, en gracia y vencida; `Origin` permitido/rechazado/vacío; `429` + `Retry-After`; refresh propio; sesión vencida → `401` | Postgres real |
| `roles` | `widget` → `403` en KB y config; `operator` no escribe; plataforma sin secreto o incorrecto → `401`, sin configurar → `404`; `/tokens` rechaza `widget` | Sin base |
| `aislamiento-tenant` | KB y `bot-config` con dos tenants: sin fugas en listas, ID ajeno → `404` | Postgres real |
| `idempotencia` | Todas las escrituras nuevas; sesión del widget sin JWT en `response_body` | Postgres real |
| `sin-ia` | Falla si dependencias o imports incluyen paquetes de LLM, embeddings, vectores o n8n | Sin base |
| `contrato-api` / `fronteras` | Tercer OpenAPI; ninguna ruta sin declarar; módulos nuevos no importan el simulador | Sin base |

## 8. Frontend

Solo se regenera el cliente orval de `/api/v1` (puerta de calidad 2). Las páginas de KB,
config y `/chat` son de la 3.4. El panel sigue aceptando tokens pegados, ahora emitidos por
`POST /api/platform/v1/tokens`.

## 9. Despliegue

Easypanel: definir `PLATFORM_SECRET` (secreto largo aleatorio) y `TRUST_PROXY=true` en el
backend. La migración corre sola en el arranque (`prisma migrate deploy`).

## 10. Fuera de alcance

Chat y mensajes, motor de flujo, verificación, solicitudes y apartado de cupos, bandeja,
handoff-tickets, páginas de frontend, store compartido de rate limit, usuarios con contraseña.

## 11. Pendiente para 3.3/3.4

Ningún navegador puede abrir hoy una sesión de widget: el backend no envía cabeceras CORS y
el proxy del frontend no reenvía `Origin` ni `X-Forwarded-For` hacia `POST /widget/sessions`
(ni hacia el refresh y el chat que vendrán en 3.4). La 3.1 no lo implementa; queda como
requisito de entrada de la siguiente fase que toque el widget, con una decisión por tomar
entre dos caminos:

- CORS en el backend para `POST /widget/sessions` (+ refresh y chat): responder
  `Access-Control-Allow-Origin` con el origen admitido del tenant (validado contra
  `allowed_origins`), no un comodín.
- Que el proxy del frontend reenvíe `Origin` y `X-Forwarded-For` tal cual los recibió, y el
  backend siga resolviendo el origen desde esas cabeceras como hoy.
