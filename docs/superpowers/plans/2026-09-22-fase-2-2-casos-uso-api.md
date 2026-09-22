# Fase 2 · Sub-proyecto 2 — Casos de uso y API REST: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o subagent-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer lectura de agenda/historial y ajustes del tenant en `/api/v1`, más CRUD del simulador en `/api/sim/v1`, con OpenAPI, idempotencia HTTP y suites de dominio/aislamiento/roles/contrato.

**Architecture:** Módulos hexagonales `scheduling`, `patients`, `tenancy` (casos de uso) y `hermes-simulator` (aislado). Route handlers finos vía `privateRoute` / `idempotentRoute`; un composition root cablea Prisma + casos de uso. El simulador solo se registra si `HERMES_SIMULATOR_ENABLED=true`.

**Tech Stack:** Next 16 App Router, Prisma 7, Vitest, jose (token:dev), OpenAPI 3.1 generado.

**Spec:** `docs/superpowers/specs/2026-09-22-fase-2-dominio-persistido-design.md` (§4, §5, §8; fuera de alcance §7 frontend).

## Global Constraints

- Código/campos/rutas en inglés; comentarios y docs en español.
- `domain/` y `application/` no importan `next`, `@prisma/client`, `react` ni `node:*`.
- `process.env` solo en `config/env.ts` y configs de herramientas.
- Todo método de repositorio recibe `tenantId` explícito.
- Chatbot no importa `hermes-simulator`; simulador solo importa `shared` y `auth`.
- `widget` → `403` en rutas de dominio; recurso de otro tenant → `404`.
- Sin LLM/embeddings/RAG/n8n.
- Umbrales Clean Code de gobernanza.
- No commits automáticos salvo petición explícita del usuario.

## Mapa de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/http/error-codes.ts` | Añade `conflict` 409 |
| `src/http/idempotent-route.ts` | Envoltorio de escrituras con `Idempotency-Key` |
| `src/http/openapi.ts` + `openapi-sim.ts` | Contratos REST |
| `src/config/env.ts` | `HERMES_SIMULATOR_ENABLED` |
| `scripts/token-dev.ts` | Firma JWT de desarrollo |
| `src/modules/shared/domain/date-range.ts` | Parseo `from`/`to` + tope de rango |
| `src/modules/scheduling/**` | Lectura agenda/cupos/citas |
| `src/modules/patients/**` | Expedientes + historial |
| `src/modules/tenancy/application/**` | GET/PATCH settings |
| `src/modules/hermes-simulator/**` | CRUD + generate slots |
| `src/app/api/v1/**` | Rutas chatbot |
| `src/app/api/sim/v1/**` | Rutas simulador |
| `src/composition-root.ts` | Cableado |
| `tests/dominio/**`, `tests/db/**`, `tests/roles`, `contrato-api`, `fronteras` | Suites |

---

### Task 1: Infra HTTP — conflict, env, token:dev, date-range, idempotentRoute

**Files:**
- Modify: `src/http/error-codes.ts`, `src/http/errors.ts`, `src/config/env.ts`, `backend/.env.example`, `backend/package.json`, `scripts/generate-openapi.ts`
- Create: `src/http/idempotent-route.ts`, `src/modules/shared/domain/date-range.ts`, `scripts/token-dev.ts`
- Test: `tests/dominio/date-range.test.ts`, ampliar `tests/contrato-api` para conflict

**Produces:** `ConflictError` → `conflict`; `parseQueryRange(from,to,timezone,maxDays)`; `idempotentRoute`; `loadConfig().hermesSimulatorEnabled`; `npm run token:dev`.

- [ ] Step 1–5: TDD date-range; conflict en ERROR_CODES; env flag; token:dev; idempotentRoute con hash SHA-256 de method+path+body.

### Task 2: Módulo scheduling (dominio + puertos + fakes + casos de uso)

**Produces:** entidades Practitioner, HealthcareService, Schedule, Slot, Appointment; repositorios de lectura; use cases list*/getAvailability/listScheduleSlots/listAppointments; tests `dominio` con fake in-memory.

### Task 3: Módulo patients

**Produces:** MedicalRecord + puerto AppointmentHistory; findByDocument, getById, listAppointments; tests dominio.

### Task 4: Tenancy use cases + adaptadores Prisma scheduling/patients

**Produces:** getTenantSettings / updateTenantSettings (audit + idempotency vía HTTP); Prisma adapters.

### Task 5: Rutas `/api/v1` + OpenAPI chatbot

**Produces:** todas las rutas §5.1; schemas OpenAPI; composition root parcial; suites roles + aislamiento parcial.

### Task 6: Módulo hermes-simulator + rutas `/api/sim/v1` + openapi-sim

**Produces:** CRUD + slots:generate; 404 si flag off; 409 en DELETE con dependientes; suite idempotencia HTTP; fronteras.

### Task 7: Suites de cierre 2.2 y puertas

**Produces:** `dominio`, `aislamiento-tenant`, `idempotencia`, `contrato-api`, `roles`, `fronteras` verdes; `npm run ci`, typecheck, test, test:db.

## Cobertura de la spec (sub-proyecto 2)

| Spec | Task |
| --- | --- |
| §4.1 módulos scheduling/patients/hermes-simulator | 2–6 |
| §4.2–4.3 paginación y fechas | 1–2 |
| §5.1 `/api/v1` | 5 |
| §5.2 `/api/sim/v1` | 6 |
| §5.3 idempotentRoute | 1, 5–6 |
| §5.4 conflict 409 | 1 |
| §8 suites | 7 |
| token:dev (decisión §2) | 1 |
| HERMES_SIMULATOR_ENABLED | 1, 6 |
