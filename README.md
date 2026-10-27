# Chatbot Ingenius 360

Chatbot determinista de agenda clínica con dos superficies HTTP: REST `/api/v1` para el
widget y el panel, y FHIR R4 `/fhir` para la integración con Hermes.

- **Qué se construye y en qué orden:** [`ROADMAP.md`](ROADMAP.md)
- **Cómo se trabaja:** [`GOBERNANZA.md`](GOBERNANZA.md)

> Estado: Fases 1, 2, 3 y 4 cerradas. La Fase 4 va en cuatro sub-proyectos, todos en
> `main`: la 4.1 (PR #9), la 4.2 (PR #10), la 4.3 (PR #11) y la 4.4 (PR #12, simulador
> por FHIR). Sigue la Fase 5 (Keycloak). La Fase 6 es el endurecimiento y queda fuera
> del MVP.

## Requisitos

- Node 26 (ver `.nvmrc`)
- Docker con Compose (para Postgres)

## Arranque local

```bash
npm install            # tooling de la raiz (Biome)
npm run install:all    # dependencias de backend y frontend

cp .env.example .env               # variables de compose
cp backend/.env.example backend/.env

docker compose up postgres -d      # base de datos
npm --prefix backend run db:generate

npm --prefix backend run dev       # http://localhost:3001
npm --prefix frontend run dev      # http://localhost:3000
```

Comprobación rápida: `curl http://localhost:3001/api/v1/health` responde
`{"status":"ok","checkedAt":"..."}`.

## Base de datos

- Desarrollo: `DATABASE_URL` apunta a `chatbot_dev` (Postgres local de Laragon o `docker compose up postgres -d`).
- **Laragon / Postgres inestable (`0xC0000142`):** Windows mata un backend al fallar la carga de DLL y el postmaster apaga todo el cluster. Mitigaciones locales ya aplicadas/recomendadas:
  1. **Defender (imprescindible):** PowerShell **como Administrador** → `powershell -ExecutionPolicy Bypass -File backend\scripts\pg-defender-exclusions.ps1`
  2. Pulsar **Start All** en Laragon (o `npm --prefix backend run db:pg:start` = PATH limpio sin el `libpq.dll` de PHP). Estado/parar: `db:pg:status` / `db:pg:stop`.
  3. `autovacuum = off` en `C:\laragon\data\postgresql\postgresql.conf` (evita crashes del worker en idle; reactivar cuando esté estable).
  4. Binarios en `C:\laragon\bin\postgresql\postgresql` actualizados a **18.1** (backup en `postgresql-18.0-bak`).
- Migraciones: `npm --prefix backend exec prisma migrate dev` (desarrollo) · el contenedor ejecuta `prisma migrate deploy` al arrancar.
- Seed determinista de dos tenants: `npm --prefix backend run db:seed -- --anchor YYYY-MM-DD` (sin `--anchor`, usa hoy en `APP_TIMEZONE`). En el contenedor: `cd /app/tools && npm run db:seed`. Si falla a mitad de camino, se puede volver a correr: es idempotente por ancla y repara cualquier asimetría entre el chatbot y el simulador.
- Pruebas contra Postgres: `npm --prefix backend run test:db` usa `TEST_DATABASE_URL` (por defecto `postgresql://postgres@localhost:5432/chatbot_test`); la suite borra y recrea los schemas de esa base.

## Endpoints

| Ruta | Acceso | Qué hace |
| --- | --- | --- |
| `GET /api/v1/health` | público | Comprueba que el servicio responde |
| `GET /api/v1/me` | cualquier rol autenticado | Identidad efectiva del token |

Los errores siempre vienen como `{ error: { code, message, request_id, details? } }` con
cabecera `X-Request-Id`. Si el cliente manda `X-Request-Id`, se devuelve el mismo.

El contrato vive en [`backend/openapi.json`](backend/openapi.json), que se **genera**:

```bash
npm --prefix backend run openapi:generate
```

Se edita `backend/src/http/openapi.ts`, nunca el JSON. La suite `contrato-api` falla si el
JSON quedó desfasado o si hay una ruta de `/api/v1` sin declarar.

## Autenticación

Las identidades las administra un proveedor OIDC externo (el backend no firma tokens). El
backend verifica el JWT (RS256 o ES256, nunca `none` ni `HS*`) contra el JWKS del emisor
`OIDC_ISSUER`, con audiencia `OIDC_AUDIENCE`, en `Authorization: Bearer <token>`. Roles del
producto: `widget` · `operator` · `admin` · `service` · `platform`. Los nombres de los claims de
tenant y de roles son configurables (ver Variables).

El `tenant_id` sale **solo** del claim. Un recurso de otro tenant responde `404`, nunca
`403`. El rol `platform` no lleva tenant y solo alcanza `/api/platform/v1`.

- **Panel (`operator`, `admin`) y Hermes (`service`):** tokens del proveedor. En 5.1 el
  frontend de referencia usa tokens pegados a mano, obtenidos del laboratorio (ver abajo); el
  login OIDC con PKCE llega en la 5.2. El panel lo comprueba con `GET /api/v1/me`.
- **Plataforma (`platform`):** `POST /api/platform/v1/tenants` da de alta un tenant y acepta un
  `widget_client` opcional (`client_id` y `client_secret`).
  `PUT /api/platform/v1/tenants/{id}/widget-client` es idempotente y reemplaza las credenciales.
  El secreto se sella con AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`) y nunca se devuelve.
  `POST /api/platform/v1/tokens` ya no existe: la plataforma no emite tokens.
- **Widget:** `POST /api/v1/widget/sessions` (clave pública del tenant, `Origin` permitido)
  devuelve `{ access_token, expires_at, conversation_secret, session_expires_at }`. El token lo
  emite el proveedor con el cliente de widget de la clínica. Las llamadas de conversación
  envían `Authorization` y `X-Conversation-Secret`; cualquier fallo de conversación es `404`.
  `POST /api/v1/widget/sessions/refresh` es pública: toma `widget_key`, `X-Conversation-Secret`
  y `Origin`. Errores propios: `409 widget_not_configured` (la clínica no tiene cliente de
  widget) y `503 identity_unavailable` (el proveedor no responde o rechaza las credenciales).
- **Cierre de sesión:** `POST /api/v1/auth/backchannel-logout` (formulario `logout_token`)
  recibe el back-channel logout del proveedor. No lleva `Idempotency-Key`: es idempotente por
  naturaleza.

### Laboratorio del proveedor

```bash
npm --prefix backend run idp:lab
```

Construye el realm `chatbot-lab` en un Keycloak y sus clientes: `chatbot-platform`,
`widget-<tenant>`, `service-<tenant>`, `chatbot-reference-ui` (PKCE, back-channel logout) y
`chatbot-swagger`, más los usuarios `admin-<slug>` y `operator-<slug>`. Imprime las líneas
`OIDC_*` para pegar en `.env`. Variables del laboratorio: `IDP_ADMIN_URL`, `IDP_ADMIN_REALM`,
`IDP_ADMIN_CLIENT_ID`, `IDP_ADMIN_CLIENT_SECRET` (conexión de administración), `LAB_API_URL`,
`LAB_FRONTEND_URLS`, `LAB_USER_PASSWORD`, `LAB_SERVICE_SECRET` y `LAB_PUSH_WIDGET_CLIENTS`
(entrega los clientes de widget por `PUT …/widget-client`; activo por defecto).

> Pendiente de verificación: el laboratorio todavía no se ha ejecutado contra el servidor
> Keycloak real; solo está probado por pruebas automáticas.

`npm run demo` solo siembra datos: ya no firma tokens. El panel de tenants del simulador pide
un token `platform`.

### Integración con Hermes

Para que Hermes sea el proveedor de identidad de este servicio:

1. Emitir tokens con el contrato de claims (tenant en `tenant_id`, roles en `roles`), o
   configurar `OIDC_TENANT_CLAIM`, `OIDC_ROLES_CLAIM` y `OIDC_ROLE_MAP` para mapear los suyos.
2. Crear **un cliente de widget confidencial por clínica** y entregarlo con
   `PUT /api/platform/v1/tenants/{id}/widget-client`.
3. Registrar `<API>/api/v1/auth/backchannel-logout` como URL de back-channel logout de sus
   clientes interactivos, con sesión requerida, y listar sus audiencias en
   `OIDC_LOGOUT_AUDIENCES`.
4. En producción, Hermes obtiene su propio token `service` de su proveedor; este servicio nunca
   ve ese secreto.

## Widget del chat

Un solo widget con tres montajes; los tres hablan directo con el backend por CORS.

| Montaje | Cómo se usa | Origen que ve el backend |
| --- | --- | --- |
| Script | `<script src="https://<frontend>/widget.js" data-key="<clave>" data-api="https://<backend>" async></script>` | El del sitio del tenant |
| Iframe | `<iframe src="https://<frontend>/widget?key=<clave>"></iframe>` | El del frontend |
| Consola | `/chat` en el frontend | El del frontend |

El origen correspondiente debe estar en los orígenes permitidos del tenant (pantalla **Bot**).
En modo iframe no se controla qué sitio lo incrusta: la protección por origen es del modo
script. Los fragmentos listos para copiar están en la pantalla **Bot**.

- Si el origen no está registrado en ningún tenant, el chat muestra «No pudimos conectar con
  el chat…» (el preflight CORS falla), no un error de autorización.
- El widget requiere HTTPS (o `localhost`), porque usa `crypto.randomUUID`.

`widget.js` es generado (`npm --prefix frontend run build:widget`; lo hacen `dev` y `build`).
Para probar el script desde otro origen: `npm --prefix frontend run host:demo -- <clave>` y
abrir `http://localhost:4000` (con ese origen añadido a los permitidos).

### Orígenes en producción

Con `NODE_ENV=production` un origen válido es `https://host[:puerto]`. `http://localhost:3000`
no entra. El seed lo deja en `bot_configs.allowed_origins` y no lo pisa si la fila ya existe
(`createMany` + `skipDuplicates`).

`POST /api/v1/bot-config/allowed-origins` (el botón **Añadir este origen** de `/chat`) vuelve
a validar la lista completa. Si el primer valor guardado es inválido en producción, un alta
de un origen correcto responde `422` con
`allowed_origins.0 no es un origen valido (https://host[:puerto])`. El índice es el valor ya
guardado, no el que se está añadiendo.

Hay que reemplazar la lista, con rol `admin`, por el origen público del frontend (sin camino
ni barra final):

```bash
curl -X PATCH https://<backend>/api/v1/bot-config \
  -H "Authorization: Bearer <token-admin>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <uuid>" \
  -d '{"allowed_origins":["https://<frontend>"]}'
```

`<frontend>` es el origen de la consola (`/chat`) y del iframe. El del script es el sitio del
tenant, y va en la misma lista. Comprobación: `OPTIONS /api/v1/widget/sessions` con
`Origin: https://<frontend>` devuelve `Access-Control-Allow-Origin` con ese valor. Sin la
cabecera, el origen no está en ningún tenant.

Para sumar otro sitio se repite el `PATCH` con la lista entera. El botón de alta sigue
fallando mientras la lista guardada contenga un origen que producción rechaza.

## Docker

```bash
docker compose up --build
```

Levanta Postgres (con healthcheck), el backend en `3001` y el frontend en `3000`. El
frontend espera a que el backend esté sano. Las contraseñas en claro del compose son
provisionales hasta la Fase 6, donde salen del YAML versionado.

## Variables

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | backend | Conexión a Postgres (la lee `prisma.config.ts` y `src/config/env.ts`) |
| `TEST_DATABASE_URL` | backend (pruebas) | Base que usa el proyecto Vitest `db`; la suite la borra y recrea en cada corrida |
| `APP_TIMEZONE` | backend | Zona de referencia para agenda y búsquedas FHIR |
| `OIDC_ISSUER` / `OIDC_AUDIENCE` | backend | Emisor y audiencia esperados del proveedor OIDC (obligatorias) |
| `OIDC_TENANT_CLAIM` | backend | Claim del tenant; por defecto `tenant_id`. Admite los sufijos `[]` y `{}` para listas y objetos |
| `OIDC_ROLES_CLAIM` | backend | Claim de roles; por defecto `roles` |
| `OIDC_ROLE_MAP` | backend | Mapa `externo=producto,…`; vacío significa identidad |
| `OIDC_CLOCK_TOLERANCE_SECONDS` | backend | Tolerancia de reloj; por defecto 30 |
| `OIDC_LOGOUT_AUDIENCES` | backend | Audiencias admitidas del `logout_token`, separadas por comas |
| `OIDC_MAX_TOKEN_LIFETIME_SECONDS` | backend | Vida máxima aceptada de un token; por defecto 300 |
| `CREDENTIALS_ENCRYPTION_KEY` | backend | 32 bytes en base64 (obligatoria): sella los secretos de widget. Genérala con `openssl rand -base64 32` |
| `HERMES_SIM_SERVICE_CLIENTS` | backend | JSON de clientes `service` del simulador por tenant; obligatoria solo con `HERMES_SIMULATOR_ENABLED=true`. Acepta `"*"` con `{tenant}` en el `client_id` |
| `TRUST_PROXY` | backend | `true` detrás de Traefik (Easypanel): el rate limit usa `X-Forwarded-For`, tomando el primer salto. Solo es seguro detrás de un proxy que **sobrescribe** la cabecera (Traefik por defecto); uno que la **añade** (p. ej. `$proxy_add_x_forwarded_for` de nginx) deja el límite evadible |
| `FHIR_BASE_URL` | backend | Base pública de `/fhir` para los enlaces y `fullUrl` de los `Bundle`, y destino del cliente del simulador. Debe ser una URL absoluta `http(s)` que **incluya** la ruta `/fhir` (p. ej. `https://api.clinica.com/fhir`); si no es una URL absoluta, el backend se niega a arrancar. Obligatoria cuando `HERMES_SIMULATOR_ENABLED=true` y `FHIR_GATEWAY=fetch`. Sin ella, y con el simulador apagado, los enlaces se construyen con el origen de la petición |
| `FHIR_GATEWAY` | backend | `fetch` (el proceso y `hermes:sync`) o `handlers` (las pruebas invocan `/fhir` sin abrir un puerto). Por defecto `fetch` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Credenciales del contenedor de Postgres |
| `BACKEND_URL` | frontend | URL del backend a la que el proxy `/api/*` reenvía; se lee en runtime (en Easypanel, la interna del servicio) |
| `PUBLIC_BACKEND_URL` | frontend | URL del backend alcanzable desde el navegador; la usa el widget del chat (CORS). Por defecto `http://localhost:3001` |

`process.env` solo se lee en `backend/src/config/env.ts`, `frontend/src/config/env.ts` y en configs de herramientas.

## FHIR

`/fhir` es la superficie de Hermes: R4, solo JSON y solo rol `service`. Expone lectura y
búsqueda de `Patient`, `Practitioner`, `HealthcareService`, `Schedule`, `Slot`,
`Appointment` y `Task`. Los cinco maestros admiten `PUT` condicional por `identifier`.
`Appointment` y `Task` se resuelven con `PUT` por id (pre-agenda: cita `proposed` o
cancelación). `Idempotency-Key` es obligatoria en cada escritura. `GET /fhir/metadata`
declara exactamente eso.

```bash
curl http://localhost:3001/fhir/metadata                 # publico: que existe
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/fhir/Slot?status=free&start=ge2026-06-15&_count=20"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/fhir/Patient/<id>

curl -X PUT "http://localhost:3001/fhir/Practitioner?identifier=urn:hermes:practitioner%7CP-1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -H "Idempotency-Key: <uuid>" \
  -d '{"resourceType":"Practitioner","identifier":[{"system":"urn:hermes:practitioner","value":"P-1"}],"active":true,"name":[{"text":"Dra. Ana Perez"}]}'
```

El token `service` lo emite el proveedor (cliente `service-<tenant>` en el laboratorio). El `PUT` crea con `201` o actualiza con `200`; repetir la misma clave y petición
devuelve la respuesta persistida. Los errores son `OperationOutcome` con
`application/fhir+json`; un parámetro de búsqueda no declarado en `metadata` responde `400`.

El simulador cierra el ciclo por esa superficie, no en proceso. Con el simulador encendido y
`FHIR_BASE_URL` apuntando al propio backend (en local, `http://localhost:3001/fhir`):

```bash
npm --prefix backend run hermes:sync
```

Sincroniza los maestros de `hermes_sim`, aprueba o rechaza la pre-agenda y confirma los
pre-registros. Un `409` al escribir un cupo apartado no aborta la corrida: se reintenta en la
siguiente. La bandeja del simulador usa el mismo cliente.

## Mapa del código

```
backend/
  prisma/schema.prisma        # modelos del chatbot (schema public) y del simulador (hermes_sim)
  prisma.config.ts            # URL de conexion (Prisma 7 la saco del schema)
  openapi.json                # contrato REST generado; no se edita a mano
  openapi-platform.json       # contrato de /api/platform/v1; generado
  src/app/                    # adaptadores de entrada HTTP (route handlers)
  src/http/                   # envoltura de errores, X-Request-Id, fuente del OpenAPI
  src/app/fhir/[[...path]]/   # unica ruta de /fhir; despacha contra el registro de recursos
  src/modules/fhir/           # perfiles, mappers, busqueda y registro FHIR (sin infrastructure)
  src/composition-root.ts     # unico punto que ensambla adaptadores con casos de uso
  src/config/env.ts           # unico punto que lee process.env
  src/modules/<contexto>/     # domain / application / infrastructure
  tests/                      # suites por comportamiento
frontend/
  src/app/                    # panel y consola; sin reglas de negocio
  src/app/api/[...path]/      # proxy same-origin hacia BACKEND_URL (sin CORS)
  src/api/, src/sim/          # clientes orval generados; no se editan a mano
  src/app/(console)/          # consola con cabecera: panel, conocimiento, bot, /chat, simulador
  src/app/(embed)/            # paginas sin cabecera: /widget (iframe)
  src/widget/                 # nucleo del chat: fetcher -> widget-api -> session -> chat-client -> interfaz
```

## Calidad

```bash
npm run ci          # biome ci en todo el monorepo
npm run typecheck   # tsc --noEmit en ambos proyectos
npm test            # Vitest en ambos proyectos
npm run doctor      # React Doctor en frontend/
```

Un solo test: `npm --prefix backend exec vitest run tests/fronteras.test.ts`, o por nombre
con `-t "<nombre>"`.

### Suites actuales

| Suite | Qué protege |
| --- | --- |
| `fronteras` | `domain` y `application` no importan framework, ORM ni `node:*`; el código fuente no nombra al proveedor de identidad |
| `contrato-api` | Envoltura de errores, `X-Request-Id` y OpenAPI sin desfase |
| `roles` | 401 sin token, `404` por tenant ajeno, alcance del widget |
| `dominio` | Reglas compartidas: tenant id, paginación por cursor, ajustes del tenant, datos del seed |
| `aislamiento-tenant` | La base impide referencias entre tenants; ajustes del tenant aislados |
| `simetria-seed` | El simulador y el chatbot parten de los mismos datos deterministas |
| `conocimiento-config` | Esquema de `bot-config`, rotación de claves, KB y búsqueda por tokens |
| `alta-chatbot` | Alta de tenant con predeterminados y credenciales de widget de plataforma |
| `sesion-widget` | Clave pública, `Origin`, límite por IP, renovación e idempotencia sin JWT persistido |
| `idempotencia` | Repetición sin efectos duplicados en todas las escrituras |
| `sin-ia` | Ninguna dependencia ni import de IA o n8n |
| `flujo` | Motor, pasos, recorrido del chat y conversación por HTTP |
| `verificacion` | Banco de preguntas, par fijo, bloqueo y redacción |
| `pre-agenda` | Apartado atómico, tope, vencimiento y bandeja |
| `fhir-conformance` | Forma R4, búsqueda, `OperationOutcome`, `metadata` igual a lo implementado y vencimiento al leer |
| `hermes-simulador` | El simulador cierra maestros, pre-agenda y pre-registro solo por `/fhir` |
| `cors` | CORS del widget y alta / baja de orígenes |

`carga-basica` llega con la Fase 6. El inventario completo está en `GOBERNANZA.md` §5.1.
