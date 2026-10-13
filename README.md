# Chatbot Ingenius 360

Chatbot determinista de agenda clínica con dos superficies HTTP: REST `/api/v1` para el
widget y el panel, y FHIR R4 `/fhir` para la integración con Hermes.

- **Qué se construye y en qué orden:** [`ROADMAP.md`](ROADMAP.md)
- **Cómo se trabaja:** [`GOBERNANZA.md`](GOBERNANZA.md)

> Estado: Fases 1 y 2 cerradas. Fase 3 en curso: la 3.1 (emisión de tokens, sesiones del
> widget, `bot-config` y base de conocimiento), la 3.2 (pre-agenda) y la 3.3 (motor
> conversacional) están en `main`. La 3.4 (frontend del chat) está **implementada** en la rama
> `fase-3-4-frontend-chat`, con tests unitarios y puertas en verde; el recorrido manual en
> navegador y las suites de BD (`test:db`, también las de la 3.3) siguen pendientes.

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

JWT HS256 en `Authorization: Bearer <token>`. Claims: `sub`, `tenant_id`, `role`
(`widget` · `operator` · `admin` · `service`) y `session_id` para el widget.

El `tenant_id` sale **solo** del claim. Un recurso de otro tenant responde `404`, nunca
`403`. Los tokens de panel (`operator`, `admin`) y de servicio los emite
`POST /api/platform/v1/tokens` con `Authorization: Bearer <PLATFORM_SECRET>`; el alta de
tenants es `POST /api/platform/v1/tenants`. El widget obtiene su token abriendo una sesión en
`POST /api/v1/widget/sessions` con la clave pública del tenant. `token:dev` sigue disponible
en desarrollo y aborta con `NODE_ENV=production`.

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

## Docker

```bash
docker compose up --build
```

Levanta Postgres (con healthcheck), el backend en `3001` y el frontend en `3000`. El
frontend espera a que el backend esté sano. Las contraseñas en claro del compose son
provisionales hasta la Fase 5, donde salen del YAML versionado.

## Variables

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | backend | Conexión a Postgres (la lee `prisma.config.ts` y `src/config/env.ts`) |
| `TEST_DATABASE_URL` | backend (pruebas) | Base que usa el proyecto Vitest `db`; la suite la borra y recrea en cada corrida |
| `APP_TIMEZONE` | backend | Zona de referencia para agenda y búsquedas FHIR |
| `JWT_SECRET` | backend | Secreto HS256 de verificación (obligatorio) |
| `JWT_ISSUER` / `JWT_AUDIENCE` | backend | Emisor y audiencia esperados |
| `PLATFORM_SECRET` | backend | Secreto de la superficie de plataforma (≥ 32 caracteres). Sin él, `/api/platform/v1` responde 404 |
| `TRUST_PROXY` | backend | `true` detrás de Traefik (Easypanel): el rate limit usa `X-Forwarded-For`, tomando el primer salto. Solo es seguro detrás de un proxy que **sobrescribe** la cabecera (Traefik por defecto); uno que la **añade** (p. ej. `$proxy_add_x_forwarded_for` de nginx) deja el límite evadible |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Credenciales del contenedor de Postgres |
| `BACKEND_URL` | frontend | URL del backend a la que el proxy `/api/*` reenvía; se lee en runtime (en Easypanel, la interna del servicio) |
| `PUBLIC_BACKEND_URL` | frontend | URL del backend alcanzable desde el navegador; la usa el widget del chat (CORS). Por defecto `http://localhost:3001` |

`process.env` solo se lee en `backend/src/config/env.ts`, `frontend/src/config/env.ts` y en configs de herramientas.

## Mapa del código

```
backend/
  prisma/schema.prisma        # modelos del chatbot (schema public) y del simulador (hermes_sim)
  prisma.config.ts            # URL de conexion (Prisma 7 la saco del schema)
  openapi.json                # contrato REST generado; no se edita a mano
  openapi-platform.json       # contrato de /api/platform/v1; generado
  src/app/                    # adaptadores de entrada HTTP (route handlers)
  src/http/                   # envoltura de errores, X-Request-Id, fuente del OpenAPI
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
| `fronteras` | `domain` y `application` no importan framework, ORM ni `node:*` |
| `contrato-api` | Envoltura de errores, `X-Request-Id` y OpenAPI sin desfase |
| `roles` | 401 sin token, `404` por tenant ajeno, alcance del widget |
| `dominio` | Reglas compartidas: tenant id, paginación por cursor, ajustes del tenant, datos del seed |
| `aislamiento-tenant` | La base impide referencias entre tenants; ajustes del tenant aislados |
| `simetria-seed` | El simulador y el chatbot parten de los mismos datos deterministas |
| `conocimiento-config` | Esquema de `bot-config`, rotación de claves, KB y búsqueda por tokens |
| `alta-chatbot` | Alta de tenant con predeterminados y emisión de tokens de plataforma |
| `sesion-widget` | Clave pública, `Origin`, límite por IP, renovación e idempotencia sin JWT persistido |
| `idempotencia` | Repetición sin efectos duplicados en todas las escrituras |
| `sin-ia` | Ninguna dependencia ni import de IA o n8n |

Las demás (`flujo`, `verificacion`, `fhir-conformance`…) llegan con sus fases; están
listadas en `GOBERNANZA.md`.
