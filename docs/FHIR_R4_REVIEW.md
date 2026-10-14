# Revisión FHIR R4 de la Fase 4

> Fecha: 2026-10-14. Rama: `fase-4-2-fhir-escritura-maestros` (en `c17c039`).
> Alcance: specs de la 4.1 (`2026-10-13-fase-4-1-fhir-base-lectura-design.md`) y de la 4.2
> (`2026-10-13-fase-4-2-fhir-escritura-maestros-design.md`), plan de la 4.2 y el código FHIR
> ya en la rama: `profiles.ts`, `registry.ts`, `capability-statement.ts`, mappers y parsers.
> Criterio: especificación FHIR R4 (`4.0.1`), con la skill `fhir-developer-skill`. Manda
> `GOBERNANZA.md` ante cualquier conflicto.

> Resolución: los hallazgos 1–14 quedaron incorporados en la rama de la 4.2; los hallazgos
> 15–17 se reservan para la spec de la 4.3.

Esta revisión no modifica specs, planes ni código. Cada hallazgo indica dónde está y qué se
propone.

## Resumen y prioridad

| # | Hallazgo | Severidad | Dónde |
| --- | --- | --- | --- |
| 1 | `metadata` declara `update` y `updateCreate`, pero el `PUT` por id responde `405` | Alta | Plan 4.2, Tarea 5; spec 4.2 §2 y §5 |
| 6 | Los parsers rechazan elementos R4 válidos (`meta`, `text`, `use`, `extension`) | Alta | `parsers/body.ts`, `parsers/patient.ts` |
| 9 | El plan lee `Idempotency-Key` antes de enrutar: `400` en vez de `405`/`404` | Alta | Plan 4.2, Tarea 6 |
| 2 | El `id` del cuerpo se ignora; R4 pide `400` si no coincide | Media | Spec 4.2 §2 |
| 3 | Errores de perfil o de regla de negocio como `400` en vez de `422` | Media | Spec 4.2 §5 |
| 4 | `412` con `issue.code` `conflict` en vez de `multiple-matches` | Media | Spec 4.2 §5; plan 4.2, Tarea 1 |
| 5 | `Content-Type` no soportado → `400` en vez de `415`; rechaza `application/json` | Media | Plan 4.2, Tarea 6 |
| 8 | Un apartado del chatbot bloquea cambios de Hermes (`409`) | Decisión de producto | Spec 4.2 §2 y §4.2 |
| 7 | `Idempotency-Key` obligatoria y no estándar, sin anunciar en `metadata` | Baja | Spec 4.2 §2 |
| 10 | `Location` se calcula dos veces | Baja | Plan 4.2, Tarea 6 |
| 11–14 | Detalles de la 4.1: `WWW-Authenticate`, versionado, `Patient.active`, estado de la spec | Baja | 4.1 |
| 15–17 | Puntos para la spec de la 4.3 | Para planificar | 4.3 |

**Antes de seguir con la Tarea 2 de la 4.2:** los hallazgos 1, 6 y 9, porque afectan al
contrato. El 2, el 3 y el 4 son baratos de ajustar ahora en la spec. El 8 es una decisión de
producto.

## Lo que choca con FHIR R4

### 1. `metadata` declara algo que el servidor no hace

- El plan (Tarea 5) emite la interacción `update` con `conditionalUpdate: true` y
  `updateCreate: true` en los cinco tipos.
- La spec 4.2 (§2 «Ruta», §5) responde `405` al `PUT /fhir/{Tipo}/{id}`.
- En R4, la interacción `update` es `PUT [type]/[id]`. El update condicional no es otra
  interacción: es la bandera `conditionalUpdate` sobre `update`. Declarar `update` promete el
  `PUT` por id.
- `updateCreate: true` significa que el cliente puede crear un recurso con un id que él elige
  (`PUT` a un id que no existe). Aquí los ids los asigna el servidor.
- Rompe el no negociable «`metadata` declara exactamente lo implementado». La prueba de
  metadata exacta del plan no lo detecta, porque solo ejecuta el `PUT` condicional.

**Propuesta.** En los dos casos, `updateCreate: false`. Y una de dos:

- implementar `PUT /fhir/{Tipo}/{id}` solo para recursos existentes (`404` si no existe);
- mantener el `405` y explicar la limitación en `rest.resource.documentation`.

En ambos casos, la prueba de metadata exacta debe probar también el `PUT` por id.

### 2. El `id` lógico del cuerpo no se puede ignorar

La spec 4.2 §2 («Cuerpo») dice que el `id` del cuerpo se ignora. Las reglas del update
condicional de R4 dicen otra cosa:

| Caso | Respuesta R4 |
| --- | --- |
| Sin coincidencias, sin `id` en el cuerpo | Crea (`201`) |
| Una coincidencia, sin `id` o con el `id` del recurso encontrado | Actualiza (`200`) |
| Una coincidencia, con un `id` distinto | `400` |
| Varias coincidencias | `412` |

Ignorar un `id` distinto esconde que Hermes apuntó a otro recurso.

**Propuesta.** Aceptar que el `id` falte o coincida; si difiere, `400` `invalid`. Si no hay
coincidencias y el cuerpo trae `id`, `400`, porque no se admiten ids del cliente
(coherente con `updateCreate: false`).

### 3. `400` frente a `422`

R4 (http.html, «Rejecting Updates») distingue:

- `400 Bad Request`: el recurso no se puede leer o falla la validación básica de FHIR;
- `422 Unprocessable Entity`: el recurso viola el perfil o las reglas de negocio del servidor.

La tabla de la spec 4.2 §5 usa `400` para todo. Deberían ser `422`:

- una referencia que no existe en el tenant (`Schedule.actor`, `Slot.schedule`);
- un identificador de negocio inválido (system de documento o `urn:ingenius:pre-registration`);
- `start ≥ end` en `Slot`, o una fecha sin offset;
- el tag `pre-registered` en el cuerpo;
- un campo fuera del perfil del servidor;
- un campo obligatorio de negocio que falta (documento, `birthDate`).

Se quedan en `400`: el JSON mal formado, un `resourceType` que no coincide con la ruta y una
query mal formada.

**Propuesta.** Añadir a `fhir-error.ts` una fábrica `422` (`issue.code` `processing`,
`business-rule` o `structure` según el caso) y actualizar la tabla §5 y los tests.

### 4. Código del `412`

La spec y el plan (`fhirMultipleMatches`) usan `issue.code` `conflict` para el `412`. R4 tiene
el código `multiple-matches` en el value set `issue-type`, que describe exactamente esta
situación.

**Propuesta.** `412` con `multiple-matches`. Añadirlo a `IssueCode` en `resources/types.ts`.

### 5. `Content-Type`

El plan (Tarea 6) responde `400` `invalid` si la cabecera no incluye `application/fhir+json`.

- Lo correcto para un tipo de contenido no soportado es `415 Unsupported Media Type`.
- R4 exige soportar `application/fhir+json` y permite aceptar también `application/json`, que
  muchos clientes envían.

**Propuesta.** Aceptar `application/fhir+json` y `application/json`; cualquier otro, `415`
`not-supported`.

## Interoperabilidad con Hermes

### 6. Los parsers rechazan elementos R4 válidos

`assertNoExtraKeys` se aplica a la raíz y también dentro de los tipos de dato: `identifier`
(`body.ts`), `name` y `telecom` (`patient.ts`) y `reference`. Con eso falla un cuerpo correcto
que traiga cualquiera de estos campos:

- `meta` con `versionId`, `lastUpdated` o `profile`;
- `text` (narrativa);
- `identifier.use`, `identifier.type`, `identifier.period`;
- `name.use`, `name.text`, `name.prefix`;
- `telecom.use`, `telecom.rank`;
- `reference.display`, `reference.type`;
- `extension` en cualquier nivel.

Casi cualquier cliente FHIR (HAPI, Firely) los envía, sobre todo cuando lee un recurso, lo
modifica y lo reescribe. El resultado es una integración muy frágil.

**Propuesta.** Separar tres grupos:

- **Se ignoran:** `meta` salvo `meta.tag`, `text`, los `use`, `period`, `rank`,
  `reference.display` y las `extension` sin `modifierExtension`.
- **Se rechazan con `422`:** los campos con significado que el servidor no guarda (`gender`,
  `deceased[x]`, `address`, `qualification`…). Así Hermes sabe que ese dato no se persiste.
- **Siempre se rechaza:** `modifierExtension`, porque cambia el significado del recurso.

La spec 4.2 §2 justifica el rechazo estricto con la simetría lectura/escritura. Ignorar los
metadatos y la narrativa no rompe esa simetría: no son datos que el servidor guarde.

### 7. `Idempotency-Key` obligatoria en `/fhir`

- No es una cabecera de FHIR, y el update condicional ya es idempotente por diseño: repetir el
  mismo `PUT` deja un solo recurso (criterio 2 de la fase).
- La gobernanza §1.6 la exige para toda escritura, así que esto no es un error.
- Un cliente FHIR estándar recibiría `400` sin saber por qué.

**Propuesta.** Anunciarla en `CapabilityStatement.rest.documentation` y en el
`diagnostics` del `400`. Si la gobernanza lo admite algún día, que sea opcional en `/fhir`.

### 8. Tensión con «Hermes es la fuente de verdad»

Con un apartado vivo, la spec 4.2 (§2 «Cupo apartado», §4.2) solo acepta `busy` o
`busy-unavailable`. Si Hermes mueve el cupo, le cambia la agenda o lo pone en `free`, recibe
`409`. Eso significa que una solicitud del chatbot bloquea a la fuente de verdad, y la
sincronización de Hermes se queda trabada hasta que el apartado vence.

Además, nada impide que Hermes escriba `busy-tentative` en un cupo sin solicitud. El chatbot lo
leería como un apartado propio que no existe.

**Alternativa coherente con el no negociable.** Aceptar cualquier cambio de Hermes sobre un
cupo apartado y, en la misma transacción, rechazar la solicitud:

- `busy` o `busy-unavailable` → `rejected` / `slot_unavailable` (lo que ya está);
- cambio de inicio, fin o agenda, o `free` → `rejected` con un motivo propio (por ejemplo
  `slot_changed`).

Y rechazar con `422` que Hermes escriba `busy-tentative`, porque ese estado es del chatbot.
Es una decisión de producto: el diseño actual también es defendible si se documenta que Hermes
debe esperar al vencimiento.

**Decisión (2026-10-14): se mantiene el diseño actual (opción A).** Queda registrada en la
spec 4.2 §10.7. La sincronización de la 4.4 debe tratar el `409` como «reintentar más tarde».

## Incoherencias entre el plan y la spec

### 9. Orden de comprobación en la Tarea 6

En `handleFhirWrite`, las comprobaciones de método, ruta y tipo van dentro del `execute` de
`serviceFhirIdempotentRoute`, y `readIdempotentRequest` corre antes. Resultado:

| Petición sin `Idempotency-Key` | Espera la spec | Da el plan |
| --- | --- | --- |
| `DELETE /fhir/Patient?…` | `405` | `400` |
| `PUT /fhir/Patient/123` | `405` (`Allow: GET`) | `400` |
| `PUT /fhir/Appointment?…` | `405` (`Allow: GET`) | `400` |
| `PUT /fhir/Foo?…` | `404` | `400` |

La spec §4 fija el orden: autenticación y rol, después enrutado (`405`/`404`) y después la
clave. Además, `readIdempotentRequest` parsea el cuerpo antes de que se valide el
`Content-Type`.

**Propuesta.** En `fhir-dispatch.ts`, resolver método, segmentos, tipo y si es escribible
antes de entrar en `serviceFhirIdempotentRoute`. Dentro, validar el `Content-Type` antes de
leer el cuerpo. Añadir a las suites las filas de la tabla sin clave.

### 10. `Location` duplicado

En la Tarea 6, `execute` devuelve `location` y el envoltorio lo vuelve a calcular a partir del
cuerpo guardado. Basta con una: la del envoltorio, porque también sirve para la repetición
idempotente.

## Menores de la 4.1

### 11. `401` sin `WWW-Authenticate`

RFC 6750 exige la cabecera `WWW-Authenticate: Bearer` en el `401`. `fhir-route.ts` no la
emite. Se puede añadir sin revelar la causa (spec 4.1 §4.6).

### 12. Versionado no declarado

No hay `meta.versionId`, `meta.lastUpdated` ni `ETag`. Es válido, pero el
`CapabilityStatement` debería decirlo en cada recurso: `versioning: "no-version"` y
`readHistory: false`. También sirve para justificar que no se soporta `If-Match` (spec 4.2 §8).

### 13. `Patient.active` en pre-registros

`toPatient` siempre emite `active: true`, también para expedientes `pre_registered`. El tag
`pre-registered` los distingue, pero `active` afirma algo que Hermes todavía no ha confirmado.
Opciones: omitir `active` en los pre-registros, o documentar que `active` no implica
confirmación.

### 14. Estado de la spec 4.1

La cabecera de `2026-10-13-fase-4-1-fhir-base-lectura-design.md` sigue diciendo «pendiente de
merge», pero la 4.1 ya está en `main` (PR #9).

## Para la spec de la 4.3

### 15. Extensión `replaces-appointment`

R4 no tiene una extensión estándar con ese nombre; `Appointment.replaces` llega en R5. Lo
estándar en R4 es la extensión de versión cruzada:

```
http://hl7.org/fhir/5.0/StructureDefinition/extension-Appointment.replaces
```

con `valueReference` a `Appointment/{id}`. La URL va en `profiles.ts`.

### 16. `Task` de cancelación

- `status` e `intent` son obligatorios (1..1). Para `intent`, lo lógico es `proposal` (el
  chatbot propone) u `order`.
- Estados: `requested` → `completed` o `rejected`. El vencimiento puede usar `cancelled`.
- `focus` apunta al `Appointment` que se cancela; `for`, al `Patient`.
- El motivo del rechazo, incluido `slot_unavailable`, va en `statusReason`.
- Parámetros de búsqueda mínimos: `status`, `focus`, `patient`, `identifier`.

### 17. Participantes de un `Appointment` `proposed`

`toAppointment` fija `participant.status = "accepted"` para los tres participantes. Es correcto
en citas en firme, pero no en una solicitud:

- `participant.status` es obligatorio (1..1) en cada participante;
- en una cita `proposed`, el paciente iría como `accepted` (la pidió) y el profesional y el
  servicio como `needs-action` o `tentative`, hasta que Hermes resuelva;
- R4 permite que una cita `proposed` no tenga `start` ni `end` (`app-3`), pero aquí siempre los
  tendrá porque sale de un cupo.

El mapper tendrá que distinguir el estado. Como los mappers no se unifican, conviene decidirlo
en la spec de la 4.3.
