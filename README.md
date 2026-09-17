# Chatbot Ingenius 360

Chatbot determinista de agenda clínica con dos superficies HTTP: REST `/api/v1` para el
widget y el panel, y FHIR R4 `/fhir` para la integración con Hermes.

- **Qué se construye y en qué orden:** [`ROADMAP.md`](ROADMAP.md)
- **Cómo se trabaja:** [`GOBERNANZA.md`](GOBERNANZA.md)

> Estado: Fase 1 en curso. Los cimientos (monorepo, hexágono, calidad, Docker) están en
> pie; faltan auth y el contrato REST completo. No hay modelo de datos todavía.

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
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Credenciales del contenedor de Postgres |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | Base del backend |

`process.env` solo se lee en `backend/src/config/env.ts` y en configs de herramientas.

## Mapa del código

```
backend/
  prisma/schema.prisma        # adaptador de persistencia (modelo real: Fase 2)
  prisma.config.ts            # URL de conexion (Prisma 7 la saco del schema)
  src/app/                    # adaptadores de entrada HTTP (route handlers)
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
| `contrato-api` | Forma de la respuesta de `/api/v1/health` |

Las demás suites (`roles`, `aislamiento-tenant`, `flujo`, `fhir-conformance`…) llegan con
sus fases; están listadas en `GOBERNANZA.md`.
