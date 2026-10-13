# Gobernanza — Chatbot Ingenius 360

Cómo se trabaja en este repositorio. Manda sobre las skills instaladas, sobre el estilo
por defecto de cualquier herramienta y sobre el criterio individual. Si una skill, una
librería o un agente sugiere algo que contradice este documento, gana este documento.

`ROADMAP.md` define **qué** se construye y en qué orden. Este documento define **cómo**.

---

## 1. No negociables

Ninguno de estos puntos se relaja sin una PR que modifique este documento.

### 1.1 Sin IA

Ningún LLM, embedding, RAG ni n8n, ni en el código, ni en las dependencias, ni en el
despliegue. El chatbot es una **máquina de estados determinista**: todo texto que ve el
usuario sale de la configuración del tenant, de su base de conocimiento o de los datos de
dominio. La suite `sin-ia` vigila que no entren dependencias de ese tipo.

### 1.2 Hermes es la fuente de verdad

El servicio solo origina **solicitudes** y pre-registros. Nunca confirma, modifica ni
cancela por su cuenta una cita en firme: eso lo resuelve Hermes y llega de vuelta por
FHIR. Cualquier estado propio es provisional hasta que Hermes lo resuelva.

**Política de apartado (pre-agenda, Fase 3.2).** Una solicitud `book` o `reschedule` pasa el
cupo de `free` a `busy_tentative` en la misma transacción que la crea; dos solicitudes
concurrentes nunca apartan el mismo cupo. El apartado vence a los `request_hold_minutes` del
tenant (240 por defecto, 15–4320) o al inicio del cupo si llega antes; las cancelaciones no
apartan cupo y vencen con el mismo plazo. Cada historia clínica admite como máximo
`max_pending_requests_per_patient` solicitudes `book`/`reschedule` vivas (2 por defecto, 1–5);
las cancelaciones no cuentan. Cada cita en firme admite una sola solicitud de cambio viva. El
vencimiento se evalúa al leer y al crear o resolver; nunca se resuelve una solicitud vencida.

### 1.3 Multitenancy por token

El `tenant_id` se toma **solo** del claim del JWT. Nunca del body, del query string ni de
un header libre. Un recurso de otro tenant responde `404`, nunca `403`: un `403` confirma
que el recurso existe.

Todo repositorio, caso de uso y consulta recibe el tenant como parámetro explícito. No hay
variables globales ni de contexto implícito para el tenant.

**Superficie de plataforma.** `/api/platform/v1` es de un tercer actor, la plataforma, que
no pertenece a ningún tenant: da de alta tenants y emite tokens de panel y de servicio. Se
autentica con `PLATFORM_SECRET` (comparado en tiempo constante; sin él la superficie responde
`404`) y es la **única** superficie donde el tenant viaja en el cuerpo. La regla de esta
sección sigue intacta en `/api/v1` y `/fhir`. Se audita con `actor_subject = platform`.

### 1.4 Alcance del widget

El rol `widget` alcanza únicamente el chat de su propia sesión. Nunca datos de dominio,
nunca `/fhir`, nunca otra sesión. Los roles son `widget` · `operator` · `admin` · `service`.

La clave del widget es **pública** (va en el HTML de la clínica): solo identifica al tenant y
abre sesiones desde los `allowed_origins` del tenant. Se guarda en claro y se rota con gracia.
El token del widget sale de una sesión (`POST /api/v1/widget/sessions`) y expira con ella.

El widget alcanza `GET /widget/conversation` y `POST /widget/conversation/messages` de su
propia sesión. Las rutas del widget responden CORS con el origen exacto si algún tenant lo
admite; con token, un `Origin` distinto al de la sesión es `403`.

### 1.5 No divulgación

No se persisten respuestas de verificación de identidad ni datos clínicos en mensajes,
auditoría ni logs. Cuando haya que registrar que algo pasó, se registra el hecho y el
resultado, no el contenido.

Verificación de identidad: dos preguntas de un banco en código
(`verification/domain/questions.ts`), con un par fijo por expediente que se guarda al
sortearlo y solo se re-sortea tras verificar. A los `verification_max_attempts` fallos el
documento queda bloqueado `verification_lock_minutes` y el chat ofrece un asesor. Las
respuestas se comparan en memoria: nunca llegan a `conversation_messages`,
`conversations.context`, `audit_events`, logs ni respuestas HTTP. Todo texto libre del
paciente se guarda como `[redactado]` (también las consultas a la KB) salvo el documento,
enmascarado (`CC ••••5678`); el resumen del pre-registro también se redacta. El hash de la
petición del chat en `idempotency_keys` es un HMAC (clave derivada del secreto JWT).
La pregunta de correo solo se ofrece si el dominio es de un proveedor común y sus señuelos nunca
comparten en exclusiva el dominio real del paciente.

El `subject` de un token emitido (p. ej. el correo de un operador) se guarda como
`audit_events.resource_id` de `token.issued`: identifica a quién actúa, no es un dato de
verificación ni clínico, así que no rompe la regla de registrar el hecho y no el contenido.

### 1.6 Idempotencia

Toda escritura acepta `Idempotency-Key` y la persiste en base de datos (no en memoria).
Repetir la misma petición con la misma clave produce el mismo resultado sin duplicar
efectos.

Excepciones y matices: emitir un token (`POST /api/platform/v1/tokens`) no escribe dominio y
no lleva `Idempotency-Key`, así ningún JWT queda persistido. Cuando la respuesta de una
escritura lleva una credencial (sesión del widget), se persiste solo la referencia
(`session_id`) y la repetición vuelve a firmar el token. En la apertura anónima de sesión la
`Idempotency-Key` actúa como secreto del cliente: mínimo 32 caracteres y nunca se registra en
logs ni en auditoría.
Por ser un secreto tiene que ser aleatoria y con al menos 128 bits de entropía (p. ej.
`crypto.randomUUID()`, no un contador ni un valor previsible); se guarda en
`idempotency_keys` como cualquier otra clave.

### 1.7 Dos componentes separados

El **chatbot** se despliega. El **simulador de Hermes** se apaga en producción. El chatbot
no puede depender de nada del simulador que Hermes no vaya a ofrecer por FHIR: si el
simulador lo expone y Hermes no, no existe.

### 1.8 Idioma

Código, nombres de campos, rutas y ramas en inglés. Textos de interfaz, comentarios y documentación en español.

---

## 2. Arquitectura hexagonal

### 2.1 Forma del árbol

Un directorio por contexto de negocio dentro de `backend/src/modules/`, siempre con la
misma forma:

```
<contexto>/
  domain/         # entidades, value objects, puertos. Sin I/O, sin framework.
  application/    # casos de uso que orquestan el dominio a través de puertos.
  infrastructure/ # adaptadores: Prisma, HTTP saliente, reloj, IDs.
```

El árbol es `domain` / `application` / `infrastructure`. **No** un `adapters/` genérico,
aunque la skill `hexagonal-architecture` use esa palabra: lo que ella llama «adapters» aquí
se llama `infrastructure`.

### 2.2 Dirección de las dependencias

Siempre hacia adentro: `infrastructure` → `application` → `domain`. El dominio define los
puertos; la infraestructura los implementa.

`domain/` y `application/` no importan `next`, `@prisma/client`, `react` ni `node:*`. Lo
hacen cumplir dos mecanismos independientes, y los dos deben quedar en verde:

- la regla `noRestrictedImports` de `backend/biome.json`;
- la suite `fronteras` (`backend/tests/fronteras.test.ts`).

La regla de oro para decidir de qué lado va algo: **¿hace I/O o corre fuera de proceso?**
Si sí, es infraestructura. Las dependencias de un componente también cuentan: algo que no
hace I/O pero importa el driver de la base de datos ya es infraestructura.

`conversation` solo importa `shared`, `auth` y `verification/domain`; las escrituras del chat
son efectos que cumple `composition/conversation-effects.ts`. Solo `request_appointment` y
`pre_register` corren en un `SAVEPOINT` (pueden fallar por unicidad y el turno sigue); si
otro efecto lanza, el turno entero se revierte.

`fhir` solo importa `shared` y `auth`, y ningún módulo importa `fhir`. Declara sus propios
puertos de lectura (`fhir/domain/ports/sources.ts`) y `composition/fhir-wiring.ts` los cumple
con `scheduling` y `patients`. No tiene `infrastructure/`: no hace I/O propio.

### 2.3 Composition root

`backend/src/composition-root.ts` es el **único** lugar que ensambla adaptadores concretos
con casos de uso. Los route handlers leen de ahí; no instancian adaptadores por su cuenta.

### 2.4 Adaptadores de entrada

Los route handlers de `backend/src/app/` validan, autentican, traducen errores y delegan.
No concentran reglas de negocio. Un handler que crece más allá de eso es señal de que un
caso de uso falta.

### 2.5 Frontend

Sin reglas de negocio. Consume el cliente generado desde OpenAPI; ese cliente no se edita
a mano. Duplicar una validación de negocio en el frontend es un defecto, no una mejora de
experiencia: la validación de forma (campo requerido, formato) sí vive ahí.

---

## 3. Las dos superficies HTTP

Un solo dominio, dos adaptadores de entrada, **contratos de error incompatibles que nunca
se mezclan**:

| Superficie | Consumidores | Errores |
| --- | --- | --- |
| REST `/api/v1` | widget, panel, chat | `{ error: { code, message, request_id, details } }` + cabecera `X-Request-Id` |
| FHIR R4 `/fhir` | Hermes (solo rol `service`, en lectura y escritura) | `OperationOutcome` con `application/fhir+json` |
| Plataforma `/api/platform/v1` | Operación (alta de tenants, tokens) | Misma envoltura que REST `/api/v1` |

### 3.1 Reglas FHIR

- `GET /fhir/metadata` (`CapabilityStatement`) declara **exactamente** lo implementado.
  Ni de más (prometer lo que no existe) ni de menos.
- Perfiles, systems y constantes FHIR viven en **un solo módulo**. No se repiten literales
  de `system` por el código.
- No se unifican mappers FHIR de recursos distintos aunque se parezcan: `Patient` y
  `Practitioner` comparten forma, no responsabilidad.
- Los vencimientos se evalúan **al leer**, también en lecturas FHIR de `Slot`,
  `Appointment` y `Task`: Hermes nunca debe ver un apartado vencido como vigente.
- La escritura FHIR queda en auditoría como escrita por Hermes.
- `/fhir` es exclusivo del rol `service`. `operator`, `admin` y `widget` reciben `403`, también
  en lectura. La única ruta pública es `GET /fhir/metadata`.
- Autenticación y rol se comprueban **antes** de enrutar: sin token `service`, ninguna ruta de
  `/fhir` responde `404`, para que no se pueda sondear qué recursos existen.
- El registro de recursos (`fhir/domain/registry.ts`) es la única fuente de qué se puede leer
  y buscar: de ahí salen la validación de parámetros y `metadata`.
- Un parámetro de búsqueda que el recurso no declara responde `400`; no se ignora.

---

## 4. Clean Code y DRY

| Regla | Umbral |
| --- | --- |
| Complejidad cognitiva por función | ≤ 15 |
| Líneas por función | ≤ 40 (sin blancos) |
| Archivo de lógica | ≤ 400 líneas |
| Ciclos de importación | 0 |
| `process.env` | Solo en `backend/src/config/env.ts`, `frontend/src/config/env.ts` (solo servidor) y en configs de herramientas |
| Extracción DRY | Al **tercer** uso real del mismo patrón |

Dos usos parecidos no son duplicación: son coincidencia. Abstraer al segundo uso produce
acoplamientos que cuestan más que la repetición. Al tercero ya hay evidencia de patrón.

Los umbrales de complejidad y `process.env` los vigila Biome; los de tamaño son criterio
de revisión.

---

## 5. Puertas de calidad (cada PR)

1. `biome ci` en verde.
2. Typecheck del proyecto tocado.
3. Tests relevantes (Vitest) en verde.
4. React Doctor si la PR toca `frontend/`.
5. Si toca `/api/v1`: OpenAPI regenerado y cliente del frontend sin edición manual.
6. Si toca FHIR: `/fhir/metadata` y las suites de conformidad alineadas **en la misma PR**.
7. Si cambia política: este documento se actualiza **en la misma PR**.

Una PR roja no se mergea. No se desactiva una regla para pasar la puerta: se arregla el
código, o se cambia la regla en una PR aparte que argumente el cambio.

### 5.1 Suites

Se nombran por comportamiento, no por archivo: `contrato-api`, `roles`, `fronteras`,
`dominio`, `simetria-seed`, `aislamiento-tenant`, `flujo`, `verificacion`, `pre-agenda`,
`conocimiento-config`, `alta-chatbot`, `sesion-widget`, `idempotencia`, `sin-ia`,
`fhir-conformance`, `hermes-simulador`, `carga-basica`, `cors`.

`flujo` cubre el motor conversacional: el motor, los pasos, el recorrido completo y el chat
por HTTP. `cors` cubre las respuestas CORS de las rutas del widget y el alta/baja de
orígenes.

---

## 6. Skills

Instaladas en `.agents/skills/` (espejo en `.claude/skills/` para Claude Code y, cuando
aplica, en `.github/skills/` para GitHub Copilot) y fijadas en `skills-lock.json`, vía el
CLI de [skills.sh](https://skills.sh):

| Skill | Origen | Para qué |
| --- | --- | --- |
| `dry-refactoring` | `kucherenko/jscpd` | Eliminar duplicación detectada por jscpd |
| `fhir-developer-skill` | `anthropics/healthcare` | R4: recursos, value sets, `OperationOutcome` |
| `find-skills` | `vercel-labs/skills` | Descubrir e instalar skills del ecosistema |
| `frontend-design` | `anthropics/skills` | Dirección visual distintiva (ligera) al construir UI |
| `grilling` | `mattpocock/skills` | Stress-test de planes y decisiones |
| `hexagonal-architecture` | `lexler/skill-factory` | Decidir fronteras de capa |
| `impeccable` | `pbakaus/impeccable` | Diseño UI de producción: craft, critique, audit, polish, DESIGN.md |
| `nielsen-usability-heuristics` | `dembrandt/dembrandt-skills` | Revisión de usabilidad de UI |
| `security-best-practices` | `openai/skills` | Revisión de seguridad (JS/TS, Next.js) |

`hexagonal-architecture` y `fhir-developer-skill` viven hoy en `.claude/skills/`; el resto
del inventario compartido está en `.agents/skills/` y `.claude/skills/`. `impeccable`
también se replica en `.github/skills/` (y trae agentes auxiliares bajo `.claude/agents/`
y `.github/agents/`, más el hook de detector en `.github/hooks/impeccable.json`). El
inventario canónico es `skills-lock.json`.

**Las skills orientan; gana la gobernanza.** Conflictos conocidos y cómo se resuelven:

- La skill hexagonal llama «adapters» a la capa externa → aquí es `infrastructure`
  (sección 2.1).
- La skill FHIR asume escenarios clínicos genéricos y sugiere recursos que este producto
  no expone → el alcance lo fija `ROADMAP.md` y lo declara `/fhir/metadata` (sección 3.1).
- La skill `dry-refactoring` elimina clones de jscpd → los clones exactos sí se
  refactorizan; dos bloques parecidos sin ser copia no se abstraen hasta el tercer uso
  (sección 4).
- Para trabajo de diseño UI, `impeccable` es la skill primaria (comandos `/impeccable`,
  `PRODUCT.md` / `DESIGN.md`, detector de anti-patrones). `frontend-design` queda como
  guía breve de dirección visual; si chocan, manda `impeccable` y, sobre ambas, esta
  gobernanza (el frontend no lleva reglas de negocio; no inventar claims de producto ni
  flujos clínicos fuera del roadmap). `nielsen-usability-heuristics` complementa el modo
  critique de `impeccable`, no lo sustituye.

Actualizar: `npx skills update`. Reproducir desde el lock: `npx skills experimental_install`.
Para refrescar solo Impeccable (scripts/binarios/hooks): `npx impeccable update`.

---

## 7. SDD (Superpowers)

**Obligatorio** cuando la tarea toca: arquitectura, fronteras de módulos, el contrato REST
o FHIR, idempotencia, roles o tenant.

**Opcional** en bugfixes localizados y chores.

Artefactos: `docs/superpowers/specs/` y `docs/superpowers/plans/` para la tarea en curso;
ledger en `.superpowers/sdd/`.

---

## 8. Límites de los agentes

Un agente (Claude Code u otro) trabaja bajo las mismas puertas que una persona, más estos
límites:

1. **No inventa alcance.** Si el roadmap no lo pide en la fase abierta, no se construye.
   Una fase no se abre sin cerrar los criterios de aceptación de la anterior.
2. **No desactiva reglas ni tests para pasar una puerta.** Ni `biome-ignore`, ni `skip`,
   ni bajar un umbral, salvo que una persona lo pida explícitamente en esa tarea.
3. **No toca secretos ni credenciales reales.** Los `.env` de ejemplo son plantillas; los
   valores reales no se versionan ni se imprimen.
4. **Verifica antes de afirmar.** «Funciona», «pasa» o «está listo» solo después de correr
   el comando y ver la salida. Si algo no se pudo verificar, se dice cuál y por qué.
5. **No commitea ni pushea sin que se lo pidan.** Y nunca directo a `main` sin rama.
6. **Reporta lo que dejó fuera.** Si una parte quedó bloqueada, se termina todo lo demás y
   se nombra explícitamente lo que falta.
