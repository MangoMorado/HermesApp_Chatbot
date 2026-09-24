# Roadmap — Chatbot Ingenius 360

Plan de producto en **cinco fases**, desde repositorio vacío hasta MVP desplegable.
Arranca con hexágono, gobernanza, skills, puertas de calidad y Docker listos en la
primera versión.

> Última revisión: 22 de septiembre de 2026.

---

## 1. Propósito y supuestos

### 1.1 Premisas de plataforma (día 0)

| Premisa | Detalle |
| --- | --- |
| Monorepo | `backend/` y `frontend/` separados, cada uno con su `package.json`; sin acoplamiento entre proyectos |
| Hexágono desde v1 | `domain` / `application` / `infrastructure` + composition root; dependencias hacia adentro |
| Agnóstico de framework | Next.js solo en adaptadores HTTP / App Router; el núcleo no importa el framework |
| Agnóstico de ORM | Persistencia detrás de puertos; Prisma es el adaptador del día 1 |
| Stack día 1 | Next.js (App Router) + Prisma + **Postgres** |
| Gobernanza | `GOBERNANZA.md` se crea en la Fase 1 y manda sobre skills y estilo |
| Skills | Inventario en `GOBERNANZA.md` §6 y `skills-lock.json` (hexagonal, FHIR, security, frontend-design, dry-refactoring, nielsen, grilling, find-skills); vía skills.sh |
| Calidad | Biome (raíz + proyectos), React Doctor (frontend), CI en cada PR |
| Deploy | Dockerfiles multi-stage + compose con Postgres desde la Fase 1 |
| Principios | DRY (extraer al tercer uso), Clean Code (umbrales de gobernanza) |
| Dos superficies HTTP | REST `/api/v1` (widget, panel, chat) + FHIR R4 `/fhir` (Hermes). Un dominio, dos adaptadores de entrada |

### 1.2 No negociables de producto

- **Sin IA.** Ningún LLM, embeddings, RAG ni n8n. El chatbot es una máquina de estados determinista; todo texto sale de la configuración del tenant, de su base de conocimiento o de los datos de dominio.
- **Hermes es la fuente de verdad.** El servicio solo origina solicitudes y pre-registros; nunca confirma ni modifica una cita en firme por sí mismo.
- **Multitenancy por token.** El `tenant_id` se toma solo del claim del JWT. Nunca del body, del query string ni de un header libre. Recurso de otro tenant → `404`, nunca `403`.
- **Alcance del widget.** El rol `widget` solo alcanza el chat de su propia sesión; nunca datos de dominio ni `/fhir`.
- **No divulgación.** No se persisten respuestas de verificación ni datos clínicos en mensajes, auditoría o logs.
- **Idempotencia.** Toda escritura acepta `Idempotency-Key` persistida en base de datos.
- **Dos componentes.** Chatbot (se despliega) y simulador de Hermes (se apaga en producción). El chatbot no depende de nada del simulador que Hermes no vaya a ofrecer por FHIR.
- **Idioma.** Código y nombres de campos en inglés; textos de interfaz y comentarios en español.

### 1.3 Mapa documental

| Documento | Rol |
| --- | --- |
| `GOBERNANZA.md` | Cómo se trabaja; no negociables; FHIR; Clean Code; DRY; SDD; límites de agentes |
| `ROADMAP.md` | Este plan de fases y criterios del MVP |
| `README.md` | Arranque local, variables, Docker, mapa del código, suites |
| `AGENTS.md` (raíz y por proyecto) | Mapa del monorepo; apunta a gobernanza |
| `backend/openapi.json` + `GET /fhir/metadata` | Contrato ejecutable REST y FHIR |
| `docs/superpowers/specs/` y `plans/` | Spec y plan SDD de la tarea en curso |
| Suites de Vitest | Red de seguridad del comportamiento |

---

## 2. Las cinco fases

**Orden estricto:** 1 → 2 → 3 → 4 → 5. No se abre una fase sin cerrar el criterio de la anterior.

### Fase 1 — Cimientos y contrato base

**Objetivo:** desarrollar y desplegar con política, calidad y fronteras claras, antes de modelar el dominio clínico y de agenda.

**Entregables**

1. Estructura `backend/` + `frontend/` + raíz (Biome compartido, `.nvmrc`, CI, `docker-compose`).
2. `GOBERNANZA.md` con no negociables, FHIR, Clean Code, DRY, SDD, skills y límites de agentes.
3. Instalación e importación de skills (inventario canónico en `GOBERNANZA.md` §6 /
   `skills-lock.json`; viven en `.agents/skills/` y espejo en `.claude/skills/`):
   - hexagonal-architecture
   - fhir-developer-skill
   - security-best-practices
   - frontend-design
   - dry-refactoring
   - nielsen-usability-heuristics
   - grilling
   - find-skills  
   Las skills orientan; **gana la gobernanza** si hay conflicto.
4. Hexágono vacío: shell `domain` / `application` / `infrastructure` + composition root; Biome bloquea imports ilegales.
5. Auth: JWT, roles (`widget` · `operator` · `admin` · `service`), tenant solo del claim.
6. Contrato REST mínimo: envoltura de errores `{ error: { code, message, request_id, details } }`, `X-Request-Id`, `GET /api/v1/health`, OpenAPI generable.
7. Docker multi-stage para backend y frontend; compose con Postgres; healthcheck.
8. CI: `biome ci`, typecheck, React Doctor en frontend (falla = PR roja).
9. `AGENTS.md` en raíz y en cada proyecto; `README.md` de arranque.

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | `biome ci` y typecheck verdes en ambos proyectos |
| 2 | React Doctor pasa en `frontend/` |
| 3 | `GET /api/v1/health` responde en local y en contenedor |
| 4 | Request sin token → `401`; recurso de otro tenant → `404` |
| 5 | `domain` / `application` no importan Next, Prisma ni `node:*` (regla de Biome o test de fronteras) |
| 6 | `docker compose up` levanta Postgres + apps; secretos vía env (passwords en claro en el YAML solo como provisional hasta Fase 5) |

**Verificación:** suites `contrato-api` (mínima), `roles`, fronteras de capas.

---

### Fase 2 — Dominio persistido y APIs

**Objetivo:** modelo de datos y casos de uso de agenda/historial detrás de puertos; el panel consume solo la API generada.

**Entregables**

1. Esquema Postgres vía migraciones: expediente (`medical_records`), agenda, cupos materializados, conversaciones, auditoría (y lo necesario para multitenancy).
2. Puerto(s) de repositorio + adaptador Prisma; reloj e IDs por puertos.
3. Casos de uso: disponibilidad, agenda, historial clínico; paginación por cursor (50 por defecto, 200 máximo).
4. Seed multi-tenant determinista.
5. Frontend: CRUD de maestros del simulador / panel sin reglas de negocio; cliente OpenAPI (orval u equivalente) regenerado desde el backend.
6. OpenAPI al día con todas las rutas `/api/v1` de esta fase.

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | Suites de dominio y `aislamiento-tenant` en verde |
| 2 | Frontend no duplica reglas; solo llama al cliente generado |
| 3 | Cambiar el adaptador Prisma no exige tocar `domain` (puertos estables) |
| 4 | Seed deja al menos dos tenants con datos coherentes para pruebas |

**Verificación:** `dominio`, `simetria-seed`, `aislamiento-tenant`, regeneración OpenAPI sin diff manual en el cliente.

---

### Fase 3 — Chatbot, pre-agenda y configuración

**Objetivo:** MVP conversacional determinista y bandeja operativa. FHIR de escritura llega en la Fase 4.

**Entregables**

1. Emisión de tokens cerrada (ningún token sin credencial / secreto de plataforma según roles).
2. Sesión del widget; límites básicos (pueden ser in-memory; store compartido en Fase 5).
3. Motor de flujo determinista; textos desde config del tenant / KB / datos de dominio.
4. Verificación de identidad: bloqueo por documento, par fijo, redacción; nada de respuestas persistidas en mensajes ni auditoría.
5. Consola `/chat` en el frontend.
6. Pre-agenda: agendar, reprogramar y cancelar como **solicitudes**; apartado atómico `free` → `busy_tentative` en la misma transacción; vencimiento evaluado al leer.
7. Base de conocimiento CRUD; `bot-config` con rotación de clave; consultas generales con «ver más».
8. Bandeja del simulador: aprobar / rechazar solicitudes; coherencia de cupos y citas.
9. El flujo puede **crear** handoff-tickets (lectura y gestión de panel en Fase 5).
10. Idempotencia de escrituras en base de datos.

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | Flujo E2E en widget: identificación → verificación o pre-registro → agendar / reprogramar / cancelar / consultas / asesor |
| 2 | Dos solicitudes concurrentes nunca apartan el mismo cupo |
| 3 | Verificación resiste fuerza bruta según política; respuestas no se persisten |
| 4 | `aislamiento-tenant` cubre chat, bandeja y KB |
| 5 | Máximo de solicitudes pendientes y vencimiento del apartado documentados y probados |
| 6 | No hay dependencias ni código de LLM, embeddings, RAG ni n8n |

**Verificación:** `flujo`, `verificacion`, `pre-agenda`, `conocimiento-config`, `alta-chatbot`, `idempotencia`, `sin-ia`.

---

### Fase 4 — FHIR completo e integración Hermes

**Objetivo:** `/fhir` es la integración con Hermes (lectura + escritura); el simulador cierra el ciclo sin pasos manuales.

**Entregables**

1. Lectura FHIR R4 de los recursos del producto con `_count` / `_offset` y búsqueda alineada a zona `APP_TIMEZONE` donde aplique.
2. Escritura: actualización condicional (`PUT /fhir/{Recurso}?identifier=system|value`) para `Patient`, `Practitioner`, `HealthcareService`, `Schedule`, `Slot`. Solo rol `service`.
3. Pre-agendas como `Appointment` `proposed` (book/reschedule); extensión `replaces-appointment` en reschedule; resolución por Hermes con `PUT` (`booked` / `cancelled`).
4. `Task` para cancelaciones; resolución `completed` / `rejected`.
5. Pre-registro: `Patient` con `meta.tag` `pre-registered` y búsqueda `_tag`.
6. Conflictos: cupo marcado ocupado por Hermes → solicitud `rejected` / `slot_unavailable`.
7. Vencimientos en lecturas FHIR de `Slot`, `Appointment` y `Task` (expirar apartados antes de responder).
8. Auditoría de escrituras FHIR («recurso escrito por Hermes»).
9. `CapabilityStatement` (`GET /fhir/metadata`) declara **exactamente** lo implementado; perfiles y constantes en un solo módulo.
10. Simulador Hermes (script o job) que sincroniza maestros, lee pre-agendas, aprueba / rechaza y confirma pre-registro **solo por FHIR** con token `service`.
11. Errores FHIR = `OperationOutcome` + `application/fhir+json` (nunca la envoltura REST).

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | Simulador completa el ciclo sin pasos manuales |
| 2 | La misma actualización condicional dos veces → un solo recurso |
| 3 | Escritura FHIR con `operator` o `widget` → `OperationOutcome` `forbidden` |
| 4 | Hermes ocupa cupo apartado → solicitud `rejected` / `slot_unavailable` |
| 5 | Solicitud vencida leída por FHIR → cupo `free`, sin `Appointment` `proposed` |
| 6 | Escritura FHIR queda en auditoría como escrita por Hermes |
| 7 | `/fhir/metadata` coincide con lo existente (incluidas escrituras y `Task`) |

**Verificación:** `fhir-conformance`, `hermes-simulador`, `aislamiento-tenant` sobre `/fhir`.

**SDD:** obligatorio (contrato FHIR + fronteras del adaptador).

---

### Fase 5 — Endurecimiento y entrega

**Objetivo:** producción operable: límites, tickets, barrido, secretos y aceptación de despliegue.

**Entregables**

1. Rate limits (sesiones nuevas por IP, etc.) en **store compartido** (válido con varias réplicas); `Retry-After` en `429`.
2. `GET` / `PATCH /api/v1/handoff-tickets` (`operator` · `admin`) + página de panel.
3. Barrido periódico de solicitudes vencidas (además del vencimiento al leer).
4. Auditoría completa (campos y acciones definidos en gobernanza / política de producto).
5. Secretos fuera de `docker-compose.yml` (incluida password de Postgres); despliegue documentado en `README.md`.
6. Colección Postman: widget E2E, panel (bandeja, KB, config, tickets) y ciclo Hermes por FHIR, con ambos tenants.
7. Suite `carga-basica`: latencia y límites bajo concurrencia moderada.
8. Prueba de rutas `/api/v1` ↔ OpenAPI; revalidar higiene de Fase 1 (LF, CI).

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | Postman se ejecuta de punta a punta contra el entorno desplegado sin pasos manuales |
| 2 | Tests automatizados de ambos proyectos en verde |
| 3 | Checklist MVP de la sección 3 en verde |

**Paralelismo:** handoff-tickets, barrido y auditoría pueden avanzar en paralelo al pulido ops; la colección Postman cierra la fase (depende del ciclo Hermes de la Fase 4).

---

## 3. Calidad, hexágono, Docker y Definition of Done

### 3.1 Fronteras hexagonales

- Un módulo por contexto de negocio con `domain/`, `application/`, `infrastructure/`.
- HTTP (handlers de ruta) = adaptador de entrada: valida, autentica, traduce errores; no concentra reglas.
- Composition root único ensambla adaptadores concretos con casos de uso.
- Frontend **sin** reglas de negocio.
- Skills orientan; el árbol del repo es `domain` / `application` / `infrastructure` (no un árbol `adapters/` genérico), salvo que gobernanza diga lo contrario.

### 3.2 Clean Code y DRY

| Regla | Umbral |
| --- | --- |
| Complejidad cognitiva por función | ≤ 15 |
| Líneas por función | ≤ 40 (sin blancos) |
| Archivo de lógica | ≤ 400 líneas |
| Ciclos de importación | 0 |
| `process.env` | Solo en `config/env.ts` (y configs de herramientas) |
| Extracción DRY | Al tercer uso real del mismo patrón; no unificar mappers FHIR de recursos distintos |

### 3.3 Puertas de calidad (cada PR)

1. Biome (`biome ci`)
2. Typecheck del proyecto tocado
3. Tests relevantes (Vitest)
4. React Doctor en cambios de `frontend/`
5. Si toca `/api/v1`: OpenAPI regenerado + cliente frontend sin edición manual
6. Si toca FHIR: `/fhir/metadata` y suites de conformidad alineadas
7. Si cambia política: actualizar `GOBERNANZA.md` en la misma PR

### 3.4 Docker

- Un Dockerfile multi-stage por aplicación (`backend`, `frontend`).
- Compose: Postgres + servicios; variables por entorno.
- Fase 1: arranque reproducible y health.
- Fase 5: cero secretos en el YAML versionado; procedimiento de deploy en README.

### 3.5 SDD (Superpowers)

**Obligatorio** en: cambios de arquitectura, fronteras de módulos, contrato REST/FHIR, idempotencia / roles / tenant.

**Opcional** en: bugfixes localizados y chores.

Artefactos: `docs/superpowers/specs/`, `docs/superpowers/plans/`, ledger en `.superpowers/sdd/` según gobernanza.

### 3.6 Definition of Done del MVP

| # | Criterio | Fase que lo cierra |
| --- | --- | --- |
| 1 | Toda petición autenticada; tenant solo del token | 1 |
| 2 | `aislamiento-tenant` en REST, FHIR, chat, bandeja y KB | 2–4 (se refuerza) |
| 3 | Flujo widget completo (Fase 3) | 3 |
| 4 | Verificación resistente a fuerza bruta; sin persistir respuestas | 3 |
| 5 | Dos solicitudes simultáneas no apartan el mismo cupo | 3 |
| 6 | Bandeja aprueba/rechaza con cupos y citas coherentes | 3 |
| 7 | Cada tenant administra KB y config; alta con predeterminados | 3 |
| 8 | Simulador Hermes completa el ciclo; metadata exacta | 4 |
| 9 | Postman completo contra entorno desplegado | 5 |
| 10 | Auditoría sin fugas clínicas; escrituras FHIR auditadas | 4–5 |
| 11 | Sin IA ni n8n en código ni despliegue | 1–3 (garantía continua) |

---

## 4. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Fuerza bruta en verificación | Fase 3: bloqueo, par fijo, redacción |
| Acaparamiento de cupos | Fase 3: tope de pendientes + vencimiento; Fase 5: límites por IP |
| Contrato FHIR ≠ Hermes | Fase 4: perfiles en un módulo; simulador como contrato ejecutable |
| Apartados vencidos visibles a Hermes | Fase 4: expirar en lecturas FHIR; Fase 5: barrido |
| Estado en memoria con varias réplicas | Fase 5: store compartido para rate limits; idempotencia en DB desde Fase 3 |
| Documentación divergente | Gobernanza + este roadmap + OpenAPI / `metadata` + pruebas de rutas |

---

## 5. Decisiones de diseño

| Decisión | Elección |
| --- | --- |
| Alcance | Cinco fases hasta MVP completo (chatbot, panel, simulador, FHIR, entrega) |
| Corte de fases | Cimientos → Dominio → Chat / pre-agenda → FHIR / Hermes → Endurecimiento |
| Superficies HTTP | REST + FHIR |
| Stack día 1 | Next.js + Prisma + Postgres |
| Persistencia de este plan | `ROADMAP.md` en el repositorio limpio |
