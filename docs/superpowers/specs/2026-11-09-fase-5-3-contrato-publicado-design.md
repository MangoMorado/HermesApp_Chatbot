# Fase 5.3 — Contrato publicado (diseño)

Sub-proyecto 3 de 3 de la Fase 5. Spec madre:
`docs/superpowers/specs/2026-10-27-fase-5-identidad-oidc-contrato-design.md` (§3 y §8).
Entregables 8, 9 y 10 del roadmap; criterios 7 y 8. Con esta entrega cierra la Fase 5 y el MVP.

Rama de trabajo: `fase-5-2-frontend-referencia` (decisión del usuario: la spec y su trabajo
viven en esta rama). La 5.3 necesita `GET /api/platform/v1/me`, que solo existe aquí.

## 1. Intención

Un desarrollador de Hermes recibe el contrato y, sin escribirnos, puede hacer tres cosas con el
mismo peso:

1. **Explorar y probar en Swagger UI**: abre `/docs` en un backend de laboratorio o desarrollo,
   pulsa «Authorize», se autentica contra el proveedor real y llama a cualquier operación REST.
2. **Ejecutar Postman de punta a punta**: la colección cubre widget E2E, panel (bandeja,
   conocimiento, configuración y tickets), plataforma, simulador y el ciclo Hermes por `/fhir`,
   con las dos clínicas. Un `newman run` contra el despliegue del laboratorio termina en verde
   sin intervención manual, y se puede repetir.
3. **Confiar en el contrato**: la suite `contrato-rutas` del CI invoca cada operación declarada
   y valida status y cuerpo contra el esquema. Si una respuesta no encaja, el CI falla.

### 1.1 Qué cuenta como éxito

- En el laboratorio, «Authorize» de Swagger funciona con `authorizationCode` + PKCE (usuarios
  `admin-*`, `operator-*` y `platform-lab`) y con `clientCredentials` (`service-*`,
  `chatbot-platform`).
- `newman run` contra Easypanel pasa dos veces seguidas, y los cupos `free` son los mismos antes
  y después.
- `contrato-rutas` está en verde en el CI y falla si una ruta devuelve un status no declarado o
  un cuerpo fuera de esquema.

### 1.2 Anti-objetivos (fallaría aunque funcione)

- Swagger UI encendido en producción.
- Password grant habilitado en cualquier cliente que no sea `chatbot-newman` del realm de
  laboratorio.
- La colección Postman editada a mano: se regenera y una prueba compara el archivo con la
  salida del generador.
- El texto `keycloak` dentro de `backend/src/**` o `frontend/src/**` (suite `fronteras`).
- Un `newman run` que deja cupos apartados o entradas de conocimiento basura en la base del
  laboratorio.
- Swagger que carga scripts desde un CDN.

## 2. Decisiones

| Tema | Decisión | Quién |
| --- | --- | --- |
| Alcance | Swagger, Postman con Newman y `contrato-rutas`, con el mismo peso (§8 de la spec madre completa) | usuario |
| `/docs` en producción | Apagado. Solo se enciende en laboratorio y desarrollo; en producción la consulta se hace con Postman | usuario |
| Tokens de usuario en Newman | Cliente `chatbot-newman` en el realm de laboratorio, con password grant solo para él; Newman pide tokens de `admin-*`, `operator-*` y `platform-lab` con `LAB_USER_PASSWORD` | usuario |
| Profundidad de `contrato-rutas` | Camino feliz más cada 4xx declarado que se pueda reproducir (400, 401, 403, 404, 409, 422 y 429). 500 y 503 solo por forma | usuario |
| Datos tras Newman | La colección deshace lo que crea: cancela por FHIR y borra el conocimiento. Conversaciones, tickets y pre-registros quedan con un prefijo reconocible | usuario |
| Activos de Swagger UI | `swagger-ui-dist` como dependencia, servido por el backend; nunca desde un CDN | Claude |
| URLs OAuth2 en el JSON versionado | Marcadores fijos en el JSON generado; `/docs` los sustituye en el momento de servir por los endpoints del proveedor configurado (§3.2) | Claude |
| Tokens en Postman | Scripts de pre-petición contra el token endpoint, no el asistente OAuth2 de Postman (Newman no lo ejecuta) | Claude |
| Validador de esquema en tests | `ajv` (con `ajv-formats`) como devDependency del backend | Claude |
| Newman | devDependency del backend, con un script npm. No entra en el CI (no hay red) | spec madre |
| Esquema del simulador | `oidcUser`: sus 24 rutas exigen `admin`. No se abren a `service` | Claude (lo dicta el código) |
| Pre-agenda en Newman | Se recorren rechazo y aprobación más cancelación; las dos dejan el cupo en `free` (§4.4) | Claude |
| Escrituras irreversibles | `POST /tenants` con un slug fijo (`201` o `409`); rotar la clave del widget y reescribir su cliente quedan fuera de Newman, en una carpeta manual (§4.4.1) | Claude |
| Maestros y CRUD del simulador | `PUT` FHIR idempotentes sobre lo sembrado; el CRUD crea con `newman-` y borra en la misma carpeta (§4.4.1) | Claude |

## 3. Swagger UI en `/docs`

### 3.1 Encendido

- Variable `DOCS_ENABLED` (`true`/`false`, por defecto `false`), leída solo en
  `config/env.ts`. Si está apagado, `/docs` y todo lo que cuelga de él responden `404`, igual
  que una ruta inexistente: no se revela que exista.
- `DOCS_OIDC_CLIENT_ID` (por defecto `chatbot-swagger`), el cliente público con PKCE que ya crea
  `idp:lab`, con redirect `${api}/docs/*`.
- `docker-compose.yml` y `.env.example` lo traen encendido para el desarrollo local. En
  Easypanel (laboratorio) se enciende por variable. `README.md` dice que producción lo deja
  apagado.

### 3.2 Qué sirve

- `GET /docs`: página HTML de Swagger UI con selector de los tres contratos (chatbot, plataforma
  y simulador). El del simulador solo aparece si `HERMES_SIMULATOR_ENABLED=true`.
- Activos de `swagger-ui-dist` servidos desde el backend bajo `/docs/`. La página no carga nada
  de terceros. Se aplica una CSP propia en `/docs`, compatible con Swagger UI: scripts solo del
  mismo origen y `connect-src` hacia el propio API y el proveedor.
- `GET /docs/openapi/{chatbot|platform|sim}.json`: el documento generado (el mismo builder que
  produce el JSON versionado) con los marcadores de §3.3 sustituidos por el
  `authorization_endpoint` y el `token_endpoint` del documento de discovery de `OIDC_ISSUER`. Si
  el discovery falla, responde `503` con la envoltura REST.
- `initOAuth`: `clientId` = `DOCS_OIDC_CLIENT_ID` y `usePkceWithAuthorizationCodeGrant: true`. El
  `client_secret` de `clientCredentials` lo teclea quien prueba; nunca se sirve.
- Las rutas de `/docs` son adaptador HTTP y no tocan el dominio. Se excluyen de la regla
  «toda ruta está declarada» de `contrato-api`, igual que hoy `/fhir` y `/health` si aplica.

### 3.3 Esquemas de seguridad en los OpenAPI

`bearerAuth` (chatbot y simulador) y `platformBearer` (plataforma) desaparecen. Los tres
documentos declaran:

| Esquema | Tipo | Flujos | Operaciones |
| --- | --- | --- | --- |
| `oidcUser` | `oauth2` | `authorizationCode` (PKCE) | las de `admin`/`operator` del chatbot, **las 24 del simulador** (hoy exigen `admin`, un usuario) y las de plataforma hechas por `platform-lab` |
| `oidcClient` | `oauth2` | `clientCredentials` | las de plataforma hechas por `chatbot-platform` y `GET /api/v1/me` con `service` (en REST, `service` solo llega ahí; el resto de su trabajo va por `/fhir`) |
| `widgetSession` | `http` bearer | — | las del widget; el token sale de `POST /widget/sessions` |

Las operaciones públicas (`/health`, `/auth/backchannel-logout`, `/widget/sessions` y
`/widget/sessions/refresh`) siguen con `security: []`. Esta entrega no cambia ningún rol: los
esquemas describen lo que el código ya exige.

- Las URLs de los flujos se declaran con marcadores fijos (por ejemplo,
  `https://oidc.invalid/authorize` y `https://oidc.invalid/token`), centralizados en
  `openapi-shared.ts`. El JSON versionado sigue siendo determinista y `contrato-api` sigue
  comparándolo con el generador.
- Una operación que admite varios roles declara un esquema alternativo por cada uno. Por
  ejemplo, `GET /api/v1/me` lleva `widgetSession`, `oidcUser` y `oidcClient`.
- El generador no escribe `keycloak`.
- Cada operación sigue con `401` y `403` declarados como hoy.

## 4. Colección Postman

### 4.1 Generación

- Script en `backend/scripts/postman/` (comando `npm --prefix backend run postman:generate`).
  Toma los tres documentos (vía los builders, no el JSON del disco) más fragmentos fuente
  escritos a mano en el mismo directorio:
  - carpeta `/fhir`: maestros (`PUT` condicional), lectura y búsqueda, y ciclo de pre-agenda
    (`Appointment` `proposed` y `Task` de cancelación);
  - recorrido widget E2E;
  - autenticación y limpieza (§4.3 y §4.4).
- Salida: `docs/chatbot-ingenius-360.postman_collection.json` (sustituye la colección manual
  actual, anterior a OIDC) y `docs/lab.postman_environment.template.json` (variables sin
  secretos).
- Un caso de `contrato-api` comprueba que la colección versionada coincide con la salida del
  generador, igual que con los OpenAPI. Editar la colección a mano rompe el CI.
- Organización: primero los recorridos escritos a mano, que son lo que ejecuta Newman (preparación,
  widget E2E para las dos clínicas mediante variables `tenant_a_*` y `tenant_b_*`, maestros FHIR,
  CRUD del simulador, plataforma, panel y limpieza). Después, una carpeta `catálogo` generada
  con una petición por operación y una subcarpeta por superficie (`chatbot`, `platform`, `sim`),
  para explorar a mano. Newman no ejecuta el catálogo: sus ids de ruta y cuerpos de ejemplo no se
  pueden limpiar contra el laboratorio. (Decisión de Claude al planificar.)

### 4.2 Contenido por petición

- Cada petición generada lleva un ejemplo de cuerpo construido a partir del esquema, el
  `Idempotency-Key` como `{{$guid}}` en las escrituras y un test de Postman que comprueba el
  status esperado, `X-Request-Id` y, en los errores, la envoltura `{ error: { code, message,
  request_id } }`. La validación completa de esquema es trabajo de `contrato-rutas`, no de
  Postman.
- Las peticiones que dependen de otras (ids de solicitud, de conversación o de cupo) leen
  variables que fijan las anteriores. Los cupos se descubren por API (`Slot` libre por FHIR o la
  agenda), nunca con ids o fechas fijas.

### 4.3 Autenticación

- La colección usa `Authorization: Bearer {{access_token}}`, y cada carpeta fija qué token
  usa. Un script de pre-petición a nivel de colección obtiene y cachea tokens contra
  `{{oidc_token_url}}`:
  - `client_credentials` para `service-<tenant>` y `chatbot-platform`;
  - `password` con el cliente `chatbot-newman` para `admin-<slug>`, `operator-<slug>` y
    `platform-lab`;
  - el widget abre sesión con su clave pública por `POST /widget/sessions` y usa el token y el
    `conversation_secret` que devuelve.
- Los tokens duran 300 s en el realm; el script renueva cuando falta menos de un margen.
- La plantilla de entorno nombra cada variable. Los valores reales salen de lo que imprime
  `idp:lab`; las variables de secretos van marcadas como `secret`.

### 4.4 Limpieza (la colección se deshace sola)

- Todo lo que crea lleva el prefijo `newman-` en sus textos libres (preguntas de conocimiento,
  motivos y notas) para reconocerlo.
- El ciclo de pre-agenda se recorre por los dos caminos que tiene el código, y los dos devuelven
  el cupo a `free`:
  - **Rechazo:** el widget crea una solicitud y Hermes (`service`) la rechaza con
    `PUT /fhir/Appointment/{id}` y `status: cancelled`.
  - **Aprobación y cancelación:** el widget crea una solicitud; Hermes la aprueba (`booked`, el
    cupo pasa a `busy`); el paciente pide cancelar desde el widget, lo que origina el `Task` de
    cancelación; y Hermes lo resuelve con `PUT /fhir/Task/{id}` `completed`, que libera el cupo.
  - La bandeja del simulador (`/api/sim/v1/inbox`) se ejercita con una tercera solicitud que
    termina rechazada.
  (Un `Task` de cancelación lo origina el chatbot, nunca Hermes: Newman no puede crearlo
  directamente.)
- Una carpeta de limpieza final, por si un paso falló a medias: rechaza cada `Appointment`
  `proposed` que lleve el prefijo, borra las entradas de conocimiento que creó y restaura la
  configuración del bot si la cambió (lee antes, escribe después).
- Conversaciones, handoff-tickets y pre-registros no tienen baja en la API: quedan como rastro
  con el prefijo.
- Primera petición y última de cada recorrido: contar cupos `free` y comprobar que el número no
  cambió.

### 4.4.1 Qué escribe cada carpeta

- **Maestros FHIR (`PUT` condicional):** reescriben recursos sembrados con sus mismos valores
  (idempotentes; el test acepta `200` y comprueba que nada cambió). Ningún `PUT` cambia el
  estado de un `Slot` sembrado. Un `Patient` nuevo no se crea, porque no tiene baja.
- **CRUD del simulador:** crea recursos con el prefijo `newman-` (profesional, agenda,
  `slots:generate`) y los borra con sus `DELETE` en la misma carpeta, en orden inverso.
- **Plataforma:** `POST /tenants` usa siempre el slug fijo `newman-clinica`. La primera
  ejecución obtiene `201` y las siguientes `409 conflict`; el test acepta las dos. Queda una
  sola clínica de rastro, nunca una por ejecución.
- **Excluidas de Newman** (solo las cubre `contrato-rutas`), porque rompen el laboratorio y no
  se pueden deshacer:
  - `POST /bot-config/widget-keys/rotate` invalida la `widget_key` que usan el frontend del
    laboratorio y el propio entorno de Postman;
  - `PUT /tenants/{id}/widget-client` sobrescribe el secreto OIDC del widget de la clínica.
  Las dos peticiones siguen en la colección, en una carpeta «manual — rompe el laboratorio»
  que Newman salta (`--folder` o equivalente), para que Hermes las vea y las pueda lanzar a
  conciencia.

### 4.5 Ejecución

- `newman` es devDependency del backend. Comando:
  `npm --prefix backend run postman:run -- --env <ruta-al-entorno>`.
- No entra en el CI. Se lanza a mano contra Easypanel y su salida se adjunta al cierre.
- Requisito: la base del laboratorio sembrada con `db:seed` (las dos clínicas, cupos futuros y
  pacientes con sus respuestas de verificación conocidas por la colección). La pregunta de
  verificación se sortea al azar, así que los fragmentos traen el mapa pregunta→respuesta de
  cada paciente sembrado que usan. Si el límite de sesiones por IP de la clínica
  (`widget_sessions_per_ip_per_minute`) frena a Newman, la colección lo tiene en cuenta (pausas o
  pocas sesiones por recorrido); no se sube el límite del laboratorio. Si el seed del
  laboratorio no deja cupos futuros suficientes, se resiembra con un ancla reciente; eso es
  preparación, no un paso de la ejecución.

## 5. Laboratorio: cliente `chatbot-newman`

- `idp:lab` añade al plan `chatbot-newman`: confidencial, `directAccessGrantsEnabled: true`
  (es el único cliente del realm con ese valor), sin redirects, con el mismo client scope de
  roles y `tenant_id` que `chatbot-reference-ui`, y con audiencia aceptada por el backend
  (`OIDC_AUDIENCE`).
- `idp:lab` imprime su secreto junto a las demás líneas, y las variables listas para el entorno
  de Postman (issuer, token URL, ids y secretos de clientes, URLs de API).
- Pruebas de `idp-lab-plan`: existe `chatbot-newman` con password grant, y ningún otro cliente
  lo tiene.
- `GOBERNANZA.md` deja escrito: el password grant solo existe en el realm de laboratorio y solo
  para `chatbot-newman`; Hermes nunca lo necesita.

## 6. Suite `contrato-rutas`

- Proyecto Vitest `db` (necesita Postgres), en `backend/tests/db/contrato-rutas-*.test.ts`,
  partida por superficie para respetar el límite de 400 líneas.
- Cubre las tres superficies: 28 operaciones del chatbot, 4 de plataforma y 24 del simulador
  (con `HERMES_SIMULATOR_ENABLED`).
- Invoca los route handlers con `Request` reales y tokens del emisor de pruebas
  (`tests/helpers/idp.ts`), como las suites HTTP actuales. Reutiliza `support.ts` y el seed.
- Validación con `ajv` contra el documento construido por los builders (no el JSON del disco),
  con `$ref` resueltos. Para cada respuesta comprueba que:
  1. el status está declarado para esa operación;
  2. el `Content-Type` coincide con el declarado;
  3. el cuerpo valida contra el esquema de ese status;
  4. viene `X-Request-Id`.
- Casos: por cada operación, el camino feliz y cada status declarado del conjunto
  {400, 401, 403, 404, 409, 422, 429} que se pueda reproducir con datos o peticiones.
- Meta-test de cobertura: recorre las operaciones declaradas y exige, para cada par
  (operación, status) del conjunto anterior más el 2xx, un caso o una exención en una tabla
  explícita con su motivo (por ejemplo, «429 solo en `/widget/sessions`» o «409 no alcanzable
  sin carrera»). Una operación nueva sin casos rompe la suite.
- 500 y 503: no se provocan; un test comprueba que en cada operación referencian el esquema
  común de error.
- Un status devuelto que no está declarado, o un cuerpo fuera de esquema, rompe el CI.

## 7. Cambios de política y documentación en la misma entrega

- `GOBERNANZA.md` §5.1: añadir `contrato-rutas` a la lista de suites (pasan a diecinueve).
  Nueva regla: `/docs` apagado en producción; password grant solo en el laboratorio (§5).
- `ROADMAP.md`: el texto de «dieciocho suites» pasa a diecinueve; bloque **Estado** con la 5.3 y
  la Fase 5 cerradas al terminar (GOBERNANZA §7.1).
- `CLAUDE.md`: lista de suites y estado de la Fase 5.
- `README.md`: `/docs` y sus variables, el cliente `chatbot-newman`, cómo preparar el entorno de
  Postman desde la salida de `idp:lab`, `postman:generate` y `postman:run`.
- `.env.example` y `docker-compose.yml`: `DOCS_ENABLED` y `DOCS_OIDC_CLIENT_ID`.

## 8. Verificación y cierre

- Automática: Biome, typecheck, tests unitarios, `test:db` completo con `contrato-rutas`, React
  Doctor si se toca `frontend/` (no se espera).
- Manual en Easypanel. Easypanel despliega `main`, así que esta verificación necesita la rama
  desplegada (como la 5.2), con `DOCS_ENABLED=true` en el backend del laboratorio y `idp:lab`
  corrido de nuevo para crear `chatbot-newman`:
  1. `/docs` carga los tres contratos sin peticiones a terceros.
  2. «Authorize» con PKCE como `admin-clinica-norte` y una llamada al panel en `200`.
  3. «Authorize» con `client_credentials` como `chatbot-platform` y `GET /api/platform/v1/me` en
     `200`; con `service-<tenant>`, `GET /api/v1/me` en `200`.
  4. `newman run` dos veces seguidas en verde, con los mismos cupos `free` antes y después.
  5. Con `DOCS_ENABLED=false`, `/docs` responde `404`.

## 9. Fuera de alcance

- Newman en el CI.
- Swagger para `/fhir` (no vive en OpenAPI; su contrato es `/fhir/metadata`).
- Bajas de conversaciones, tickets o pre-registros para la limpieza.
- Provocar 500 y 503 con fallos inyectados.
- Publicar Swagger en producción o en un sitio estático aparte.

## 10. A criterio de quien implemente

- La forma exacta del servido de activos de Swagger UI en Next (route handler con lectura del
  paquete o copia en build), siempre sin CDN.
- Cómo se cachea el discovery del proveedor en `/docs` (puede reutilizar el adaptador OIDC si ya
  lo resuelve).
- El generador de ejemplos de cuerpo a partir del esquema.
- El margen de renovación de tokens en el script de Postman.
- El formato de la tabla de exenciones de `contrato-rutas`, siempre que cada exención lleve
  motivo.
