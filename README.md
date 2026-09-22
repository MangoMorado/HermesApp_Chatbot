# Chatbot Ingenius 360

Chatbot determinista de agenda clínica con dos superficies HTTP: REST `/api/v1` para el
widget y el panel, y FHIR R4 `/fhir` para la integración con Hermes.

- **Qué se construye y en qué orden:** [`ROADMAP.md`](ROADMAP.md)
- **Cómo se trabaja:** [`GOBERNANZA.md`](GOBERNANZA.md)

> Estado: Fase 1 cerrada. Cimientos, auth por JWT, contrato REST y OpenAPI en pie; las
> imágenes Docker se verificaron desplegadas en Easypanel. No hay modelo de datos
> todavía: eso es la Fase 2.

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
`403`. La emisión de tokens llega en la Fase 3; por ahora se firman a mano para pruebas.

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
| `APP_TIMEZONE` | backend | Zona de referencia para agenda y búsquedas FHIR |
| `JWT_SECRET` | backend | Secreto HS256 de verificación (obligatorio) |
| `JWT_ISSUER` / `JWT_AUDIENCE` | backend | Emisor y audiencia esperados |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Credenciales del contenedor de Postgres |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | Base del backend |

`process.env` solo se lee en `backend/src/config/env.ts` y en configs de herramientas.

## Mapa del código

```
backend/
  prisma/schema.prisma        # adaptador de persistencia (modelo real: Fase 2)
  prisma.config.ts            # URL de conexion (Prisma 7 la saco del schema)
  openapi.json                # contrato REST generado; no se edita a mano
  src/app/                    # adaptadores de entrada HTTP (route handlers)
  src/http/                   # envoltura de errores, X-Request-Id, fuente del OpenAPI
  src/composition-root.ts     # unico punto que ensambla adaptadores con casos de uso
  src/config/env.ts           # unico punto que lee process.env
  src/modules/<contexto>/     # domain / application / infrastructure
  tests/                      # suites por comportamiento
frontend/
  src/app/                    # panel y consola; sin reglas de negocio
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

Las demás (`aislamiento-tenant`, `flujo`, `fhir-conformance`…) llegan con sus fases; están
listadas en `GOBERNANZA.md`.
