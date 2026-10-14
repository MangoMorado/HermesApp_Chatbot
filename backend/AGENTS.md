# AGENTS.md — backend

Reglas en [`../GOBERNANZA.md`](../GOBERNANZA.md). Aquí solo el mapa.

## Dónde va cada cosa

```
src/app/                  Adaptadores de entrada HTTP (route handlers de Next).
src/app/fhir/[[...path]]/ Única ruta de /fhir. Despacha contra el registro de recursos.
src/http/                 Glue de los adaptadores HTTP: envoltura de errores REST, X-Request-Id,
                          envoltorios de ruta (REST y FHIR), fuente del OpenAPI. No es dominio.
src/composition-root.ts   Único punto que ensambla adaptadores con casos de uso.
src/config/env.ts         Único punto que lee process.env.
src/modules/<contexto>/   domain / application / infrastructure (ver src/modules/README.md).
prisma/                   Esquema. La URL de conexión vive en prisma.config.ts (Prisma 7).
scripts/                  Utilidades de build; se ejecutan con tsx.
tests/                    Suites por comportamiento, no por archivo.
openapi.json              Generado. No se edita a mano.
```

## Las dos superficies

`/api/v1` responde errores como `{ error: { code, message, request_id, details } }` con
cabecera `X-Request-Id`. `/fhir` responde `OperationOutcome` con `application/fhir+json`
(`src/http/fhir-route.ts`). **Nunca se mezclan:** `fhir-route.ts` no importa `errors.ts`.

## Al añadir un recurso o un parámetro de búsqueda FHIR

1. Los literales (systems, tags, value sets) van en `src/modules/fhir/domain/profiles.ts` y en
   ningún otro archivo.
2. Un mapper por recurso en `src/modules/fhir/domain/mappers/`; no se unifican.
3. Declara el recurso y sus parámetros en `src/modules/fhir/domain/registry.ts`. De ahí salen
   la validación de parámetros y `GET /fhir/metadata`: no se edita `metadata` por separado.
4. `fhir` no importa `scheduling` ni `patients`: añade el puerto en
   `fhir/domain/ports/sources.ts` y cúmplelo en `src/composition/fhir-wiring.ts`.
5. La suite `fhir-conformance` recorre `metadata` y exige un valor de muestra por parámetro
   (`tests/db/fhir-conformance-http.test.ts`, función `sampleValue`).

El simulador no importa `fhir`. Copia los literales que envía en
`src/modules/hermes-simulator/domain/fhir-contract.ts`; `tests/hermes/contrato-fhir.test.ts`
los compara con `profiles.ts`. La bandeja resuelve por ese cliente. `npm run hermes:sync`
sincroniza maestros y cierra el ciclo por HTTP contra `FHIR_BASE_URL`.

## Al añadir escritura FHIR

1. Añade el parser del cuerpo en `src/modules/fhir/domain/parsers/` y conserva el mapper de
   lectura como única salida del recurso.
2. Marca el recurso como `writable` (PUT condicional) o `updateById` (PUT por id de la
   pre-agenda) en `src/modules/fhir/domain/registry.ts`. De ahí salen el enrutado y
   `GET /fhir/metadata`.
3. Declara el writer en `src/modules/fhir/domain/ports/writers.ts` y conéctalo con el caso de
   uso del módulo dueño en `src/composition/fhir-wiring.ts`. `fhir` no importa ese módulo.
4. Toda escritura usa `Idempotency-Key` y responde con recurso FHIR u `OperationOutcome`;
   nunca con la envoltura REST.

## Al escribir una ruta nueva de /api/v1

1. Envuélvela con `publicRoute` o `privateRoute` de `src/http/route.ts`. Eso resuelve el
   `X-Request-Id`, aplica el rol y normaliza los errores.
2. Declárala en `src/http/openapi.ts` y corre `npm run openapi:generate`. La suite
   `contrato-api` falla si `openapi.json` quedó desfasado o si la ruta no está declarada.
3. El handler valida, delega en un caso de uso y serializa. Si crece más que eso, falta un
   caso de uso.

## Auth

El `tenant_id` sale **solo** del claim del token; `privateRoute` ya lo resuelve. Para
comprobar propiedad de un recurso usa `requireTenant`, que falla como `not_found` y no
como `forbidden`. Para el rol `widget`, `requireSession`.

## Comandos

```bash
npm run dev                # http://localhost:3001
npm test                   # Vitest
npm run typecheck
npm run openapi:generate   # regenera openapi.json
npm run db:generate        # prisma generate (necesita backend/.env)
```

Un solo test: `npx vitest run tests/roles.test.ts`, o por nombre con `-t "<nombre>"`.

## Fronteras

`domain/` y `application/` no importan `next`, `@prisma/client`, `react` ni `node:*`. Lo
vigilan la regla `noRestrictedImports` de `biome.json` **y** la suite `fronteras`. Si
necesitas algo de fuera desde el núcleo, la respuesta es un puerto, no una excepción.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
