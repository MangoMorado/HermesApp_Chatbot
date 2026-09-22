# Fase 2 · Sub-proyecto 3 — Frontend panel y simulador: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Panel y simulador consumen solo clientes orval generados desde OpenAPI; pegado de JWT; sin reglas de negocio.

**Architecture:** orval (fetch + TanStack Query) genera `src/api/` y `src/sim/`. Pantallas App Router con validación de forma únicamente. Token en `sessionStorage`.

**Tech Stack:** Next 16, React 19, orval, @tanstack/react-query, Vitest, React Doctor.

**Spec:** `docs/superpowers/specs/2026-09-22-fase-2-dominio-persistido-design.md` §7.

## Global Constraints

- Sin reglas de negocio en el frontend.
- Clientes generados versionados; no editar a mano.
- Errores: mostrar `message` y `request_id`.
- Comentarios/UI en español; código en inglés.

## Tasks

### Task 1: orval + dependencias
- Añadir orval, @tanstack/react-query; scripts `api:generate`.
- Config orval para `openapi.json` → `src/api/` y `openapi-sim.json` → `src/sim/`.
- Generar clientes.

### Task 2: Auth de pegado de token
- Componente/página para pegar JWT, guardar/borrar en sessionStorage.
- Provider de query + fetch con Authorization Bearer.

### Task 3: `/panel`
- Disponibilidad, agenda, búsqueda de expediente + historial.
- Tope de rango desde `GET /tenant-settings`.

### Task 4: `/panel/ajustes` (admin)
- Editar `max_query_range_days` con Idempotency-Key.

### Task 5: `/simulador`
- CRUD maestros + generar cupos.

### Task 6: Puertas
- typecheck, test, biome, React Doctor.
