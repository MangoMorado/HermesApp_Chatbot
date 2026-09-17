# AGENTS.md — raíz del monorepo

Mapa para cualquier agente que trabaje aquí. **Las reglas están en
[`GOBERNANZA.md`](GOBERNANZA.md); este archivo solo dice dónde está cada cosa.** Ante
cualquier duda de política, manda la gobernanza. El plan de fases está en
[`ROADMAP.md`](ROADMAP.md).

## Estructura

```
backend/    API REST /api/v1 + FHIR /fhir. Next.js (App Router) + Prisma + Postgres.
frontend/   Panel y consola de chat. Next.js. Sin reglas de negocio.
.github/    CI: biome, typecheck, tests, React Doctor.
```

Los dos proyectos tienen su propio `package.json` y su propio `AGENTS.md`. **No hay npm
workspaces a propósito:** no deben acoplarse. La raíz solo aporta Biome y scripts que
delegan con `npm --prefix`.

## Comandos desde la raíz

```bash
npm run install:all   # dependencias de ambos proyectos
npm run ci            # biome ci en todo el monorepo
npm run typecheck     # tsc --noEmit en ambos
npm test              # Vitest en ambos
npm run doctor        # React Doctor en frontend/
docker compose up     # Postgres + backend (3001) + frontend (3000)
```

## Antes de dar algo por terminado

Las puertas de calidad están en `GOBERNANZA.md` §5. En corto: `npm run ci`,
`npm run typecheck` y `npm test` en verde, más React Doctor si tocaste el frontend. Correr
el comando y mirar la salida, no suponerla.

## Límites

`GOBERNANZA.md` §8 los detalla. Los dos que más se olvidan:

- **No se abre una fase sin cerrar la anterior.** Si el roadmap no lo pide en la fase en
  curso, no se construye.
- **No se desactiva una regla ni un test para pasar una puerta.**
