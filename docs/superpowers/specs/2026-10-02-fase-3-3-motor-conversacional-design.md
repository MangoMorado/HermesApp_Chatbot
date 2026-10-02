# Fase 3.3 — Motor conversacional (diseño)

> Estado: **implementada** en la rama `fase-3-3-motor-conversacional` (pendiente de merge por
> el usuario); **suites de BD de la 3.3 pendientes de ejecutar** (Postgres local caído durante
> la implementación). Plan en `docs/superpowers/plans/2026-10-02-fase-3-3-motor-conversacional.md`.
> Fuente del alcance: `ROADMAP.md` §Fase 3, entregables 3, 4 y 9; corte de sub-proyectos en la
> §1 de `2026-09-22-fase-3-1-tenant-listo-design.md`; requisito de entrada en su §11 (CORS).
> Manda `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

La 3.3 deja el chat funcionando **por HTTP**: un paciente, desde una sesión de widget, recorre
identificación → verificación o pre-registro → agendar / reprogramar / cancelar / consultas
generales / asesor. Todo es una máquina de estados determinista guiada por opciones; los
textos salen de `bot-config`, de la base de conocimiento o de datos de dominio.

Incluye: motor y pasos del flujo, conversaciones con historial redactado, verificación con
banco de preguntas y bloqueo, pre-registro, creación de handoff-tickets, CORS para las rutas
del widget y alta/baja individual de orígenes permitidos.

No incluye: consola `/chat` ni páginas de panel (3.4), lectura y gestión de handoffs (Fase 5),
confirmación del pre-registro por Hermes vía FHIR (Fase 4).

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Interacción | Guiada por opciones; texto libre solo en captura de datos y en la consulta a la KB | Determinista, testeable, sin clasificación de intenciones |
| Verificación | 2 preguntas sorteadas de un banco extensible en código | Pedido del producto; agregar una pregunta no toca motor ni esquema |
| Par fijo | El par se sortea la primera vez que se identifica un documento y se mantiene entre sesiones y tras el bloqueo; solo se re-sortea tras verificar con éxito | Re-sortear por sesión permitiría pescar el par más fácil |
| Bloqueo | `verification_max_attempts` (3) fallos → `verification_lock_minutes` (30); salida por asesor | Resistencia a fuerza bruta sin dejar al paciente sin camino |
| Pre-registro | Aviso de datos (Ley 1581) → nombres, apellidos, fecha de nacimiento, celular (obligatorio), correo (opcional) → confirmación | Con celular el banco tiene preguntas no derivadas de la fecha |
| Conversación | Estado + historial con los mensajes sensibles del paciente redactados | El asesor (Fase 5) y la consola (3.4) necesitan contexto sin datos sensibles |
| Motor | Pasos puros en `domain` que devuelven estado, mensajes y **efectos**; `application` carga hechos y ejecuta efectos | El flujo se prueba sin base de datos; respeta las fronteras hexagonales |
| CORS | En el backend, solo rutas del widget, origen exacto validado contra `allowed_origins`, sin comodín | El widget vive en dominios de las clínicas; el proxy no sirve ahí |
| Orígenes por API | `POST`/`DELETE /api/v1/bot-config/allowed-origins` (rol `admin`); `PATCH` sigue reemplazando la lista | Evita la carrera de leer-modificar-escribir la lista entera |
| Errores | Sin códigos nuevos: `409 conflict` con `details.reason` | El contrato de errores REST no cambia |

## 3. Arquitectura del backend

### 3.1 Módulos

```
backend/src/modules/
  conversation/   # nuevo: motor, pasos, conversaciones y mensajes
  verification/   # nuevo: banco de preguntas, sorteo, intentos y bloqueo
  handoff/        # nuevo: creación de tickets
  patients/       # se amplía: pre-registro
  bot-config/     # se amplía: textos, parámetros, alta/baja de un origen
backend/src/composition/
  conversation-wiring.ts
backend/src/http/
  cors.ts         # CORS de las rutas del widget
```

- `conversation` no importa `scheduling`, `patients`, `knowledge`, `verification` ni
  `handoff`: declara puertos (`ConversationFacts`, `ConversationEffects`) y el composition root
  los cumple con los casos de uso de cada módulo. Lo vigila `fronteras`.
- `verification` es puro en su dominio (banco, sorteo, comparación); su persistencia es solo el
  desafío y los contadores.
- El chatbot sigue sin conocer el simulador.

### 3.2 Motor

```ts
type Step = {
  readonly id: StepId;
  needs(context: ConversationContext): FactRequest[];          // qué cargar antes
  handle(input: PatientInput, context: ConversationContext, facts: Facts): StepResult;
};

type StepResult = {
  readonly next: StepId;
  readonly context: ConversationContext;   // nuevo contexto (sin respuestas de verificación)
  readonly turns: BotTurn[];               // clave de texto + parámetros + opciones
  readonly effects: Effect[];              // ejecutados por application, en una transacción
  readonly redactInput: boolean;           // el mensaje del paciente se guarda como [redactado]
};
```

`Effect` es una unión cerrada: `createAppointmentRequest`, `preRegisterPatient`,
`createHandoffTicket`, `recordVerificationResult`. Un efecto que falla con un error de dominio
conocido (`slot_taken`, tope de pendientes, solicitud viva sobre la cita) no rompe la petición:
`application` vuelve a invocar al paso con el resultado del efecto para que elija el mensaje.

`BotTurn` = `{ textKey, params, options: [{ id, labelKey | label }], input }`, con
`input` ∈ `none` · `text` · `date`. Los textos se resuelven con `effectiveConfig` al responder;
las etiquetas de datos de dominio (servicios, profesionales, fechas) van ya formateadas.

Un paso por archivo; cada `handle` ≤ 40 líneas y complejidad cognitiva ≤ 15.

### 3.3 Modelo de datos (schema `public`)

`conversations`

| Campo | Notas |
| --- | --- |
| `id`, `tenant_id` | UUID v7 |
| `widget_session_id` | Único por `(tenant_id, widget_session_id)`; FK compuesta |
| `step` | `StepId` actual |
| `context` | JSON: opciones vigentes del turno, selección en curso, borrador del pre-registro (se borra al confirmar o abandonar) |
| `medical_record_id` | Nulo hasta verificar o pre-registrar |
| `created_at`, `updated_at` | |

`conversation_messages`

| Campo | Notas |
| --- | --- |
| `id`, `tenant_id`, `conversation_id` | |
| `author` | enum `bot` · `patient` |
| `text` | Texto mostrado; `[redactado]` si `redacted` |
| `redacted` | Respuestas de verificación y datos del pre-registro |
| `created_at` | |

`verification_challenges`

| Campo | Notas |
| --- | --- |
| `tenant_id`, `medical_record_id` | Único por ambos |
| `question_ids` | `text[]` de longitud 2 |
| `failed_attempts`, `locked_until` | `locked_until` se evalúa al leer |
| `created_at`, `updated_at` | |

`handoff_tickets`

| Campo | Notas |
| --- | --- |
| `id`, `tenant_id`, `conversation_id` | |
| `reason` | enum `requested` · `verification_locked` · `unverifiable` |
| `status` | enum `open` (la Fase 5 añade los demás) |
| `medical_record_id` | Si ya se conoce |
| `created_at` | |

Ninguna tabla guarda respuestas de verificación. Las FK son compuestas `(tenant_id, …)` como en
el resto del esquema.

## 4. Contratos HTTP

### 4.1 Chat (`/api/v1`, rol `widget`)

| Método y ruta | Uso |
| --- | --- |
| `GET /widget/conversation` | Turno actual + historial redactado; crea la conversación con `welcome` si no existe |
| `POST /widget/conversation/messages` | `{ "option_id": "…" }` o `{ "text": "…" }`; `Idempotency-Key`; responde los turnos nuevos del bot |

- La conversación sale del `session_id` del token; no hay id en la ruta ni en el cuerpo.
- `option_id` que no está en las opciones vigentes → `409 conflict`, `details.reason = "stale_option"`.
- Ni `option_id` ni `text`, o ambos → `422 validation_failed`. `text` de 1 a 500 caracteres.
- Sesión vencida → `401`. Las respuestas de verificación nunca aparecen en la respuesta HTTP más
  allá del eco redactado.

### 4.2 Orígenes permitidos (`/api/v1`, rol `admin`)

| Método y ruta | Uso |
| --- | --- |
| `POST /bot-config/allowed-origins` | `{ "origin": "https://…" }`; si ya existe, 200 sin cambios; `Idempotency-Key` |
| `DELETE /bot-config/allowed-origins/{origin}` | Quita uno (origen codificado en la URL); si no existe, `404` |

Mismas reglas que el `PATCH`: máximo 20, origen exacto `https://host[:puerto]`, `http://localhost:*`
fuera de producción. Responden la configuración efectiva.

### 4.3 CORS

- Solo `widget/sessions`, `widget/sessions/refresh` y `widget/conversation*`. El resto de
  `/api/v1` no envía cabeceras CORS.
- Apertura de sesión: el `Origin` debe estar en `allowed_origins` del tenant de la clave.
  Rutas con token: el `Origin` debe coincidir con el origen guardado en la sesión.
- Respuesta: `Access-Control-Allow-Origin: <origen exacto>`, `Vary: Origin`; sin comodín ni
  credenciales de cookie. `OPTIONS` responde con métodos y cabeceras permitidas
  (`Authorization`, `Content-Type`, `Idempotency-Key`, `X-Request-Id`) y expone `X-Request-Id`.
- Origen no admitido: sin cabeceras CORS (el navegador bloquea); la lógica actual de
  admisión no cambia.

## 5. Reglas de dominio

### 5.1 Flujo

```
welcome → menú principal
  ├─ Consultas generales → texto → búsqueda KB (kb_max_results)
  │     → respuesta + «Ver más» (detail) / «Otra consulta» / «Menú»
  │     → sin resultados: mensaje + «Hablar con un asesor»
  ├─ Hablar con un asesor → handoff (requested) → cierre
  └─ Mis citas → identificación (si no está verificado)
        tipo de documento (opciones) → número (texto)
        ├─ existe → bloqueado → mensaje + asesor (verification_locked)
        │           sin preguntas posibles → asesor (unverifiable)
        │           pregunta 1 → pregunta 2 → verificado | reintento | bloqueo
        └─ no existe → aviso de datos → pre-registro → verificado
     → Agendar · Reprogramar · Cancelar · Menú
```

- **Agendar:** servicio → profesional («Cualquiera») → día (próximos días con cupo, 5 por
  pantalla + «Ver más días») → hora (6 por pantalla + «Ver más») → confirmación →
  `book`. El mensaje final dice que es una **solicitud** y hasta cuándo se guarda el cupo.
- **Reprogramar:** cita futura `booked` del paciente → día → hora (mismo servicio) →
  confirmación → `reschedule`.
- **Cancelar:** cita → confirmación → `cancel`.
- Errores de la pre-agenda: `slot_taken` → «ese horario se acaba de ocupar» y vuelve a horas;
  tope de pendientes → «ya tienes N solicitudes pendientes»; solicitud viva sobre la cita → se
  informa y vuelve al submenú.
- Toda pantalla ofrece «Menú» y «Hablar con un asesor», salvo las de verificación, que solo
  ofrecen «Cancelar».
- Texto donde se esperaba opción → repite el turno con `invalid_option`.
- La verificación vale lo que dura la sesión del widget.
- Las opciones vigentes se guardan en `context`; los ids son opacos y válidos solo para ese
  turno.

### 5.2 Verificación

Banco en `verification/domain/questions.ts`, un registro de objetos:

```ts
type VerificationQuestion = {
  readonly id: string;                       // p. ej. "birth_month"
  readonly source: "birth_date" | "phone" | "email";
  readonly textKey: TextKey;                 // redacción configurable por tenant
  readonly input: "text" | "options";
  isAvailable(record: VerifiableRecord): boolean;
  expected(record: VerifiableRecord): string;  // ya normalizado
  normalize(raw: string): string;
  options?(record: VerifiableRecord, random: Random): string[];  // si input = options
};
```

Banco inicial: `birth_day`, `birth_month`, `birth_year`, `phone_last_4`, `phone_first_3`,
`email_hint` (inicial y dominio, por opciones). Agregar una pregunta = añadir una entrada al
registro y su texto predeterminado.

- **Sorteo** (puro, con un puerto `Random` para poder fijarlo en pruebas): 2 preguntas
  disponibles, de `source` distintas si es posible; si solo hay `birth_date`, 2 preguntas
  distintas de fecha. Menos de 2 disponibles → `unverifiable`.
- **Par fijo:** el par se guarda en `verification_challenges` al primer intento y se reutiliza
  en cualquier sesión. Se re-sortea solo tras verificar con éxito (y el contador vuelve a 0).
- **Intento:** responder ambas preguntas. Cualquier fallo cuenta uno; el mensaje no dice cuál.
  Al llegar a `verification_max_attempts` → `locked_until = now + verification_lock_minutes`.
  Al vencer el bloqueo, el contador vuelve a 0 con el mismo par.
- La primera respuesta se guarda en `context` solo como «pregunta 1 correcta: sí/no» hasta
  responder la segunda; nunca el valor. Las comparaciones ocurren en memoria.
- Al identificar, el mensaje y el tiempo de respuesta antes de preguntar no distinguen si el
  documento existe. Riesgo aceptado y documentado: la oferta de pre-registro revela que un
  documento no existe en el tenant; lo mitiga el rate limit por IP de las sesiones.

### 5.3 Pre-registro

Aviso de datos (`privacy_notice`, «Acepto» / «No acepto»; no aceptar vuelve al menú) →
nombres → apellidos → fecha de nacimiento → celular (obligatorio) → correo (opcional,
«Omitir») → resumen y confirmación. Validación pura en `patients/domain`. Al confirmar: un
`medical_records` `pre_registered` en la misma transacción que la conversación pasa a
verificada. Documento ya existente por carrera → se trata como identificación normal.

### 5.4 `bot-config`

Parámetros nuevos:

| `params` | Defecto | Rango |
| --- | --- | --- |
| `verification_max_attempts` | 3 | 1–5 |
| `verification_lock_minutes` | 30 | 5–1440 |

Textos nuevos (≈ 40 claves) con predeterminado en `DEFAULT_TEXTS`: menú, KB, identificación,
preguntas de verificación, pre-registro, agenda, errores y cierre. Marcadores admitidos
adicionales solo donde el paso los provee (p. ej. `{count}`, `{hold_until}`); se valida por
clave.

## 6. Seguridad y no divulgación

- Respuestas de verificación: ni en `conversation_messages`, ni en `context`, ni en auditoría,
  ni en logs, ni en el cuerpo de respuesta.
- Datos del pre-registro en mensajes: `[redactado]`. El número de documento se ecoa enmascarado
  (`CC ••••5678`).
- Auditoría de hechos: `verification.succeeded`, `verification.failed`, `verification.locked`,
  `patient.pre_registered`, `handoff.created`, `conversation.request_created`; `resource_id`
  es el id del expediente, de la conversación o de la solicitud, nunca el documento.
- Rol `widget`: solo su conversación; ninguna ruta de dominio ni `/fhir`.
- `GOBERNANZA.md` se actualiza en la PR de implementación: política de verificación (banco,
  par fijo, bloqueo) y de redacción de mensajes.

## 7. Pruebas

| Suite | Cubre |
| --- | --- |
| `flujo` (pura) | Tablas de transición de cada paso: menú, KB, identificación, pre-registro, agendar, reprogramar, cancelar, handoff, opción inválida y vencida, errores de la pre-agenda |
| `verificacion` (pura + BD) | Sorteo con fuentes distintas, par fijo entre sesiones, bloqueo y desbloqueo con el mismo par, re-sorteo tras éxito, `unverifiable`, registro extensible; búsqueda del valor de la respuesta en todas las tablas y en la auditoría → ausente |
| `flujo-http` (BD) | Recorrido por HTTP: sesión → pre-registro → agendar → la solicitud aparece en la bandeja del simulador; y paciente existente → verificación → cancelar |
| `aislamiento-tenant` | Se amplía al chat: token de otra sesión u otro tenant → `404` |
| `idempotencia` | Se amplía a `messages` y `allowed-origins` |
| `roles` | `widget` solo `/widget/conversation*`; `operator` no gestiona orígenes |
| `contrato-api` | Rutas nuevas declaradas en OpenAPI |
| `cors` | Origen permitido / denegado / distinto al de la sesión, `OPTIONS`, sin comodín |
| `fronteras` | `conversation` no importa otros módulos; `domain` sin Next/Prisma/`node:*` |

## 8. Fuera de alcance

- Consola `/chat`, bandeja, páginas de KB y config (3.4).
- Lectura y gestión de handoff-tickets (Fase 5).
- Confirmación del pre-registro por Hermes (Fase 4).
- Barrido periódico de bloqueos y conversaciones vencidas (Fase 5); todo se evalúa al leer.
- Store compartido para rate limits (Fase 5).

## 9. Refinamientos del plan

1. **Lecturas por puerto, escrituras declaradas.** En vez de `needs()` + `facts`, los pasos leen por un puerto de solo lectura `ConversationReads` (asíncrono; en pruebas es un objeto en memoria). Las escrituras siguen siendo declarativas: cada `handle` devuelve **a lo sumo un** `Effect` y una continuación pura `then(outcome)`.
2. **Efectos dentro de un `SAVEPOINT`.** `createAppointmentRequest` puede lanzar una violación de unicidad de Postgres, que aborta la transacción. El ejecutor abre `SAVEPOINT` antes del efecto y hace `ROLLBACK TO SAVEPOINT` si falla: el cupo vuelve a su estado y la conversación sigue avanzando con el fallo traducido.
3. **El par se guarda al sortearlo** (efecto `open_challenge`), no al primer intento: si se guardara al responder, abandonar antes de contestar permitiría re-sortear hasta dar con el par más fácil.
4. **`conversation/domain` importa `verification/domain`** (puro, sin E/S) para evaluar respuestas. Nada más de otros módulos.
5. **Texto libre del paciente siempre redactado**, incluida la consulta a la KB (puede traer datos clínicos). El documento se guarda enmascarado. Las líneas del bot también pueden ir redactadas (resumen del pre-registro): se guardan como `[redactado]` y solo viajan completas en la respuesta del `POST`.
6. **Forma de las respuestas:** `POST /widget/conversation/messages` → `{ messages: string[], options: [{id,label}], input }`; `GET /widget/conversation` → `{ messages: [{author,text,redacted,created_at}], options, input }`.
7. **CORS:** una petición previa (`OPTIONS`) no trae cuerpo ni token, así que no puede saber el tenant. Se responde `Access-Control-Allow-Origin` con el origen exacto si está en los `allowed_origins` de **algún** tenant (índice GIN). El control por tenant se mantiene: la apertura lo hace `admitWidget` (`403`) y las rutas con token responden `403 forbidden` si llega `Origin` distinto del de la sesión.
8. **Auditoría:** no hay `conversation.request_created`; la solicitud ya audita `appointment_request.created` con el actor `widget:<sesión>`. Se añaden `verification.succeeded|failed|locked`, `patient.pre_registered`, `handoff.created`, `bot_config.origin_added|origin_removed`.
9. **Orden de mensajes por `seq`** (`conversations.message_count`), no por `created_at`.
10. **Repetición idempotente de mensajes** comprueba la sesión: una `Idempotency-Key` usada por otra sesión del tenant responde `409`, nunca la respuesta ajena.
11. **Identificador del pre-registro:** `identifier_system = "urn:ingenius:pre-registration"`, `identifier_value` = id del expediente. Hermes asigna el suyo en la Fase 4.
12. **`email_hint` con señuelos deterministas** por expediente (hash del id): si cambiaran en cada sesión, la intersección de las listas revelaría la respuesta. La pregunta solo se ofrece si el dominio del correo es de un proveedor común (gmail, hotmail, outlook, yahoo, icloud, live); los señuelos varían en inicial y dominio, así que el conjunto no delata el dominio real a quien aún no se verifica.
13. **El ticket de handoff solo enlaza el expediente si el paciente ya verificó** en la sesión; un documento solo declarado no se asocia.
14. **Validación del pre-registro duplicada a propósito:** `conversation` valida campo a campo para la UX y `patients` valida el conjunto (autoritativo). DRY al tercer uso.
15. **Hash con clave en `idempotency_keys` para el chat.** El hash SHA-256 del cuerpo permitiría recuperar por fuerza bruta una respuesta de 4 dígitos. La ruta de mensajes usa HMAC-SHA256 (clave: el secreto JWT) y guarda la respuesta con las líneas redactadas.
16. **Sesión de otro tenant → `401`**, no `404`: el token apunta a una sesión que no existe para su tenant, igual que en `POST /widget/sessions/refresh`.
17. **`then` → `onOutcome`.** La continuación pura de cada paso se llama `onOutcome(outcome)`: recibe el resultado del efecto (o su fallo traducido) y `then` se confundía con el método de las promesas (los objetos con `then` se tratan como *thenables*).
18. **`guard` en `idempotentRoute`.** Las rutas con token del widget pasan un `guard` que comprueba sesión y origen también en las repeticiones idempotentes; sin él, una respuesta guardada se serviría sin esa comprobación.
19. **Lista de días de agendamiento acotada:** lee como máximo 200 cupos libres dentro de 30 días.
20. **Un ticket de handoff por conversación** (`handoffRequested` en el contexto): elegir Asesor otra vez cierra sin crear otro ticket.
