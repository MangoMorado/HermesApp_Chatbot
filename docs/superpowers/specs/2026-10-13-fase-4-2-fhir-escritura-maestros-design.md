# Fase 4.2 — FHIR: escritura de maestros (diseño)

> Estado: **implementada** en la rama `fase-4-2-fhir-escritura-maestros`.
> Fuente del alcance: `ROADMAP.md` §Fase 4, entregables 2, 5 (escritura), 6 y 8; corte de
> sub-proyectos en la §1 de `2026-10-13-fase-4-1-fhir-base-lectura-design.md`. Manda
> `GOBERNANZA.md` ante cualquier conflicto.
> Versión FHIR: **R4 (`4.0.1`)**, confirmada con el equipo de Hermes el 2026-10-14. La
> revisión de conformidad R4 está en `docs/FHIR_R4_REVIEW.md`; la §10 recoge lo que cambia.

## 1. Objetivo y corte

La 4.2 abre la escritura en `/fhir`. Hermes, con rol `service`, da de alta y actualiza
maestros con un `PUT` condicional por `identifier`. El chatbot sigue sin confirmar citas:
ocupar un cupo apartado solo rechaza la solicitud que lo retenía.

| Sub-proyecto | Contenido | Entregables | Criterios |
| --- | --- | --- | --- |
| 4.1 Base y lectura | Cerrada en `main` | 1, 9, 11, 5 (lectura), 7 (`Slot`) | 7 (parcial), 5 (parcial) |
| **4.2 Escritura de maestros** (esta spec) | `PUT` condicional de cinco recursos, idempotencia, auditoría, conflicto de cupo, confirmación del pre-registro | 2, 5 (escritura), 6, 8 | 2, 3, 4, 6 |
| 4.3 Pre-agenda por FHIR | `Appointment` `proposed`, `Task`, vencimiento al leer de ambos | 3, 4, 7 | 5 |
| 4.4 Simulador por FHIR | Cliente FHIR con token `service` | 10 | 1, 7 (cierre) |

No hay migración. Las columnas de identificador, documento, estado del cupo, solicitudes y
`audit_events` ya existen. `idempotency_keys` también.

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Coincidencias | Cero coincidencias crea (`201`). Una actualiza (`200`). Más de una responde `412` y no escribe. En `Patient`, cero coincidencias puede confirmar un pre-registro en vez de crear; lo dice la fila siguiente | Upsert condicional de FHIR. El criterio 2 pide un solo recurso al repetir el mismo `PUT` |
| Carrera | Los índices únicos `(tenant, identifier_system, identifier_value)` y, en el paciente, `(tenant, document_type, document_number)` son el cierre. Una violación se traduce a `409`, no a `500` | Dos altas simultáneas del mismo identificador o del mismo documento no pueden dejar dos filas |
| Pre-registro | Si el documento del cuerpo es de un expediente `pre_registered` del tenant, se confirma ese expediente: mismo id interno, identificador de negocio del cuerpo, estado `active` | Las solicitudes y conversaciones siguen apuntando al mismo expediente. Hermes confirma; el chatbot no crea otro |
| Documento ajeno | Si ese documento ya es de un paciente `active`, o la query apunta a un expediente y el documento del cuerpo es de otro, `409`. No se fusiona ni se crea | El documento es único por tenant |
| Tag `pre-registered` en el cuerpo | `422` `business-rule` (§10) | Confirmar es escribir un `Patient` sin ese tag. Aceptarlo y guardarlo sin tag haría que el cuerpo no coincidiera con lo persistido |
| Identificador de negocio | Uno, distinto de los systems de documento y de `urn:ingenius:pre-registration`. En una confirmación sustituye al de pre-registro | El system concreto lo elige Hermes. No se fija `urn:hermes:patient` |
| Cupo apartado | Con una solicitud pendiente que lo aparta, el único `PUT` aceptado es `busy` o `busy-unavailable`. En la misma transacción el cupo queda así y la solicitud pasa a `rejected` / `slot_unavailable`. Cualquier otro cambio se rechaza con `409` | Una sincronización no suelta ni reescribe el apartado |
| Cupo libre de solicitud | Acepta el estado que mande Hermes, también en el alta | El criterio 4 habla del cupo apartado, no de todos los cupos |
| Vencimiento | Antes de evaluar el apartado se vencen las solicitudes vencidas del tenant, igual que en la lectura de `Slot` | Un apartado ya vencido no bloquea a Hermes |
| Cuerpo | El mismo recurso que ya devuelve la lectura. Se ignoran metadatos y narrativa; un elemento con significado que no se guarda → `422` (§10.2). El `identifier` de la query tiene que venir en el cuerpo. El `id` lógico del cuerpo puede faltar o coincidir con el del recurso encontrado; si difiere, o si no hay coincidencia y trae `id`, `400` (§10.3) | Lectura y escritura simétricas. El id interno lo asigna el servidor y no cambia |
| Referencias | `Schedule.actor` y `Slot.schedule` usan el id interno, como en la lectura. Si el profesional, el servicio o la agenda no existen en el tenant, `422` `processing` y no se crea | Misma forma que el `GET`. Es una regla del servidor, no un JSON mal formado (§10.4) |
| Ruta | Solo `PUT /fhir/{Tipo}?identifier=system\|value`, con un solo segmento. `PUT` por id, `Appointment` y el resto de métodos → `405`. El `PUT` por id llega en la 4.3, con la resolución de `Appointment` | El roadmap fija la actualización condicional. `metadata` documenta la restricción (§10.1) |
| Idempotencia | `Idempotency-Key` obligatoria, mínimo 1 carácter, mismo almacén que REST. El hash incluye método, ruta, query y cuerpo. La clave se reserva en la misma transacción que la escritura | Gobernanza §1.6. Dos `PUT` al mismo tipo con distinto `identifier` no comparten clave |
| Repetición | La misma clave y el mismo hash devuelven el `201` o el `200` guardados. Un rechazo revierte la transacción y no guarda la clave: repetirla vuelve a ejecutar | Igual que el adaptador REST: solo se persiste la respuesta que `execute` devuelve |
| Clave reutilizada | Misma clave con otro cuerpo o con otra query → `409` | La clave identifica una petición, no un recurso |
| Auditoría | Cada escritura aplicada deja un evento con el actor del token (`service`), la acción `*.written_by_hermes` y el id del recurso. Sin el cuerpo. El rechazo de la solicitud añade el evento que ya graba la resolución | Criterio 6 y gobernanza §1.5: el hecho, no el contenido |
| Dueño de las reglas | `fhir` parsea y traduce. `patients` confirma y hace el upsert de `Patient`. `scheduling` hace el upsert de los otros cuatro y el conflicto de cupo. El composition root cablea los puertos | El mismo corte que la lectura. `fhir` no importa esos módulos |
| `metadata` | Los cinco tipos declaran `update` con `documentation` que lo limita al `PUT` condicional, `conditionalUpdate: true` y `updateCreate: false`. `Appointment` no declara `update`. La fecha del contrato cambia | `metadata` declara exactamente lo implementado. Los ids los asigna el servidor, así que no hay `updateCreate` (§10.1) |

## 3. Arquitectura

`PUT` entra por `app/fhir/[[...path]]`. `serviceFhirRoute` exige rol `service` antes de
enrutar. Sin ese token la respuesta es `401` o `403`.

La idempotencia vive en un adaptador HTTP de FHIR, al lado del de REST, y reutiliza
`runIdempotent`. No comparte `errors.ts` ni `idempotentJson`: la respuesta es FHIR. Para que
la query entre en el hash, el adaptador pasa ruta + query como path al hash que ya existe.
Las rutas REST no cambian.

`fhir/application` gana el caso de uso del `PUT` condicional. Parsea la query y el cuerpo,
llama al puerto y devuelve el recurso con el mismo mapper de lectura. El parseo es uno por
recurso, junto a su mapper: `Patient` no comparte parser con `Practitioner`.

Los puertos nuevos están en `fhir/domain/ports/`. El comando lleva el tenant, el actor y los
campos ya validados. El resultado dice si creó, actualizó, hubo ambigüedad o conflicto.
`patients` y `scheduling` no lanzan `FhirError`.

`patients/application` gana el upsert de `Patient`. `scheduling/application` gana cuatro casos
de uso: `Practitioner`, `HealthcareService`, `Schedule` y `Slot`. El de `Slot` ocupa el cupo
y rechaza la solicitud en la misma transacción. Los adaptadores Prisma extienden los
repositorios que ya existen. `composition/fhir-wiring.ts` conecta los puertos con esos casos
de uso.

`http/fhir-dispatch.ts` acepta el `PUT` condicional de los cinco tipos. El registro declara
la interacción y `capability-statement.ts` la copia. `metadata` no se edita a mano.
`CAPABILITY_DATE` en `profiles.ts` pasa a la fecha en que cambia el contrato.

### 3.1 Campos que se guardan

| Recurso | Campos | Referencias |
| --- | --- | --- |
| `Patient` | Identificador de negocio, documento, nombre, nacimiento, teléfono, correo | Ninguna. El documento es obligatorio. Teléfono y correo son opcionales |
| `Practitioner` | Identificador, nombre, `active` | Ninguna |
| `HealthcareService` | Identificador, nombre, `active` | Ninguna |
| `Schedule` | Identificador, `active`, profesional, servicio | `Practitioner/{id}`, `HealthcareService/{id}` |
| `Slot` | Identificador, agenda, estado, inicio, fin | `Schedule/{id}` |

`Patient.identifier` lleva exactamente dos entradas: la de negocio y la de documento
(`urn:ingenius:document:{tipo}`). El system de negocio no es un system de documento ni
`urn:ingenius:pre-registration`. La query tiene que ser una de esas dos. Buscar por
`urn:ingenius:pre-registration` no es una ruta de este `PUT`: Hermes encuentra el
pre-registro por `_tag` o por documento y escribe su propio identificador.

Los campos de la tabla son obligatorios, salvo el teléfono y el correo. En `Slot`, `start`
y `end` llevan offset y `start` es anterior a `end`. Si falta un campo obligatorio, o no
cumple estas reglas, la respuesta es `422` (§10.4): el JSON se pudo leer, pero el servidor
no lo acepta.

## 4. Flujo

1. Autenticación y rol.
2. Método `PUT`, un solo segmento y un tipo que se escribe. Si no, `405` o `404`. Esto se
   resuelve **antes** de leer la clave o el cuerpo (§10.5).
3. `Content-Type` es `application/fhir+json` o `application/json`. Si no, `415`, sin leer el
   cuerpo.
4. `Idempotency-Key`. Si la clave ya tiene respuesta, se repite y el flujo termina.
5. La query trae un solo `identifier` con forma `system|value`, y ese par está en el cuerpo.
   `resourceType` coincide con la ruta.
6. El caso de uso busca por ese identificador dentro del tenant del token.

Cero coincidencias crea y responde `201`. Una actualiza, conserva el id interno y responde
`200`. Más de una responde `412` `multiple-matches` y no escribe. Un `id` en el cuerpo que
no coincide con el recurso encontrado, o un `id` cuando no hay coincidencia, responde `400`. El cuerpo de éxito es el recurso que
devolvería el `GET`. `Location` usa la misma base que los enlaces del `Bundle`
(`FHIR_BASE_URL` o el origen de la petición) más `/{Tipo}/{id}`.

### 4.1 `Patient`

Con una coincidencia, se actualizan los campos de la §3.1. Si el documento del cuerpo
pertenece a otro expediente, `409`. Si el expediente coincidente está `pre_registered`, la
actualización lo confirma.

Con cero coincidencias:

- el documento es de un `pre_registered` del tenant → se confirma ese expediente;
- el documento es de un `active` → `409`;
- el documento no existe → se crea un `Patient` `active`.

Confirmar guarda el identificador de negocio del cuerpo, pasa el estado a `active` y
conserva el id interno. El tag deja de salir en la lectura.

### 4.2 `Schedule` y `Slot`

La referencia tiene que existir en el tenant. Si no existe, `422` y no se crea.

En un `Slot`, primero se vencen las solicitudes vencidas del tenant. Si después queda una
solicitud pendiente apartando ese cupo, solo se acepta `busy` o `busy-unavailable`. Esa
escritura y el rechazo (`rejected`, motivo `slot_unavailable`) ocurren en la misma
transacción, y se auditan las dos cosas. Un cambio de inicio, fin, agenda, `free` o
`busy-tentative` responde `409` y deja el apartado como estaba.

> **Decidido el 2026-10-14** (§10.7): se mantiene esta regla (opción A). Hermes recibe `409`
> si intenta otro cambio sobre un cupo apartado, y espera a que el apartado venza o se
> resuelva.

Un cupo sin solicitud pendiente acepta el estado del cuerpo, en el alta y en la
actualización. El alta no puede tener un apartado: la solicitud apunta a un id que todavía
no existe.

### 4.3 Auditoría

| Hecho | `action` | `resourceType` |
| --- | --- | --- |
| Upsert de `Patient` | `patient.written_by_hermes` | `medical_record` |
| Upsert de `Practitioner` | `practitioner.written_by_hermes` | `practitioner` |
| Upsert de `HealthcareService` | `healthcare_service.written_by_hermes` | `healthcare_service` |
| Upsert de `Schedule` | `schedule.written_by_hermes` | `schedule` |
| Upsert de `Slot` | `slot.written_by_hermes` | `slot` |
| Rechazo por cupo ocupado | `appointment_request.rejected` | `appointment_request` |

`actorRole` es `service`. `actorSubject` y `requestId` salen del token y de
`X-Request-Id`. No se guarda el cuerpo ni datos clínicos.

## 5. Errores

Todo error es un `OperationOutcome` con `application/fhir+json`. Se añaden los códigos
`conflict`, `multiple-matches`, `processing`, `business-rule` y `structure`. `toFhirError`
traduce `ConflictError` a `409` `conflict` y, en escritura, `ValidationError` a `422`
`processing`. El mensaje es el del dominio, en español, sin el objeto `details`.

R4 distingue `400` (el recurso no se puede leer o falla la validación básica) de `422` (se
leyó, pero viola el perfil o una regla del servidor). La tabla sigue esa línea (§10.4).

| Situación | Status | Código |
| --- | --- | --- |
| Sin token, o token inválido | 401 | `login` |
| Rol distinto de `service` | 403 | `forbidden` |
| Tipo desconocido | 404 | `not-found` |
| `Appointment`, `PUT` por id, u otro método | 405 | `not-supported` |
| `Content-Type` distinto de `application/fhir+json` o `application/json` | 415 | `not-supported` |
| JSON mal formado, query mal formada, `resourceType` distinto, identificador de la query ausente en el cuerpo, `id` del cuerpo que no coincide | 400 | `invalid` |
| Sin `Idempotency-Key` | 400 | `invalid` |
| Elemento con significado que no se guarda, o `modifierExtension` | 422 | `structure` |
| Campo obligatorio ausente o con valor inválido (identificador de negocio, fechas, `start ≥ end`, value set) | 422 | `processing` |
| Tag `pre-registered` en el cuerpo | 422 | `business-rule` |
| Referencia inexistente en el tenant | 422 | `processing` |
| Misma clave con otro cuerpo o con otra query | 409 | `conflict` |
| Documento de otro paciente, reescritura de un cupo apartado, o violación del índice único de identificador o de documento | 409 | `conflict` |
| Más de un recurso con ese `identifier` | 412 | `multiple-matches` |
| Fallo inesperado | 500 | `exception` |

El `405` de un tipo que sí se escribe lleva `Allow: GET, PUT`. El de `Appointment` y el del
`PUT` por id llevan `Allow: GET`.

## 6. Pruebas

**Unitarias.** Un parser por recurso: campos aceptados; `meta`, `text`, `use` y `extension`
ignorados; elemento con significado no guardado y `modifierExtension` → `422`; tag
`pre-registered` → `422`. El upsert de `Patient`, con puerto falso: alta, actualización,
confirmación y conflicto de documento. El de `Slot`: ocupar un apartado y rechazar cualquier
otro cambio. El vencimiento se asume ya aplicado por el puerto, igual que en la lectura.

**`test:db`.**

| Suite | Qué añade |
| --- | --- |
| `fhir-conformance` | `201` y `200` de los cinco tipos; repetir el mismo `identifier` deja una fila; `id` del cuerpo distinto → `400`; `405` de `Appointment` y del `PUT` por id, también sin `Idempotency-Key`; `Allow`; `415`; cuerpo con `meta` y `text` aceptado; elemento no guardado → `422`; tag → `422`; referencia inexistente → `422`. `metadata` declara `update` (con `documentation`), `conditionalUpdate: true` y `updateCreate: false` solo en los cinco; la prueba ejecuta el `PUT` condicional y comprueba que el `PUT` por id responde `405`. Cupo apartado → `busy` o `busy-unavailable` y solicitud `rejected` / `slot_unavailable`; un `PUT` con `free` no toca el apartado. La escritura deja `audit_events` con rol `service` y sin el cuerpo |
| `aislamiento-tenant` | Un `PUT` del tenant A no modifica un recurso del tenant B. El mismo `identifier` en otro tenant crea un recurso propio |
| `roles` | `operator`, `admin` y `widget` → `403`. Sin token → `401`. También en `PUT` |
| `idempotencia` | Clave obligatoria; la misma clave repite el `201` o el `200`; otro cuerpo u otra query → `409` |
| `fronteras` | `fhir` sigue sin importar `patients` ni `scheduling` |

No hay cambios en `/api/v1` ni en el frontend. No se regenera OpenAPI ni se corre React
Doctor.

## 7. Cierre

Puertas: Biome, typecheck, tests unitarios y `test:db`. Umbrales de Clean Code de la
gobernanza §4. `process.env` solo en `config/env.ts`.

Documentación en la misma PR de implementación: `README.md` (la 4.2 pasa a ser lo que está
en curso o cerrado, según el momento) y `backend/AGENTS.md` (cómo se añade una escritura al
registro). `GOBERNANZA.md` solo si una regla de esta spec cambia la política; las reglas FHIR
ya dicen que la escritura queda auditada como hecha por Hermes y que `/fhir` es solo
`service`. `CLAUDE.md` y `ROADMAP.md` los edita quien cierra la fase, igual que en la 4.1.

## 8. Fuera de alcance

`Appointment` `proposed`, la extensión `replaces-appointment`, `Task` y el vencimiento al
leer de ambos (4.3). El cliente FHIR del simulador y la sincronización automática de
maestros (4.4). La colección Postman y el barrido periódico (Fase 5). Keycloak (Fase 6).
Borrar recursos, `PATCH`, `PUT` por id y versiones (`If-Match`).

## 9. Refinamientos al planificar

1. **Envoltorio de escritura aparte.** `serviceFhirRoute` siempre responde 200; el `PUT`
   usa `serviceFhirIdempotentRoute` con status del resultado y `Location`.
2. **Rechazo del apartado sin liberar.** El upsert de `Slot` no llama a
   `resolveAppointmentRequest` (ese caso de uso pone el cupo en `free` al rechazar).
   Escribe el estado de Hermes, hace `markResolved` y audita.
3. **`Allow` en 405.** Escribibles: `GET, PUT`. Resto: `GET`.
4. **Hash de idempotencia** = método + `pathname+search` + cuerpo.
5. **Helper `fhirPut`** con cuerpo e `Idempotency-Key`.
6. **Docs de la PR:** `README.md`, `backend/AGENTS.md`. `CLAUDE.md` y `ROADMAP.md` fuera.

## 10. Alineación R4 (revisión del 2026-10-14)

Sale de `docs/FHIR_R4_REVIEW.md`. Donde esta sección y las anteriores digan cosas distintas,
manda esta sección: las §2, §4 y §5 ya están actualizadas para coincidir.

### 10.1 `metadata` y el `PUT` por id (hallazgo 1)

En R4, la interacción `update` es `PUT [type]/[id]`, y el update condicional es la bandera
`conditionalUpdate` sobre ella. No hay forma de declarar solo el condicional. Los cinco
tipos declaran:

- `interaction: update` con `documentation`: «Solo actualización condicional
  (`PUT [type]?identifier=system|value`). El `PUT` por id responde 405.»
- `conditionalUpdate: true`.
- `updateCreate: false`: el servidor asigna los ids; el cliente no los elige.

El `PUT` por id llega en la 4.3, cuando Hermes resuelva `Appointment`. Entonces se quita la
restricción de `documentation` en los tipos que lo soporten.

### 10.2 Cuerpo tolerante con lo que no se guarda (hallazgo 6)

Los clientes FHIR mandan metadatos que el servidor no guarda. Rechazarlos haría frágil la
integración. Tres grupos, en la raíz y dentro de los tipos de dato:

| Grupo | Elementos | Trato |
| --- | --- | --- |
| Se ignoran | `meta` (salvo `meta.tag`), `text`, `extension`, `use` de `identifier`/`name`/`telecom`, `identifier.type`, `identifier.period`, `name.text` en `Patient`, `name.prefix`/`suffix`, `telecom.rank`, `reference.display`, `reference.type` | No se validan ni se guardan |
| Se rechazan con `422` `structure` | Cualquier otro elemento, por ejemplo `gender`, `deceased[x]`, `address`, `qualification`, `contained` | Hermes sabe que ese dato no se persiste |
| Siempre se rechaza (`422`) | `modifierExtension`, en cualquier nivel | Cambia el significado del recurso |

`meta.tag` sigue con su regla: el tag `pre-registered` → `422` `business-rule`; cualquier
otro tag se ignora. La simetría con la lectura se mantiene: lo ignorado no es dato guardado.

### 10.3 `id` lógico del cuerpo (hallazgo 2)

| Caso | Respuesta |
| --- | --- |
| Una coincidencia; el cuerpo no trae `id` o trae el del recurso encontrado | `200` |
| Una coincidencia; el cuerpo trae otro `id` | `400` `invalid` |
| Sin coincidencias; el cuerpo trae `id` | `400` `invalid` (no hay ids del cliente) |
| Sin coincidencias; sin `id` | `201` |

El parser no descarta el `id`: lo entrega al caso de uso `conditional-put`, que lo compara
con el recurso encontrado.

### 10.4 `400` frente a `422` (hallazgos 3 y 4)

Ver la tabla de la §5. `412` usa `multiple-matches`, del value set `issue-type`.

### 10.5 Orden de comprobación (hallazgo 9)

Enrutado (`405`/`404`) y `Content-Type` (`415`) se resuelven antes de leer la
`Idempotency-Key` y el cuerpo. Un `PUT /fhir/Patient/123` sin clave responde `405`, no
`400`.

### 10.6 `Content-Type` (hallazgo 5)

Se aceptan `application/fhir+json` y `application/json`, con o sin `charset`. Cualquier otro
→ `415` `not-supported`.

### 10.7 Cupo apartado frente a Hermes (hallazgo 8) — decidido

Decisión de producto del 2026-10-14: **opción A**. Con un apartado vivo, Hermes solo puede
escribir `busy` o `busy-unavailable`, que rechaza la solicitud con `slot_unavailable`.
Cualquier otro cambio responde `409` y deja el apartado como estaba. Hermes reintenta cuando
el apartado vence o se resuelve. Es lo que implementa la Tarea 4 (`36671bc`).

Se descartó la opción B (Hermes manda siempre y la solicitud se rechaza con otro motivo,
como `slot_changed`). El apartado dura poco y el `409` deja a Hermes saber por qué no se
aplicó su cambio. La sincronización de la 4.4 debe tratar ese `409` como «reintentar más
tarde», no como error definitivo.

### 10.8 `Idempotency-Key` (hallazgo 7)

Se mantiene obligatoria (gobernanza §1.6). `CapabilityStatement.rest.documentation` lo
anuncia, y el `diagnostics` del `400` lo dice explícitamente, porque no es una cabecera
estándar de FHIR.

### 10.9 Menores de cierre y trabajo posterior

La tarea de cierre implementa los hallazgos 11 a 14: los `401` llevan
`WWW-Authenticate: Bearer`; cada recurso declara `versioning: no-version` y
`readHistory: false`; un `Patient` `pre_registered` omite `active`, mientras uno confirmado
mantiene `active: true`; y la spec 4.1 queda marcada como cerrada en `main` mediante la
[PR #9](https://github.com/MangoMorado/HermesApp_Chatbot/pull/9). Los hallazgos 15 a 17 son
de la 4.3.
