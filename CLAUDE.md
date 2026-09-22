# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Documentación y comentarios en español; código, nombres de campos y rutas en inglés.

## Estado actual

**Fase 1 cerrada.** Docker se verificó desplegando backend y frontend en Easypanel (VPS, proyecto `mango`): health 200, `/me` 401 sin token y 200 con token válido. Easypanel levanta cada Dockerfile por separado, así que `docker-compose.yml` sigue sin ejecutarse de punta a punta; se dio por bueno. Están en pie: monorepo, hexágono con composition root, auth JWT con roles, contrato REST con envoltura de errores y `X-Request-Id`, OpenAPI generado, Biome + CI, Dockerfiles y compose, `AGENTS.md` y las skills del inventario.

**Fase 2 cerrada** (spec en `docs/superpowers/specs/2026-09-22-fase-2-dominio-persistido-design.md`): esquema `public` + `hermes_sim`, casos de uso de lectura de agenda/historial, ajustes del tenant, simulador CRUD, seed simétrico, panel y simulador en frontend con clientes orval, suites `dominio`, `aislamiento-tenant` (HTTP), `idempotencia` (HTTP), `simetria-seed` y `test:db` en CI. La emisión de tokens y el chat son de la Fase 3; hoy los JWT se firman con `token:dev` y se pegan en el panel.

Lo que aún no existe está descrito como destino, no como hecho. Verifica antes de asumir que un archivo o comando está.

`ROADMAP.md` es la fuente del plan: cinco fases en orden estricto (1→2→3→4→5), sin abrir una sin cerrar los criterios de aceptación de la anterior. Tanto `ROADMAP.md` como `GOBERNANZA.md` (Fase 1) viven en la raíz.

## No negociables (aplican a todo cambio)

- **Sin IA.** Ningún LLM, embeddings, RAG ni n8n, ni en dependencias ni en despliegue. El chatbot es una máquina de estados determinista; todo texto sale de la config del tenant, su base de conocimiento o datos de dominio.
- **Hermes es la fuente de verdad.** El servicio solo origina *solicitudes* y pre-registros; nunca confirma ni modifica una cita en firme.
- **Tenant solo del claim del JWT.** Nunca del body, query string ni header libre. Recurso de otro tenant → `404`, nunca `403`.
- **Rol `widget`** alcanza únicamente el chat de su propia sesión; jamás datos de dominio ni `/fhir`.
- **No divulgación.** No se persisten respuestas de verificación ni datos clínicos en mensajes, auditoría ni logs.
- **Idempotencia.** Toda escritura acepta `Idempotency-Key` persistida en base de datos.
- **Dos componentes separados.** Chatbot (se despliega) y simulador de Hermes (se apaga en producción). El chatbot no puede depender de nada del simulador que Hermes no ofrezca por FHIR.

`GOBERNANZA.md` (Fase 1) manda sobre skills y estilo: si una skill contradice la gobernanza, gana la gobernanza.

## Arquitectura

Monorepo con `backend/` y `frontend/` independientes, cada uno con su `package.json`, sin acoplamiento entre proyectos. Stack día 1: Next.js (App Router) + Prisma + Postgres.

**Hexágono desde v1.** Un módulo por contexto de negocio con `domain/` · `application/` · `infrastructure/`, dependencias siempre hacia adentro, y un único composition root que ensambla adaptadores concretos con los casos de uso. El árbol es `domain`/`application`/`infrastructure`, **no** un `adapters/` genérico, aunque alguna skill lo sugiera.

- `domain` y `application` no importan Next, Prisma ni `node:*` — lo bloquea una regla de Biome o un test de fronteras.
- Los route handlers de Next son adaptador de entrada: validan, autentican y traducen errores; no concentran reglas.
- Persistencia, reloj e IDs detrás de puertos; Prisma es solo el adaptador del día 1 (cambiarlo no debe tocar `domain`).
- El frontend no contiene reglas de negocio: consume el cliente generado desde OpenAPI (orval o equivalente), nunca editado a mano.

**Dos superficies HTTP sobre un mismo dominio, con contratos de error distintos:**

| Superficie | Consumidores | Errores |
| --- | --- | --- |
| REST `/api/v1` | widget, panel, chat | `{ error: { code, message, request_id, details } }` + `X-Request-Id` |
| FHIR R4 `/fhir` | Hermes (rol `service`) | `OperationOutcome` con `application/fhir+json` |

Nunca mezclar las envolturas. `GET /fhir/metadata` (CapabilityStatement) debe declarar **exactamente** lo implementado; perfiles y constantes FHIR viven en un solo módulo.

**Cómo se escribe una ruta REST:** se envuelve con `publicRoute` o `privateRoute` de `backend/src/http/route.ts` (resuelven `X-Request-Id`, aplican el rol y normalizan errores), y se declara en `backend/src/http/openapi.ts` seguido de `npm --prefix backend run openapi:generate`. `openapi.json` es generado: editarlo a mano rompe la suite `contrato-api`, que también falla si hay una ruta sin declarar. Para comprobar propiedad de un recurso, `requireTenant` — falla como `not_found`, nunca `forbidden`.

**Conceptos de dominio que atraviesan fases:** el apartado de cupo es atómico (`free` → `busy_tentative` en la misma transacción, dos solicitudes concurrentes nunca toman el mismo cupo); las solicitudes vencen y el vencimiento se evalúa **al leer** (también en lecturas FHIR de `Slot`, `Appointment` y `Task`), con barrido periódico adicional en Fase 5. Paginación REST por cursor (50 por defecto, 200 máximo); FHIR usa `_count`/`_offset`.

## Comandos

Desde la raíz (orquestan ambos proyectos; no hay npm workspaces a propósito):

```bash
npm run install:all   # dependencias de backend y frontend
npm run ci            # biome ci en todo el monorepo
npm run typecheck     # tsc --noEmit en ambos
npm test              # Vitest en ambos
npm run doctor        # React Doctor en frontend/
docker compose up     # Postgres + backend (3001) + frontend (3000)
```

Un solo test: `npm --prefix backend exec vitest run tests/fronteras.test.ts`, o `-t "<nombre>"`.
Prisma: `npm --prefix backend run db:generate`. Requiere `backend/.env` con `DATABASE_URL`.
Suites contra Postgres: `npm --prefix backend run test:db` (proyecto Vitest `db`, lee `TEST_DATABASE_URL`, destruye y recrea esa base). Seed: `npm --prefix backend run db:seed -- --anchor YYYY-MM-DD`.

Detalles de instalación que muerden: npm 12 bloquea los scripts de instalación, así que
`prisma` y `@prisma/engines` están aprobados en `allowScripts` de `backend/package.json`.
Si `biome` no produce salida, el binario se bajó truncado: borra `node_modules/@biomejs`
y reinstala (el `.exe` correcto pesa ~76 MB).

Las suites de Vitest se nombran por comportamiento, no por archivo: `contrato-api`, `roles`, `dominio`, `aislamiento-tenant`, `simetria-seed`, `flujo`, `verificacion`, `pre-agenda`, `conocimiento-config`, `idempotencia`, `sin-ia`, `fhir-conformance`, `hermes-simulador`, `carga-basica`.

## Puertas de calidad por PR

1. Biome, typecheck y tests relevantes en verde; React Doctor si tocas `frontend/`.
2. Si tocas `/api/v1`: OpenAPI regenerado y cliente del frontend sin edición manual.
3. Si tocas FHIR: `/fhir/metadata` y las suites de conformidad alineadas en la misma PR.
4. Si cambias política: actualiza `GOBERNANZA.md` en la misma PR.

Umbrales de Clean Code: complejidad cognitiva ≤ 15 por función, ≤ 40 líneas por función (sin blancos), ≤ 400 líneas por archivo de lógica, 0 ciclos de importación. `process.env` **solo** en `config/env.ts` (y configs de herramientas). DRY al tercer uso real; no unificar mappers FHIR de recursos distintos.

## Skills instaladas

En `.agents/skills/` (espejo en `.claude/skills/` y, para Copilot, `.github/skills/`) y fijadas en `skills-lock.json`, vía [skills.sh](https://skills.sh). El inventario canónico y los conflictos con la política del repo están en `GOBERNANZA.md` §6.

| Skill | Origen | Uso |
| --- | --- | --- |
| `dry-refactoring` | `kucherenko/jscpd` | Eliminar duplicación detectada por jscpd |
| `fhir-developer-skill` | `anthropics/healthcare` | R4: recursos, value sets, `OperationOutcome`, búsqueda |
| `find-skills` | `vercel-labs/skills` | Descubrir e instalar skills del ecosistema |
| `frontend-design` | `anthropics/skills` | Dirección visual distintiva (ligera) al construir UI |
| `grilling` | `mattpocock/skills` | Stress-test de planes y decisiones |
| `hexagonal-architecture` | `lexler/skill-factory` | Regla I/O vs. núcleo al trazar fronteras de capa |
| `impeccable` | `pbakaus/impeccable` | Diseño UI de producción: craft, critique, audit, polish, DESIGN.md |
| `nielsen-usability-heuristics` | `dembrandt/dembrandt-skills` | Revisión de usabilidad de UI |
| `security-best-practices` | `openai/skills` | Revisión de seguridad (JS/TS, Next.js) |

Actualizar: `npx skills update`. Reinstalar desde el lock: `npx skills experimental_install`. Refresco de Impeccable: `npx impeccable update`.

**Las skills orientan; gana la gobernanza.** En concreto: la skill hexagonal habla de una capa «adapters» — aquí esa capa se llama `infrastructure` y el árbol es `domain`/`application`/`infrastructure`. La skill FHIR asume escenarios clínicos genéricos; el alcance real lo fija el roadmap (Fase 4) y `/fhir/metadata` debe declarar exactamente lo implementado, ni más ni menos. Para UI, `impeccable` es la skill primaria de diseño; `frontend-design` es guía breve y cede ante `impeccable` (y ambas ante esta gobernanza: sin reglas de negocio en el frontend).

## SDD (Superpowers)

Obligatorio para cambios de arquitectura, fronteras de módulos, contrato REST/FHIR, idempotencia, roles o tenant. Opcional en bugfixes localizados y chores. Artefactos en `docs/superpowers/specs/` y `docs/superpowers/plans/`, con ledger en `.superpowers/sdd/`.
