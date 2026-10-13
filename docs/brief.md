# Brief — Chatbot Ingenius 360

Documento de orientación para entender el proyecto sin entrar en cada detalle técnico.
Última revisión alineada con el roadmap: **Fase 3.2 (pre-agenda) en curso**.

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
| **Chatbot** | El producto que se despliega: API, panel y (más adelante) el chat | Sí |
| **Simulador de Hermes** | Una “réplica de juguete” de Hermes para probar el ciclo completo en desarrollo | Se apaga |

---

## 2. ¿Cómo funciona (visión general)?

Imagina tres actores:

1. **El paciente** habla con un widget de chat embebido en la web de la clínica.
2. **El chatbot** guarda solicitudes, aparta cupos de forma temporal y muestra textos
   configurados.
3. **Hermes** (hoy el simulador; mañana el sistema real vía FHIR) aprueba o rechaza.

Flujo típico cuando el producto esté completo:

```
Paciente abre el chat
        ↓
Se identifica / verifica (sin guardar respuestas sensibles)
        ↓
Pide agendar, reprogramar, cancelar o consulta una FAQ
        ↓
El chatbot crea una solicitud y “aparta” el cupo (lo marca ocupado de forma tentativa)
        ↓
Hermes ve la solicitud en su bandeja y aprueba o rechaza
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
| `frontend/` | Panel operativo y consola; **sin** reglas de negocio (solo llama a la API) |
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
tenants y emite tokens de panel/servicio con un secreto de plataforma.

Roles del token:

| Rol | Quién es |
| --- | --- |
| `widget` | El chat embebido; solo su propia sesión |
| `operator` / `admin` | Personal del panel |
| `service` | Hermes / integraciones de servicio |

### 3.4 Frontend

El panel consume un **cliente generado** desde el contrato OpenAPI (documento que
describe la API). No se edita a mano. Hoy hay páginas de panel y simulador; la consola
`/chat` llega en la sub-fase 3.4.

---

## 4. Qué ya funciona (hasta hoy)

Estado resumido del roadmap:

| Fase | Estado | En una frase |
| --- | --- | --- |
| **1 — Cimientos** | Cerrada | Auth, contratos, Docker, calidad, hexágono vacío |
| **2 — Dominio persistido** | Cerrada | Agenda, pacientes, historial, seed, panel/simulador de lectura/CRUD |
| **3.1 — Tenant listo para chatear** | Cerrada | Tokens de plataforma, sesiones widget, bot-config, base de conocimiento |
| **3.2 — Pre-agenda** | **En curso** | Solicitudes, apartado de cupos, vencimiento, bandeja del simulador |
| 3.3 / 3.4 | Pendientes | Motor de chat y pantallas de chat/bandeja/KB |
| 4 y 5 | Pendientes | FHIR completo con Hermes real, y endurecimiento para producción |

### Capacidades ya disponibles

**Plataforma y acceso**

- Alta de clínicas (tenants) y emisión de tokens de panel/servicio.
- Autenticación por JWT con roles y aislamiento por tenant.
- Sesiones del widget: se abren con la “clave pública” del tenant (va en el HTML de la
  clínica) y un origen permitido; hay límite básico por IP.

**Configuración del bot (3.1)**

- `bot-config`: textos y parámetros del bot por clínica, con rotación de clave del
  widget.
- Base de conocimiento: categorías, preguntas/respuestas y búsqueda por palabras clave
  (coincidencias exactas normalizadas, sin IA).

**Dominio clínico / agenda (Fase 2)**

- Lectura de agendas, profesionales, servicios, cupos (“slots”) y citas.
- Historial / expediente del paciente (según lo modelado).
- Ajustes del tenant.
- Simulador con maestros y generación de cupos para pruebas.
- Seed determinista de dos tenants (datos de prueba reproducibles).

**Infraestructura y calidad**

- Health check, envoltura de errores REST, cabecera `X-Request-Id`.
- OpenAPI generado; cliente del frontend regenerado.
- Docker / despliegue verificado; suite de tests por comportamiento (`fronteras`,
  `roles`, `dominio`, `sin-ia`, etc.).
- Panel operativo rediseñado (tablero; ver `DESIGN.md`).

### Qué está construyendo la 3.2 (ahora)

La pre-agenda es la mecánica de **solicitudes** sobre la agenda, todavía **sin chat**:

- Crear solicitudes de tipo `book` (agendar), `reschedule` (reprogramar) o `cancel`.
- Apartar un cupo de forma **atómica**: pasa de `free` (libre) a `busy_tentative`
  (ocupado tentativo) en la misma transacción, para que dos usuarios no tomen el mismo
  horario.
- Las solicitudes **vencen**; el vencimiento se evalúa **al leer** (y al crear), no solo
  con un job nocturno.
- Bandeja del simulador: listar / aprobar / rechazar, dejando cupos y citas coherentes
  entre el chatbot y el simulador.
- Idempotencia de esas escrituras en base de datos.

Cuando la 3.2 cierre, el motor conversacional (3.3) podrá llamar a esos casos de uso;
Hermes real (Fase 4) los invocará por FHIR sin reinventar la lógica.

---

## 5. Qué viene después

### Resto de la Fase 3

| Sub-fase | Qué añade |
| --- | --- |
| **3.3 Motor conversacional** | Conversaciones, flujo determinista, verificación de identidad (con bloqueos y sin persistir respuestas), pre-registro, creación de “handoff-tickets” (tickets para que un humano tome el chat) |
| **3.4 Frontend del chat** | Consola `/chat`, UI de bandeja, páginas de KB y config |

Criterio de la Fase 3 completa: un paciente puede recorrer en el widget identificación →
verificación o pre-registro → agendar / reprogramar / cancelar / consultas / pedir
asesor, sin que dos solicitudes concurrentes aparten el mismo cupo.

### Fase 4 — FHIR e integración Hermes

- Lectura y escritura FHIR R4 (`Patient`, `Slot`, `Appointment`, `Task`, etc.).
- Las pre-agendas se exponen como recursos FHIR; Hermes confirma con `PUT`.
- El simulador cierra el ciclo **solo por FHIR** (como lo hará Hermes real).
- `GET /fhir/metadata` declara exactamente lo implementado (ni más ni menos).

### Fase 5 — Endurecimiento y entrega

- Rate limits compartidos (válidos con varias réplicas del servidor).
- Gestión de handoff-tickets en el panel.
- Barrido periódico de solicitudes vencidas.
- Auditoría completa, secretos fuera del compose, colección Postman E2E y pruebas de
  carga básica.

---

## 6. Mapa rápido de módulos del backend

| Módulo | Qué cubre |
| --- | --- |
| `auth` | Quién es el actor (roles, verificación de token) |
| `platform` | Alta de tenants y emisión de tokens de panel/servicio |
| `tenancy` | Ajustes del tenant |
| `bot-config` | Textos, parámetros y claves del widget |
| `knowledge` | Base de conocimiento |
| `widget` | Sesiones del chat embebido |
| `scheduling` | Agenda, cupos, citas y (en 3.2) solicitudes / pre-agenda |
| `patients` | Expediente / historial |
| `hermes-simulator` | Simulador (se apaga en producción) |
| `shared` | Reloj, IDs, idempotencia, auditoría, paginación… |

---

## 7. Dónde leer más

| Documento | Contenido |
| --- | --- |
| [`README.md`](../README.md) | Arranque local, variables, Docker |
| [`ROADMAP.md`](../ROADMAP.md) | Plan de las cinco fases del MVP, la Fase 6 y los criterios de cierre |
| [`GOBERNANZA.md`](../GOBERNANZA.md) | Reglas de trabajo y no negociables |
| [`DESIGN.md`](../DESIGN.md) | Sistema visual del panel |
| `docs/superpowers/specs/` | Diseños detallados por sub-fase (p. ej. 3.1, 3.2) |

---

## 8. Resumen en una frase

Construimos un **chatbot de agenda clínica determinista**, multitenant, sin IA, que
solo propone citas a Hermes; hoy ya tiene cimientos, dominio, configuración y (en
curso) la mecánica de pre-agenda; faltan el motor de conversación, la UI de chat, la
integración FHIR completa y el endurecimiento de producción.
