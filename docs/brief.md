# Brief — Chatbot Ingenius 360

Documento de orientación para entender el proyecto sin entrar en cada detalle técnico.
Última revisión alineada con el roadmap: **fases 1 a 4 cerradas** (22 de octubre de
2026). Sigue la Fase 5 (Keycloak). El MVP (fases 1–5) va al 80 %.

---

## 1. ¿Qué es este proyecto?

**Chatbot Ingenius 360** es un asistente de agenda clínica para clínicas y centros de
salud. Permite a un paciente (o a quien lo atiende por chat) consultar horarios, pedir
citas, reprogramarlas o cancelarlas, y hacer preguntas frecuentes — **sin inteligencia
artificial**.

En lugar de un “cerebro” que inventa respuestas, el bot sigue un guion fijo: una
“máquina de estados” (un flujo con pasos claros: identificar paciente → verificar →
agendar, etc.). Los textos salen de la configuración de cada clínica, de su “base de
conocimiento” (preguntas y respuestas preparadas) o de los datos reales de la agenda.

El sistema no es el dueño de la agenda en firme. Ese rol lo tiene **Hermes** (el sistema
de historias clínicas / agenda de la organización). El chatbot solo crea
**solicitudes** (“quiero esta cita”) y **pre-registros** (“este paciente aún no existe
en Hermes”). Hermes decide si aprueba o rechaza. Hasta que Hermes responda, todo es
provisional.

Hay dos piezas:

| Pieza | Para qué sirve | En producción |
| --- | --- | --- |
| **Chatbot** | El producto que se despliega: API, panel y chat (consola, iframe y script) | Sí |
| **Simulador de Hermes** | Una “réplica de juguete” de Hermes para probar el ciclo completo en desarrollo | Se apaga |

---

## 2. ¿Cómo funciona (visión general)?

Imagina tres actores:

1. **El paciente** habla con un widget de chat embebido en la web de la clínica.
2. **El chatbot** guarda solicitudes, aparta cupos de forma temporal y muestra textos
   configurados.
3. **Hermes** aprueba o rechaza. Hoy ese papel lo hace el simulador, hablando con el
   chatbot por FHIR; mañana lo hará el Hermes real por la misma superficie.

```
Paciente abre el chat
        ↓
Se identifica / verifica (sin guardar respuestas sensibles)
        ↓
Pide agendar, reprogramar, cancelar o consulta una FAQ
        ↓
El chatbot crea una solicitud y “aparta” el cupo (lo marca ocupado de forma tentativa)
        ↓
Hermes ve la solicitud (por FHIR) y aprueba o rechaza
        ↓
Cupos y citas quedan coherentes; el paciente recibe el resultado
```

Reglas importantes que no cambian de fase en fase:

- **Sin IA:** no hay ChatGPT, embeddings ni flujos n8n.
- **Multitenancy:** cada clínica es un “tenant” (cliente aislado). El identificador de
  clínica sale **solo** del token de acceso (“JWT”: un pase firmado digitalmente), nunca
  de un parámetro que el cliente pueda inventar. Si alguien pide datos de otra clínica,
  la API responde “no encontrado” (`404`), no “prohibido” (`403`), para no revelar que
  el recurso existe.
- **Idempotencia:** si una escritura se repite con la misma “Idempotency-Key” (clave que
  evita duplicados), el sistema responde igual sin crear dos veces la misma cita o
  solicitud.
- **No divulgación:** no se guardan respuestas de verificación de identidad ni datos
  clínicos en mensajes, auditoría o logs.

---

## 3. Arquitectura (cómo está organizado)

### 3.1 Monorepo con dos proyectos

El repositorio es un “monorepo” (varios proyectos en una sola carpeta git), pero
**backend** y **frontend** no se mezclan: cada uno tiene su propio `package.json`.

| Carpeta | Rol |
| --- | --- |
| `backend/` | API, reglas de negocio, base de datos |
| `frontend/` | Panel, consola de chat y widget; **sin** reglas de negocio (solo llama a la API) |
| Raíz | Herramientas compartidas (Biome, scripts, Docker Compose) |

Stack del día a día: **Next.js** (framework web), **Prisma** (capa que habla con la
base de datos) y **Postgres** (base de datos relacional).

### 3.2 Arquitectura hexagonal (en el backend)

El backend se organiza por “módulos” de negocio. Cada módulo tiene tres capas:

| Capa | En palabras simples |
| --- | --- |
| `domain/` | Las reglas y conceptos puros (qué es un cupo, una solicitud…). Sin base de datos ni web. |
| `application/` | Los “casos de uso”: orquestan el dominio para cumplir una acción (crear solicitud, listar agenda…). |
| `infrastructure/` | Los adaptadores concretos: Prisma, JWT, reloj, IDs, etc. |

Las dependencias van **hacia adentro**: lo de afuera (HTTP, DB) depende del núcleo, no
al revés. Un archivo llamado “composition root” (`composition-root.ts`) es el único
punto que “cablea” adaptadores reales con casos de uso — como el tablero eléctrico del
edificio.

Eso permite, por ejemplo, cambiar Prisma por otra herramienta de persistencia sin
reescribir las reglas de agenda.

### 3.3 Dos “superficies” HTTP (dos formas de hablar con el mismo dominio)

| Superficie | Quién la usa | Para qué |
| --- | --- | --- |
| **REST** `/api/v1` | Widget, panel, chat | Operaciones del producto en formato JSON habitual |
| **FHIR R4** `/fhir` | Hermes (rol `service`) | Estándar sanitario de intercambio de datos clínicos/agenda |

Además existe `/api/platform/v1`: la “plataforma” (fuera de cualquier clínica) da de alta
tenants y emite tokens de panel/servicio con un secreto de plataforma. El simulador, solo
en desarrollo, tiene su propio REST en `/api/sim/v1`.

Roles del token:

| Rol | Quién es |
| --- | --- |
| `widget` | El chat embebido; solo su propia sesión |
| `operator` / `admin` | Personal del panel |
| `service` | Hermes / integraciones de servicio |

### 3.4 Frontend

El panel consume un **cliente generado** desde el contrato OpenAPI (documento que
describe la API). No se edita a mano.

Hay tres formas de montar el mismo chat; las tres hablan directo con el backend:

| Montaje | Dónde |
| --- | --- |
| Consola | `/chat` |
| Iframe | `/widget` |
| Script | `widget.js` en el sitio de la clínica, con la clave pública del tenant |

La consola también tiene el panel (bot, conocimiento, ajustes), el simulador y su
bandeja. El sistema visual del panel está en `DESIGN.md`.

---

## 4. Qué ya funciona (hasta hoy)

Estado resumido del roadmap. Solo cuenta lo cerrado en `main`:

| Fase | Estado | En una frase |
| --- | --- | --- |
| **1 — Cimientos** | Cerrada | Auth, contratos, Docker, calidad, hexágono vacío |
| **2 — Dominio persistido** | Cerrada | Agenda, pacientes, historial, seed, panel y simulador |
| **3 — Chat, pre-agenda y config** | Cerrada | Motor determinista, widget, verificación, KB, bandeja y apartado de cupos |
| **4.1 — FHIR base y lectura** | Cerrada | Lectura y búsqueda R4; `GET /fhir/metadata` igual a lo implementado |
| **4.2 — Escritura de maestros** | Cerrada | `PUT` condicional de Patient, Practitioner, HealthcareService, Schedule y Slot |
| **4.3 — Pre-agenda por FHIR** | Cerrada | Solicitudes como Appointment `proposed` y Task; Hermes las resuelve con `PUT` |
| **4.4 — Simulador por FHIR** | Cerrada | El simulador cierra maestros, bandeja y pre-registro solo por `/fhir` |
| **5 — Keycloak y contrato** | Pendiente | Identidad del panel y de Hermes en Keycloak; Postman y Swagger UI |
| **6 — Endurecimiento** | Pendiente | Fuera del MVP: secretos, cobertura al 100 %, SonarQube, carga |

### Capacidades ya disponibles

**Plataforma y acceso**

- Alta de clínicas (tenants) y emisión de tokens de panel/servicio.
- Autenticación por JWT con roles y aislamiento por tenant.
- Sesiones del widget: se abren con la “clave pública” del tenant (va en el HTML de la
  clínica) y un origen permitido; hay límite básico por IP (en memoria hasta la Fase 6).

**Chat y configuración**

- Motor de estados: menú, preguntas frecuentes, identificación, verificación de identidad,
  pre-registro, reserva (servicio, profesional, día, cupo), reprogramación, cancelación
  y paso a un asesor.
- Verificación con un par fijo de preguntas, bloqueo por intentos y redacción: las
  respuestas no se guardan.
- `bot-config`: textos y parámetros del bot por clínica, con rotación de clave del widget
  y orígenes permitidos.
- Base de conocimiento: categorías, preguntas/respuestas y búsqueda por palabras clave
  (coincidencias exactas normalizadas, sin IA).
- El flujo puede crear un ticket de handoff. La pantalla del panel para gestionarlos
  llega en la Fase 6.

**Dominio clínico / agenda**

- Lectura de agendas, profesionales, servicios, cupos (“slots”) y citas.
- Historial / expediente del paciente.
- Ajustes del tenant.
- Pre-agenda: solicitudes `book`, `reschedule` y `cancel`. Un cupo pasa de `free` a
  `busy_tentative` en la misma transacción, para que dos usuarios no tomen el mismo
  horario. Las solicitudes vencen al leerlas y al crearlas.
- Simulador con maestros y generación de cupos para pruebas.
- Seed determinista de dos tenants (datos de prueba reproducibles).
- Idempotencia de las escrituras en base de datos.

**FHIR (Hermes)**

- Lectura y búsqueda de `Patient`, `Practitioner`, `HealthcareService`, `Schedule`,
  `Slot`, `Appointment` y `Task`. Solo el rol `service` (salvo `GET /fhir/metadata`,
  que es público).
- Escritura condicional de los cinco maestros y resolución de la pre-agenda por `PUT`.
  Cada escritura lleva `Idempotency-Key`.
- Los errores de esta superficie son `OperationOutcome`, no la envoltura REST.

**Simulador por FHIR**

- Un cliente HTTP con token `service` es el único camino del simulador hacia el
  chatbot, el mismo que usará Hermes real.
- Sincroniza los maestros, lee pre-agendas, aprueba o rechaza, y confirma el
  pre-registro solo por `/fhir`.
- El script `hermes:sync` recorre ese ciclo sin clics. La bandeja usa el mismo cliente.
- Un cupo apartado que responde `409` no aborta la corrida: se reintenta en la siguiente.

**Infraestructura y calidad**

- Health check, envoltura de errores REST, cabecera `X-Request-Id`.
- OpenAPI generado; cliente del frontend regenerado.
- Docker con Postgres, backend y frontend.
- Suites de tests por comportamiento (`fronteras`, `flujo`, `verificacion`,
  `pre-agenda`, `fhir-conformance`, `hermes-simulador`, `sin-ia`, etc.).

---

## 5. Qué viene después

### Fase 5 — Keycloak, JWT, sesiones y contrato

Cierra el MVP.

- Panel y cliente `service` entran por Keycloak. El backend verifica esos JWT y deja de
  firmar los de panel con el secreto local.
- Alta, cambio de rol y baja de admins y operadores se hacen en Keycloak.
- El rol `widget` conserva su alcance: solo el chat de su sesión.
- Colección Postman de punta a punta, prueba de rutas contra OpenAPI y Swagger UI
  servido desde ese contrato generado.

### Fase 6 — Endurecimiento y entrega

Queda fuera del MVP. Se abre cuando la Fase 5 esté cerrada.

- Rate limits compartidos (válidos con varias réplicas del servidor).
- Gestión de handoff-tickets en el panel.
- Barrido periódico de solicitudes vencidas.
- Auditoría completa, secretos fuera del compose y pruebas de carga básica.
- Pipelines de CI, uno por superficie, y cobertura al 100 %.
- Revisiones en oleadas de fixes de SonarQube hasta dejar el quality gate en verde, sin
  apagar reglas ni excluir archivos.

---

## 6. Mapa rápido de módulos del backend

| Módulo | Qué cubre |
| --- | --- |
| `auth` | Quién es el actor (roles, verificación de token) |
| `platform` | Alta de tenants y emisión de tokens de panel/servicio |
| `tenancy` | Ajustes del tenant |
| `bot-config` | Textos, parámetros, claves del widget y orígenes permitidos |
| `knowledge` | Base de conocimiento |
| `widget` | Sesiones del chat embebido |
| `conversation` | Motor de estados y turnos del chat |
| `verification` | Preguntas de identidad, bloqueo y redacción |
| `handoff` | Tickets para que un humano tome el chat |
| `scheduling` | Agenda, cupos, citas y solicitudes / pre-agenda |
| `patients` | Expediente / historial y pre-registro |
| `fhir` | Perfiles, mappers y contrato R4 de `/fhir` |
| `hermes-simulator` | Simulador (se apaga en producción) |
| `shared` | Reloj, IDs, idempotencia, auditoría, paginación… |

---

## 7. Dónde leer más

| Documento | Contenido |
| --- | --- |
| [`README.md`](../README.md) | Arranque local, variables, Docker, mapa del código |
| [`ROADMAP.md`](../ROADMAP.md) | Plan de las cinco fases del MVP, la Fase 6 y los criterios de cierre |
| [`GOBERNANZA.md`](../GOBERNANZA.md) | Reglas de trabajo y no negociables |
| [`DESIGN.md`](../DESIGN.md) | Sistema visual del panel |
| `docs/superpowers/specs/` | Diseños detallados por sub-fase (de la 2 a la 4.4) |

---

## 8. Resumen en una frase

Construimos un **chatbot de agenda clínica determinista**, multitenant, sin IA, que
solo propone citas a Hermes; hoy ya tiene el chat, la pre-agenda, la superficie FHIR
y el simulador que cierra el ciclo solo por FHIR; faltan Keycloak y el endurecimiento
de producción.
