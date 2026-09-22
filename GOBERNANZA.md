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

### 1.3 Multitenancy por token

El `tenant_id` se toma **solo** del claim del JWT. Nunca del body, del query string ni de
un header libre. Un recurso de otro tenant responde `404`, nunca `403`: un `403` confirma
que el recurso existe.

Todo repositorio, caso de uso y consulta recibe el tenant como parámetro explícito. No hay
variables globales ni de contexto implícito para el tenant.

### 1.4 Alcance del widget

El rol `widget` alcanza únicamente el chat de su propia sesión. Nunca datos de dominio,
nunca `/fhir`, nunca otra sesión. Los roles son `widget` · `operator` · `admin` · `service`.

### 1.5 No divulgación

No se persisten respuestas de verificación de identidad ni datos clínicos en mensajes,
auditoría ni logs. Cuando haya que registrar que algo pasó, se registra el hecho y el
resultado, no el contenido.

### 1.6 Idempotencia

Toda escritura acepta `Idempotency-Key` y la persiste en base de datos (no en memoria).
Repetir la misma petición con la misma clave produce el mismo resultado sin duplicar
efectos.

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
| FHIR R4 `/fhir` | Hermes (solo rol `service` para escrituras) | `OperationOutcome` con `application/fhir+json` |

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
`conocimiento-config`, `alta-chatbot`, `idempotencia`, `sin-ia`, `fhir-conformance`,
`hermes-simulador`, `carga-basica`.

---

## 6. Skills

Instaladas en `.agents/skills/` (espejo en `.claude/skills/` para Claude Code) y fijadas
en `skills-lock.json`, vía el CLI de [skills.sh](https://skills.sh):

| Skill | Origen | Para qué |
| --- | --- | --- |
| `dry-refactoring` | `kucherenko/jscpd` | Eliminar duplicación detectada por jscpd |
| `fhir-developer-skill` | `anthropics/healthcare` | R4: recursos, value sets, `OperationOutcome` |
| `find-skills` | `vercel-labs/skills` | Descubrir e instalar skills del ecosistema |
| `frontend-design` | `anthropics/skills` | Dirección visual distintiva al construir UI |
| `grilling` | `mattpocock/skills` | Stress-test de planes y decisiones |
| `hexagonal-architecture` | `lexler/skill-factory` | Decidir fronteras de capa |
| `nielsen-usability-heuristics` | `dembrandt/dembrandt-skills` | Revisión de usabilidad de UI |
| `security-best-practices` | `openai/skills` | Revisión de seguridad (JS/TS, Next.js) |

`hexagonal-architecture` y `fhir-developer-skill` viven hoy en `.claude/skills/`; el resto
está en ambas carpetas. El inventario canónico es `skills-lock.json`.

**Las skills orientan; gana la gobernanza.** Conflictos conocidos y cómo se resuelven:

- La skill hexagonal llama «adapters» a la capa externa → aquí es `infrastructure`
  (sección 2.1).
- La skill FHIR asume escenarios clínicos genéricos y sugiere recursos que este producto
  no expone → el alcance lo fija `ROADMAP.md` y lo declara `/fhir/metadata` (sección 3.1).
- La skill `dry-refactoring` elimina clones de jscpd → los clones exactos sí se
  refactorizan; dos bloques parecidos sin ser copia no se abstraen hasta el tercer uso
  (sección 4).

Actualizar: `npx skills update`. Reproducir desde el lock: `npx skills experimental_install`.

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
