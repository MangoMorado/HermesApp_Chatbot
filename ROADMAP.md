# Roadmap — Chatbot Ingenius 360

Plan de producto en **cinco fases** hasta el MVP desplegable, y una fase posterior
de correcciones y features. Arranca con hexágono, gobernanza, skills, puertas de
calidad y Docker listos en la primera versión.

## Estado

> Revisión: 27 de octubre de 2026. El cálculo y la obligación de reescribir este
> bloque al lanzar o cerrar una spec están en `GOBERNANZA.md` §7.1. Solo cuenta lo
> cerrado en `main`.

| Alcance | Avance |
| --- | --- |
| MVP (fases 1–5) | **86,7%** |
| Roadmap completo (fases 1–6) | **72,2%** |

Las fases 1, 2, 3 y 4 están cerradas. La Fase 5 está abierta y se partió en tres sub-proyectos de igual peso (spec `docs/superpowers/specs/2026-10-27-fase-5-identidad-oidc-contrato-design.md`, §3): la 5.1 (corte de identidad a OIDC) está cerrada en `main` (PR #13) y verificada contra el Keycloak del laboratorio; la 5.2 y la 5.3 siguen abiertas. La Fase 6 no está abierta.

**En curso:** Fase 5, con la 5.2 y la 5.3 pendientes. La 5.1 cerró el corte total del emisor HS256: el backend verifica tokens de un proveedor OIDC (RS256/ES256, JWKS), con rol `platform`, credenciales de widget cifradas, sesión del widget emitida por el proveedor, `service` del simulador por `client_credentials` y back-channel logout. Se retiraron `JWT_*`, `PLATFORM_SECRET`, `POST /api/platform/v1/tokens` y `token:dev`.

**Siguiente tarea:** Fase **5.2 — Frontend de referencia**: login OIDC con PKCE en `/panel`, `/simulador` y `/chat`, y widget de referencia con `conversation_secret`. Después, la **5.3 — Contrato publicado** (Swagger UI, colección Postman y prueba de rutas contra OpenAPI). La Fase 6 (pipelines, cobertura al 100%, oleadas de SonarQube y endurecimiento) espera a que la 5 esté cerrada.

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

## 2. Las fases

**Orden estricto:** 1 → 2 → 3 → 4 → 5 cierran el MVP. La Fase 6 se abre solo con
la Fase 5 cerrada. No se abre una fase sin cerrar el criterio de la anterior.

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
| 6 | `docker compose up` levanta Postgres + apps; secretos vía env (passwords en claro en el YAML solo como provisional hasta Fase 6) |

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
2. Sesión del widget; límites básicos (pueden ser in-memory; store compartido en Fase 6).
3. Motor de flujo determinista; textos desde config del tenant / KB / datos de dominio.
4. Verificación de identidad: bloqueo por documento, par fijo, redacción; nada de respuestas persistidas en mensajes ni auditoría.
5. Consola `/chat` en el frontend.
6. Pre-agenda: agendar, reprogramar y cancelar como **solicitudes**; apartado atómico `free` → `busy_tentative` en la misma transacción; vencimiento evaluado al leer.
7. Base de conocimiento CRUD; `bot-config` con rotación de clave; consultas generales con «ver más».
8. Bandeja del simulador: aprobar / rechazar solicitudes; coherencia de cupos y citas.
9. El flujo puede **crear** handoff-tickets (lectura y gestión de panel en Fase 6).
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

### Fase 5 — Keycloak, JWT, sesiones y contrato

**Objetivo:** pasar la administración de identidades y el manejo de JWT y sesiones
a Keycloak, y publicar el contrato (Postman, OpenAPI y Swagger UI).
Las reglas de tenant y el alcance de los roles se mantienen. Cierra el MVP.

**Entregables**

1. Keycloak como proveedor de identidad para quienes operan el panel (`admin`, `operator`) y para el cliente de servicio de Hermes (`service`).
2. El backend deja de firmar los JWT de panel y de plataforma con el secreto local. Verifica los tokens de Keycloak (JWKS) detrás del puerto de verificación; el núcleo no importa el proveedor.
3. Alta, cambio de rol y baja de admins y operadores se hacen en Keycloak. No hay tabla local de usuarios de panel ni emisión propia para esos roles.
4. Sesión de panel en Keycloak: login, renovación y logout. Un token expirado o de una sesión cerrada no autentica.
5. El rol `widget` conserva su alcance (solo el chat de su sesión). Su JWT lo emite el proveedor con el cliente de widget de la clínica; el `tenant_id` sigue siendo claim y el `session_id` ya no: la conversación se prueba con el `conversation_secret`. El widget no gana datos de dominio ni `/fhir`.
6. Los roles del producto (`widget` · `operator` · `admin` · `service`) se leen de los claims de Keycloak. El `tenant_id` sale solo del claim. Recurso de otro tenant → `404`.
7. Secretos y clientes de Keycloak fuera del YAML versionado; arranque local y despliegue documentados en `README.md`. `token:dev` se elimina.
8. Colección Postman: widget E2E, panel (bandeja, KB, config, tickets) y ciclo Hermes por FHIR, con ambos tenants.
9. Prueba de rutas `/api/v1` ↔ OpenAPI.
10. Swagger UI publicado desde el OpenAPI generado (`openapi.json`, `openapi-platform.json` y `openapi-sim.json`). El JSON no se edita a mano.

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | Admin y operador entran por Keycloak; el API acepta ese JWT y rechaza uno firmado con el secreto local de panel |
| 2 | Alta y cambio de rol se reflejan en el siguiente token, sin usuarios de panel persistidos en Postgres |
| 3 | Logout cierra la sesión; token expirado o de sesión cerrada → `401` |
| 4 | `tenant_id` solo del claim; recurso de otro tenant → `404` |
| 5 | El rol `widget` no alcanza datos de dominio ni `/fhir` |
| 6 | Suites `roles`, `sesion-widget` y `aislamiento-tenant` en verde contra el verificador de Keycloak |
| 7 | Postman se ejecuta de punta a punta contra el entorno desplegado sin pasos manuales |
| 8 | Las rutas `/api/v1` coinciden con OpenAPI y Swagger UI sirve ese mismo contrato generado |

**Verificación:** suites `roles`, `sesion-widget` y `aislamiento-tenant` contra el verificador de Keycloak, la colección Postman y Swagger UI alineado con OpenAPI.

**SDD:** obligatorio (arquitectura de auth, roles, tenant y sesiones).

---

### Fase 6 — Endurecimiento y entrega

**Objetivo:** producción operable: límites, tickets, barrido, secretos, pipelines de CI,
cobertura al 100% y el quality gate de SonarQube en verde.
Esta fase queda fuera del Definition of Done del MVP (sección 3.6). Se abre solo con la Fase 5 cerrada.

**Entregables**

1. Rate limits (sesiones nuevas por IP, etc.) en **store compartido** (válido con varias réplicas); `Retry-After` en `429`.
2. `GET` / `PATCH /api/v1/handoff-tickets` (`operator` · `admin`) + página de panel.
3. Barrido periódico de solicitudes vencidas (además del vencimiento al leer) y purga de `idempotency_keys` y `platform_idempotency_keys` más viejas que la ventana de retención. Esa ventana tiene que ser más larga que un reintento razonable del cliente: borrar antes haría que la misma `Idempotency-Key` vuelva a crear el efecto. La clave de apertura de sesión del widget, que se guarda en `idempotency_keys`, sale con el resto. El mismo barrido borra las `widget_sessions` ya vencidas y, con ellas, sus `conversations` y `conversation_messages`, incluido el borrador de pre-registro que quedó en `conversations.context`. También purga los `audit_events` más viejos que su ventana de retención.
4. Auditoría completa (campos y acciones definidos en gobernanza / política de producto).
5. Secretos fuera de `docker-compose.yml` (incluida password de Postgres); despliegue documentado en `README.md`.
6. Suite `carga-basica`: latencia y límites bajo concurrencia moderada.
7. Revalidar higiene de Fase 1 (LF, CI) y el arranque con `docker compose up`: Postgres, backend y frontend sanos. El mismo compose corre el ciclo Hermes si se definen `HERMES_SIMULATOR_ENABLED=true` y un `FHIR_BASE_URL` absoluto. Sin esas variables el simulador sigue apagado, que es el arranque de producción.
8. Pipelines de CI, uno por superficie. El workflow de la Fase 1 (Biome, typecheck, tests, React Doctor, `test:db`) se conserva y se reparte en jobs que fallan el PR por separado. Cada job corre las suites de su fila enteras, no un subconjunto de humo:

| Pipeline | Superficie que prueba |
| --- | --- |
| Lint | `biome ci` en raíz, `backend/` y `frontend/` |
| Calidad | typecheck de ambos proyectos, Vitest unitario de backend y frontend, React Doctor, umbrales de Clean Code (complejidad cognitiva, líneas por función, tamaño de archivo, ciclos de importación), suite `fronteras` y cobertura de código al 100% |
| Seguridad | auditoría de dependencias, secretos en el árbol versionado, y suites `sin-ia`, `verificacion` (respuestas y datos clínicos fuera de mensajes, auditoría y logs) y `cors` |
| JWT | verificación JWKS de Keycloak; suites `roles`, `sesion-widget` y `aislamiento-tenant`: token expirado o de sesión cerrada → `401`, roles `widget` · `operator` · `admin` · `service`, `tenant_id` solo del claim, recurso de otro tenant → `404`, alcance del widget |
| Contrato | suites `contrato-api` y `fhir-conformance`: rutas `/api/v1` alineadas con OpenAPI, `GET /fhir/metadata` igual a lo implementado, envoltura REST y `OperationOutcome` cada una en su superficie |
| Persistencia | `test:db` contra Postgres: `dominio`, `simetria-seed`, `idempotencia`, `aislamiento-tenant` y `pre-agenda` |
| HTTP | `flujo`, `verificacion`, `pre-agenda`, `conocimiento-config`, `alta-chatbot`, `sesion-widget`, `idempotencia`, `hermes-simulador` y `cors`, con token de Keycloak en los roles que ya no firma el backend |
| Runtime | `docker compose up` de punta a punta con health de los contenedores; el ciclo Hermes con `HERMES_SIMULATOR_ENABLED` y `FHIR_BASE_URL` absoluto (en producción el simulador queda apagado); la colección Postman de la Fase 5 y la suite `carga-basica` |

9. Suites completas y cobertura al 100%. Al cerrar la fase corren las dieciocho de `GOBERNANZA.md` §5.1: casos unitarios y, cuando la suite toca Postgres o HTTP, el proyecto Vitest `db`. No se apaga un caso para dejar el pipeline en verde. El Vitest del frontend (widget, proxy, idempotencia de cliente y panel) corre con el pipeline de Calidad.

   La cobertura la mide Vitest sobre la unión de los tests unitarios y de `test:db`. El umbral es **100%** en sentencias, ramas, funciones y líneas, en `backend/src` y en `frontend/src`. Quedan fuera el cliente de Prisma y los clientes generados por orval (`frontend/src/api`, `frontend/src/sim`, `frontend/src/platform`, `frontend/src/widget/api`): no se editan a mano. Por debajo de 100% el pipeline de Calidad deja el PR en rojo. No se excluye un archivo para alcanzar el umbral.

| Suite | Pipeline | Cobertura completa |
| --- | --- | --- |
| `fronteras` | Calidad | `domain` y `application` no importan Next, Prisma ni `node:*`; `fhir` solo importa `shared` y `auth`, y ningún otro módulo importa `fhir` |
| `contrato-api` | Contrato | Envoltura `{ error: { code, message, request_id, details } }`, `X-Request-Id`, y OpenAPI sin desfase: toda ruta `/api/v1` declarada y ninguna ruta sin declarar |
| `roles` | JWT | Sin token → `401`; JWT de panel firmado con el secreto local → `401`; token de Keycloak con `widget` · `operator` · `admin` · `service`; el widget no alcanza datos de dominio ni `/fhir`; recurso de otro tenant → `404` |
| `dominio` | Persistencia | Tenant id, paginación por cursor, ajustes del tenant, agenda, historial y datos del seed |
| `simetria-seed` | Persistencia | Simulador y chatbot parten de los mismos datos deterministas |
| `aislamiento-tenant` | Persistencia, JWT | La base impide referencias entre tenants; REST, `/fhir`, chat, bandeja y KB no devuelven datos ajenos, tampoco con token de Keycloak |
| `flujo` | HTTP | Motor, pasos, recorrido completo (identificación → verificación o pre-registro → agendar / reprogramar / cancelar / consultas / asesor) y chat por HTTP |
| `verificacion` | Seguridad, HTTP | Banco de preguntas, par fijo, bloqueo por intentos y redacción; las respuestas no se persisten en mensajes, auditoría ni logs |
| `pre-agenda` | Persistencia, HTTP | Apartado atómico `free` → `busy_tentative`, tope por paciente, vencimiento al leer y al crear, y bandeja que resuelve sin tomar dos veces el mismo cupo |
| `conocimiento-config` | HTTP | `bot-config`, rotación de clave, CRUD de la base de conocimiento, búsqueda por tokens y orígenes permitidos |
| `alta-chatbot` | HTTP | Alta de tenant con predeterminados; emisión de tokens de plataforma solo para lo que Keycloak no administra |
| `sesion-widget` | JWT, HTTP | Clave pública, `Origin`, límite por IP, renovación e idempotencia; token expirado o de sesión cerrada → `401` |
| `idempotencia` | Persistencia, HTTP | Repetir `Idempotency-Key` no duplica efectos en escrituras REST ni FHIR. Una clave dentro de la retención sigue devolviendo la respuesta guardada; una más vieja ya no está y el reintento es una escritura nueva |
| `sin-ia` | Seguridad | Ninguna dependencia ni import de LLM, embeddings, RAG ni n8n |
| `fhir-conformance` | Contrato | Mappers R4, `OperationOutcome`, `Bundle`, búsqueda y paginación; `CapabilityStatement` declara exactamente lo implementado, escrituras incluidas |
| `hermes-simulador` | HTTP | El simulador cierra el ciclo (maestros, pre-agendas, aprobación o rechazo, pre-registro) solo por `/fhir` con token `service` de Keycloak |
| `carga-basica` | Runtime | Latencia y límites bajo concurrencia moderada, con el store compartido de rate limit |
| `cors` | Seguridad, HTTP | Respuestas CORS de las rutas del widget y alta / baja de orígenes |

10. Revisiones en oleadas de fixes de SonarQube. Cada oleada toma un lote de issues abiertos, los corrige y vuelve a medir. No se apaga una regla ni se excluye un archivo para dejar el quality gate en verde. La fase no cierra mientras ese gate tenga issues abiertos.

**Criterios de aceptación**

| # | Criterio |
| --- | --- |
| 1 | Tests automatizados de ambos proyectos en verde |
| 2 | Checklist MVP de la sección 3 en verde |
| 3 | Los ocho pipelines corren en CI; cualquiera en rojo deja el PR en rojo |
| 4 | Lint, calidad, seguridad, JWT, contrato, persistencia, HTTP y runtime tienen job propio |
| 5 | Las dieciocho suites de la tabla anterior están en verde, con su parte unitaria y su parte `test:db` cuando la suite toca base o HTTP |
| 6 | Cobertura de código al 100% en sentencias, ramas, funciones y líneas, en `backend/src` y en `frontend/src` (sin Prisma ni clientes orval) |
| 7 | El quality gate de SonarQube queda en verde tras las oleadas de fixes, sin reglas apagadas ni archivos excluidos |
| 8 | El barrido purga `idempotency_keys` y `platform_idempotency_keys` fuera de la retención, y una clave todavía vigente repite la respuesta guardada |
| 9 | `docker compose up` levanta Postgres, backend y frontend con health. El ciclo Hermes corre en ese compose con el simulador encendido solo en esa corrida |
| 10 | El barrido borra `widget_sessions` vencidas con sus `conversations` y `conversation_messages`, y purga `audit_events` fuera de su retención. Una sesión vigente y su borrador de pre-registro siguen en su sitio |

**Verificación:** las dieciocho suites (`fronteras`, `contrato-api`, `roles`, `dominio`, `simetria-seed`, `aislamiento-tenant`, `flujo`, `verificacion`, `pre-agenda`, `conocimiento-config`, `alta-chatbot`, `sesion-widget`, `idempotencia`, `sin-ia`, `fhir-conformance`, `hermes-simulador`, `carga-basica`, `cors`), cobertura al 100%, el workflow con los ocho pipelines en verde y el quality gate de SonarQube sin issues abiertos.

**Paralelismo:** handoff-tickets, barrido, auditoría y las oleadas de SonarQube pueden avanzar en paralelo al pulido ops. Los pipelines y la cobertura cierran la fase. Depende del ciclo Hermes de la Fase 4 y del Keycloak de la Fase 5.

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

Ese mínimo rige desde la Fase 1. La matriz completa (lint, calidad, seguridad, JWT, contrato, persistencia, HTTP y runtime) se construye en la Fase 6, y con ella corren enteras las dieciocho suites de `GOBERNANZA.md` §5.1 y la cobertura de código queda en el 100%. Las oleadas de fixes de SonarQube también cierran en la Fase 6.

### 3.4 Docker

- Un Dockerfile multi-stage por aplicación (`backend`, `frontend`).
- Compose: Postgres + servicios; variables por entorno.
- Fase 1: arranque reproducible y health.
- Fase 6: cero secretos en el YAML versionado; procedimiento de deploy en README; `docker compose up` en el pipeline de Runtime, con health. El ciclo Hermes usa `HERMES_SIMULATOR_ENABLED` y `FHIR_BASE_URL` absoluto; en producción el simulador sigue apagado.

### 3.5 SDD (Superpowers)

**Obligatorio** en: cambios de arquitectura, fronteras de módulos, contrato REST/FHIR, idempotencia / roles / tenant.

**Opcional** en: bugfixes localizados y chores.

Artefactos: `docs/superpowers/specs/`, `docs/superpowers/plans/`, ledger en `.superpowers/sdd/` según gobernanza.

Al lanzar o cerrar una spec, el bloque **Estado** de este archivo se recalcula en la misma entrega (`GOBERNANZA.md` §7.1).

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
| 9 | Postman completo contra entorno desplegado; rutas alineadas con OpenAPI y Swagger UI | 5 |
| 10 | Auditoría sin fugas clínicas; escrituras FHIR auditadas | 4 y 6 |
| 11 | Sin IA ni n8n en código ni despliegue | 1–3 (garantía continua) |

Los criterios 1 a 9 y el 11 cierran el MVP. El 10 sigue en la tabla; la auditoría completa la entrega la Fase 6, después del MVP. Las escrituras FHIR ya se auditan en la Fase 4.

---

## 4. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Fuerza bruta en verificación | Fase 3: bloqueo, par fijo, redacción |
| Acaparamiento de cupos | Fase 3: tope de pendientes + vencimiento; Fase 6: límites por IP |
| Contrato FHIR ≠ Hermes | Fase 4: perfiles en un módulo; simulador como contrato ejecutable |
| Apartados vencidos visibles a Hermes | Fase 4: expirar en lecturas FHIR; Fase 6: barrido |
| Estado en memoria con varias réplicas | Fase 6: store compartido para rate limits; idempotencia en DB desde Fase 3 |
| Documentación divergente | Gobernanza + este roadmap + OpenAPI / `metadata` + pruebas de rutas |

---

## 5. Decisiones de diseño

| Decisión | Elección |
| --- | --- |
| Alcance | Cinco fases hasta el MVP (chatbot, panel, simulador, FHIR, Keycloak); después, endurecimiento y entrega |
| Corte de fases | Cimientos → Dominio → Chat / pre-agenda → FHIR / Hermes → Keycloak (JWT y sesiones) y contrato → Endurecimiento (pipelines, cobertura al 100% y oleadas de SonarQube) |
| Superficies HTTP | REST + FHIR |
| Stack día 1 | Next.js + Prisma + Postgres |
| Persistencia de este plan | `ROADMAP.md` en el repositorio limpio |
