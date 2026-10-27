# Fase 5 — Identidad por OIDC (Keycloak) y contrato publicado (diseño)

> Estado: **en diseño**. Fuente del alcance: `ROADMAP.md` §Fase 5, ajustado por las decisiones
> de la §2 (reemplazan los entregables 3, 5 y 7 donde chocan). Manda `GOBERNANZA.md`; esta
> spec la modifica en §1.3 y §1.4 en la misma entrega (ver §9).

## 1. Intención

Hermes, la aplicación padre, construye su propio panel y su propio widget sobre nuestra API.
Ya usa Keycloak. El producto es, ante todo, **una API con dos clientes**: el panel de Hermes
y el widget. Desde esta fase, **toda credencial que la API acepta la emite un proveedor de
identidad externo** (Keycloak hoy). El backend deja de firmar tokens.

Dos fuerzas que tiran a la vez y que esta spec reconcilia:

1. **Corte total.** No hay convivencia con los tokens HS256 actuales. Ni modo dual, ni flag de
   compatibilidad, ni periodo de transición. `token:dev`, la emisión de `/api/platform/v1` y
   el token del widget firmado por el backend desaparecen en la misma entrega.
2. **Agnóstico del proveedor.** Si mañana el proveedor no es Keycloak, se cambia configuración
   y, como mucho, un adaptador de `infrastructure`. El núcleo (`domain`, `application`) no sabe
   que existe Keycloak.

**No sabemos cómo modela Hermes sus tokens.** Por eso el contrato de identidad lo definimos
nosotros (§4) y Hermes se adapta. Cuando se conozca el modelo real de Hermes, la adaptación
debe ser **solo de configuración** (rutas de claims y equivalencias de roles), no de código.

### 1.1 Qué cuenta como éxito

- Un desarrollador de Hermes abre Swagger UI o Postman, se autentica contra el proveedor y
  prueba cada endpoint (§8).
- Las suites existentes (`roles`, `sesion-widget`, `aislamiento-tenant`, `idempotencia`,
  `fhir-conformance`, `hermes-simulador`…) pasan contra el verificador nuevo.
- Ningún archivo fuera del adaptador de identidad, la configuración y la documentación menciona
  a Keycloak (lo exige un test de `fronteras`).

### 1.2 Anti-objetivos (fallaría aunque funcione)

- Que el núcleo lea `realm_access`, `resource_access` o cualquier forma propia de Keycloak.
- Que el CI necesite red o un Keycloak levantado para pasar.
- Que un token mal configurado cree estado (tenants fantasma, sesiones) en vez de fallar.
- Que el navegador reciba un secreto de cliente.
- Que el frontend de referencia dependa de `keycloak-js`.

## 2. Decisiones tomadas

Las de la columna «Quién» marcadas *usuario* se acordaron en el brainstorming; las marcadas
*diseño* son decisiones del redactor, revisables.

| Tema | Decisión | Quién | Razón |
| --- | --- | --- | --- |
| Transición | Corte de golpe. Se borran emisor HS256, `JWT_SECRET`, `PLATFORM_SECRET`, `token:dev` y la ruta de emisión | usuario | Un único emisor de identidad |
| Proveedor | OIDC genérico: issuer, audiencia, JWKS por discovery. Keycloak es el del laboratorio | usuario | Cambiar de proveedor = cambiar configuración |
| Contrato de claims | Lo define este repo (§4). Rutas de claim y equivalencia de roles **configurables** | usuario | Hermes se adapta; aún no se conoce su modelo |
| Paciente | Sigue anónimo ante el proveedor. El pre-registro queda como está (3.3 / 4.4) | usuario | El paciente no tiene cuenta |
| Widget | Camino 1: el proveedor acredita *quién* (widget de la clínica X, `client_credentials`); el backend ata *qué conversación* con un identificador secreto propio | usuario | Sin usuarios desechables ni extensiones del proveedor |
| Frontend propio | Herramienta de referencia y pruebas. No se despliega al conectar con Hermes. Login OIDC estándar (Authorization Code + PKCE) | usuario | El panel real lo construye Hermes |
| Alta de clínica | Explícita, por `/api/platform/v1`, idempotente. Nunca auto-alta al ver un `tenant_id` desconocido | usuario | Un error de configuración debe dar `404`, no crear estado |
| Rol `platform` | Rol nuevo, **sin** `tenant_id`. Solo alcanza `/api/platform/v1` | usuario | Opera sobre las clínicas, no dentro de una |
| Contrato publicado | Swagger UI + Postman, ambos con autenticación OAuth2 real contra el proveedor | usuario | Que Hermes pueda autenticarse y probar cada endpoint |
| Pruebas sin red | Las suites firman con un par de claves propio y sirven un JWKS local | diseño | CI sin Keycloak; además prueba lo agnóstico |
| Laboratorio | Script versionado que crea realm, clientes, roles, mappers y usuarios. El MCP solo explora/verifica | usuario | Reconstruible y revisable en la PR |
| Sesión cerrada | Back-channel logout OIDC: el proveedor avisa del `sid` cerrado; el backend lo rechaza hasta que su token expire | diseño | Estándar OIDC; criterio 3 del roadmap sin introspección por petición |
| Vida de los tokens | Acceso corto (5 min por defecto, configurable en el proveedor) | diseño | Acota la ventana de un token robado |
| Credenciales del widget | Hermes crea en su proveedor un cliente de widget por clínica y nos entrega `client_id` y `client_secret` por `/api/platform/v1`. Las guardamos cifradas en base de datos con una clave maestra de configuración. Nuestro código nunca usa la API de administración del proveedor | usuario | Agnóstico y coherente con «Hermes manda»; el alta sigue siendo automática por API |
| Credenciales `service` | En producción el token `service` lo obtiene Hermes en su propio proveedor; nunca vemos ese secreto. Solo el simulador (laboratorio) necesita las suyas, y las lee de configuración | diseño | El simulador se apaga en producción |
| Renovación del widget | `refresh` se autentica con el `conversation_secret` + clave pública + `Origin`, sin bearer vigente | diseño | Un paciente inactivo más que la vida del token no pierde su conversación |

## 3. Corte en sub-proyectos

La Fase 5 se parte en tres sub-proyectos de igual peso (GOBERNANZA §7.1). Cada uno se cierra
con su PR en `main`. El corte total es indivisible: el widget y el servicio dependen del
emisor que se retira, así que van en el mismo sub-proyecto que el verificador. Partirlo dejaría
`main` en rojo o exigiría el modo dual prohibido.

| Sub-proyecto | Contenido | Entregables del roadmap | Criterios |
| --- | --- | --- | --- |
| **5.1 Corte de identidad** | Verificador OIDC, mapper configurable, rol `platform`, credenciales de widget cifradas, sesión del widget por el proveedor, `service` del simulador por `client_credentials`, back-channel logout, laboratorio, retiro del emisor HS256 y de `token:dev` | 2, 3, 4, 5, 6, 7 | 1, 2, 3, 4, 5, 6 |
| **5.2 Frontend de referencia** | Login OIDC con PKCE en `/panel`, `/simulador` y `/chat`; adiós al token pegado a mano; widget de referencia con `conversation_secret` | 1, 4 | 1, 3 (manual en navegador) |
| **5.3 Contrato publicado** | Swagger UI, colección Postman regenerada, suite de rutas ↔ OpenAPI | 8, 9, 10 | 7, 8 |

Orden: 5.1 → 5.2 → 5.3. Entre la 5.1 y la 5.2 el frontend de referencia se usa pegando tokens
obtenidos del laboratorio (Postman o `curl`), y el widget de referencia se actualiza en la 5.1
lo justo para seguir funcionando con el nuevo cuerpo de sesión.

## 4. Contrato de identidad

Un token es válido si:

1. Su firma verifica contra el JWKS del issuer configurado (descubierto por
   `/.well-known/openid-configuration`), con algoritmo asimétrico de una lista permitida
   (`RS256`, `ES256`; nunca `none` ni `HS*`).
2. `iss` es exactamente el issuer configurado y `aud` contiene la audiencia configurada.
3. `exp` no pasó (tolerancia de reloj configurable, 30 s por defecto) y su `sid`, si trae, no
   está en la lista de sesiones cerradas (§6.3).
4. Se puede extraer **exactamente un** rol del producto y, salvo para `platform`, un
   `tenant_id` no vacío.

### 4.1 Contrato por defecto (el que emite el laboratorio)

| Claim | Contenido |
| --- | --- |
| `sub` | Identidad de quien llama |
| `tenant_id` | Identificador de la clínica (ausente solo en `platform`) |
| `roles` | Arreglo con uno de `widget` · `operator` · `admin` · `service` · `platform` |
| `sid` | Sesión del proveedor (solo en login interactivo) |

### 4.2 Adaptación sin código

| Variable | Por defecto | Ejemplo para otro modelo |
| --- | --- | --- |
| `OIDC_ISSUER` | — (obligatoria) | `https://idp.hermes.example/realms/hermes` |
| `OIDC_AUDIENCE` | — (obligatoria) | `chatbot-api` |
| `OIDC_TENANT_CLAIM` | `tenant_id` | `org.tenant_id` (ruta con puntos), `organization[]`, `organization{}` |
| `OIDC_ROLES_CLAIM` | `roles` | `realm_access.roles` |
| `OIDC_ROLE_MAP` | identidad | `clinic-staff=operator,clinic-admin=admin` |
| `OIDC_CLOCK_TOLERANCE_SECONDS` | `30` | — |

Reglas del mapeo: los roles externos que no aparecen en el mapa ni coinciden con uno del
producto se ignoran; si tras el mapeo quedan cero o más de uno, el token es inválido (`401`).
Un `tenant_id` que no es string, o la ruta no existe, es inválido. Las variables se leen solo
en `config/env.ts` y se validan al arrancar.

La ruta del tenant admite dos sufijos para los modelos de organización de los proveedores
(Keycloak 26 con Organizations emite `organization` como lista de alias o como objeto cuya
clave es el alias):

- `ruta[]`: el valor es un arreglo y debe tener **exactamente un** elemento string; ese es el
  tenant.
- `ruta{}`: el valor es un objeto y debe tener **exactamente una** clave; esa clave es el
  tenant.

Cero o más de un elemento (o de una clave) → `401`: un usuario en varias clínicas no elige
tenant por cabecera ni por cuerpo. Los sufijos solo van al final de la ruta.

## 5. Arquitectura

### 5.1 Núcleo (sin cambios de forma)

`Actor`, `belongsToTenant`, `reachesSession`, `TokenClaims` y `createAuthenticate` conservan su
forma. Cambios:

- `ROLES` gana `platform`. `Actor.tenantId` pasa a ser opcional **solo** para `platform`; el
  tipo lo expresa como unión discriminada por rol para que ninguna ruta de tenant reciba un
  actor sin tenant. `privateRoute` con roles de tenant nunca admite `platform`.
- `TokenClaims.sessionId` desaparece del token. El widget prueba su conversación por otra vía
  (§6.1), así que `reachesSession` pasa a comparar contra el identificador resuelto por la
  ruta, no contra un claim.
- El puerto `TokenIssuer` (firma) se elimina. Lo sustituye `ClientTokenSource` (§5.2), que
  **obtiene** un token del proveedor para un cliente máquina. Nombres y tipos neutros: nada de
  `realm`, `client_id` de Keycloak ni scopes propios.

### 5.2 Puertos

```
modules/auth/domain/ports/
  token-verifier.ts      # sin cambios: verify(token) → TokenClaims
  client-token-source.ts # tokenFor(credential: MachineCredentialRef) → { accessToken, expiresAt }
  closed-sessions.ts     # close(sid, until), isClosed(sid, now)
```

`MachineCredentialRef` es un identificador lógico (p. ej. `widget:<tenantId>`,
`service:<tenantId>`) que el adaptador resuelve a credenciales reales. El núcleo nunca ve un
secreto.

### 5.3 Adaptadores

```
modules/auth/infrastructure/
  oidc-token-verifier.ts        # jose + createRemoteJWKSet; verifica §4 (1–3)
  claims-mapper.ts              # rutas configurables y OIDC_ROLE_MAP → TokenClaims
  oidc-client-credentials.ts    # POST al token_endpoint descubierto; caché hasta expiresAt − margen
  prisma-closed-sessions.ts
```

Keycloak no aparece ni en estos archivos: son OIDC/OAuth2 estándar. Lo único propio de
Keycloak vive en el **script del laboratorio** (`backend/scripts/idp-lab/`), que usa su API de
administración.

### 5.4 Credenciales de clientes máquina

- **Widget (producción y laboratorio).** Hermes crea en su proveedor un cliente confidencial de
  widget por clínica (`client_credentials`, emite el contrato §4 con `roles: [widget]` y el
  `tenant_id` de la clínica) y nos entrega `client_id` + `client_secret`:
  - en el cuerpo del alta (`POST /api/platform/v1/tenants`, campo opcional `widget_client`), y
  - por `PUT /api/platform/v1/tenants/{id}/widget-client` para darlas después o rotarlas
    (idempotente; reemplaza las anteriores).
  Se guardan en una tabla nueva (`machine_credentials`: tenant, tipo, `client_id`, secreto
  cifrado, fechas). El secreto se cifra con AES-256-GCM detrás de un puerto `SecretBox`; la
  clave sale de `CREDENTIALS_ENCRYPTION_KEY` (32 bytes en base64, obligatoria). Nunca se
  devuelve el secreto en ninguna respuesta, auditoría ni log.
- Una clínica sin credenciales de widget puede existir: abrir sesión de widget responde `409`
  `widget_not_configured`.
- **Service (solo simulador).** `HERMES_SIM_SERVICE_CLIENTS` en configuración: JSON
  `{ "<tenantId>": { "client_id": "...", "client_secret": "..." } }`. Obligatoria solo con el
  simulador encendido.
- El adaptador `oidc-client-credentials` resuelve `MachineCredentialRef` contra la tabla
  (widget) o la configuración (service) y cachea el token hasta `expiresAt − 30 s`.

### 5.5 Test de fronteras

`fronteras` gana una regla: el texto `keycloak` (sin distinguir mayúsculas) no aparece en
`backend/src/**` ni en `frontend/src/**`. Se admite en `backend/scripts/idp-lab/**`, en docs y
en ejemplos de `.env`.

## 6. Flujos

### 6.1 Widget (camino 1)

1. El widget llama a `POST /api/v1/widget/sessions` con la clave pública, igual que hoy
   (origen permitido, rate limit, `Idempotency-Key`).
2. El backend crea la conversación y genera un **identificador secreto de conversación**
   (≥ 128 bits, aleatorio). Guarda solo su hash.
3. Pide al proveedor un token para `widget:<tenantId>` vía `ClientTokenSource`.
4. Responde `{ access_token, expires_at, conversation_secret, session_expires_at }`.
5. Cada llamada de conversación envía `Authorization: Bearer <access_token>` y la cabecera
   `X-Conversation-Secret`. La ruta autentica el actor (`widget`, tenant del claim), resuelve
   la conversación por hash **dentro del tenant del token** y comprueba `Origin` como hoy.
   Cualquier fallo de conversación → `404`.
6. Renovación: `POST /api/v1/widget/sessions/refresh` es **pública** (sin bearer). Se
   autentica con `X-Conversation-Secret`, la clave pública del widget y el `Origin` de la
   sesión, con el mismo rate limit que la apertura. Si la sesión sigue viva, devuelve un token
   nuevo del proveedor y extiende la sesión según el TTL del tenant. El TTL de la
   conversación sigue siendo nuestro; la vida del token es del proveedor, así que un paciente
   inactivo más que la vida del token no pierde la conversación.
7. El replay idempotente de la apertura (hoy `rebuildSessionResponse`) pide un token nuevo y
   devuelve el **mismo** `conversation_secret`. Para poder hacerlo sin guardar el secreto en
   claro, la respuesta idempotente se persiste cifrada o el replay devuelve `409` — **decisión
   del builder**, documentada en el plan.

Una conversación sin `X-Conversation-Secret` válido es inalcanzable aunque el token sea de la
clínica correcta: eso preserva GOBERNANZA §1.4 (solo su propia sesión).

### 6.2 Servicio (Hermes y simulador)

`createServiceTokens` deja de firmar y pide a `ClientTokenSource` el token de
`service:<tenantId>`. `hermes:sync` y la bandeja no cambian en lo demás. El sujeto deja de ser
`hermes-{tenantId}`: es el `sub` que emita el proveedor; la auditoría FHIR lo registra tal cual.

### 6.3 Panel (operador/admin) y cierre de sesión

- Login interactivo en el proveedor (Authorization Code + PKCE) desde el cliente que sea
  (frontend de referencia, panel de Hermes). La API solo ve el bearer.
- `POST /api/v1/auth/backchannel-logout` (pública, `application/x-www-form-urlencoded`)
  recibe el `logout_token` del proveedor, lo verifica con el mismo JWKS e issuer (evento
  `http://schemas.openid.net/event/backchannel-logout`, sin `nonce`). Su `aud` es el cliente
  que cerró la sesión, no la API: se acepta si está en `OIDC_LOGOUT_AUDIENCES` (lista separada
  por comas). Cierra el `sid` hasta `now + OIDC_MAX_TOKEN_LIFETIME_SECONDS` (300 por defecto,
  igual a la vida de acceso del laboratorio). Un bearer con ese `sid` → `401`.
- Un bearer **sin** `sid` se acepta (los tokens máquina no lo traen). El cierre de sesión
  cubre solo a quien lo emite el proveedor con `sid`.
- Alcance del criterio 3: se prueba con el cliente `chatbot-reference-ui` del laboratorio.
  Para el panel de Hermes, que su proveedor llame a este endpoint es un requisito de
  integración que se documenta en `README.md`; no lo verificamos nosotros.
- Renovación de tokens: responsabilidad del cliente con el `refresh_token` del proveedor; la
  API no participa.

### 6.4 Plataforma

`/api/platform/v1/tenants` conserva el alta, la lista y (si existe) la baja, con
`Idempotency-Key`; el alta acepta `widget_client` y se añade la ruta de credenciales de §5.4. Se autentica con un bearer de rol `platform` (`client_credentials` del
cliente de plataforma). `/api/platform/v1/tokens` se elimina. La auditoría usa el `sub` del
token como `actor_subject`. El tenant sigue viajando en el cuerpo solo aquí.

## 7. Laboratorio en `keycloak.mangomorado.com`

`backend/scripts/idp-lab/` (TypeScript, idempotente, lee credenciales de admin de env):

- Realm `chatbot-lab` con mappers que emiten el contrato §4.1 (hardcoded claim `tenant_id`
  por cliente máquina, atributo de usuario `tenant_id` para humanos, roles en `roles`).
- El atributo `tenant_id` se **declara** en el User Profile del realm (desde Keycloak 24 los
  atributos no declarados no se guardan y el mapper no emitiría nada).
- El claim `roles` incluye también los roles por defecto del realm (`default-roles-*`,
  `offline_access`, `uma_authorization`). Es lo esperado: §4.2 los ignora.
- Audiencia `chatbot-api` por mapper de audiencia.
- Clientes: `chatbot-platform` (confidencial, rol `platform`), `widget-<tenant>` y
  `service-<tenant>` por cada tenant del seed (confidenciales), `chatbot-reference-ui`
  (público, PKCE, redirect al frontend local y desplegado), `chatbot-swagger` (público, PKCE).
- Usuarios: un `admin` y un `operator` por tenant del seed.
- Back-channel logout del cliente `chatbot-reference-ui` apuntando a la API desplegada.
- Imprime al final las variables `OIDC_*` y las credenciales de prueba para el `.env`.

## 8. Contrato publicado

- **Swagger UI** servido por el backend en `/docs` (desactivable por configuración), sobre
  `openapi.json`, `openapi-platform.json` y `openapi-sim.json` generados. Los OpenAPI declaran
  `securitySchemes` `oauth2` con flujos `authorizationCode` (PKCE) y `clientCredentials`, con
  URLs tomadas de la configuración al generar/servir. El generador no escribe `keycloak`.
- **Postman**: la colección se **genera** desde los OpenAPI (script en `backend/scripts/`),
  con autenticación OAuth2 a nivel de colección y un entorno del laboratorio. Se añade a mano
  una carpeta `/fhir` (no vive en OpenAPI) y el recorrido widget E2E. Sustituye a
  `docs/chatbot-ingenius-360.postman_collection.json`. Se versiona una **plantilla** de
  entorno sin secretos; el entorno real lo rellena quien la ejecuta con lo que imprime el
  script del laboratorio. El criterio 7 («sin pasos manuales») se cumple con una ejecución de
  Newman contra el despliegue, lanzada a mano: ninguna petición exige intervención. No entra
  en el CI (no hay red en el CI).
- **Suite `contrato-rutas`**: recorre cada operación declarada, la invoca contra los handlers
  (como hace hoy `/fhir` en pruebas) y valida status y cuerpo —incluidos errores— contra el
  esquema. Una ruta sin declarar o una respuesta fuera de esquema rompe el CI.

## 9. Cambios de política en la misma entrega

- `GOBERNANZA.md` §1.3: la superficie de plataforma se autentica con rol `platform` del
  proveedor, no con `PLATFORM_SECRET`; deja de emitir tokens.
- `GOBERNANZA.md` §1.4: el token del widget lo emite el proveedor; la conversación se prueba
  con el identificador secreto; roles `widget` · `operator` · `admin` · `service` · `platform`.
- `GOBERNANZA.md`: nueva regla de agnosticismo del proveedor (§5.5 de esta spec).
- `ROADMAP.md` §Fase 5: entregable 5 (el `session_id` ya no es claim), entregable 7
  (`token:dev` se elimina, no solo deja de ser camino) y bloque **Estado** (GOBERNANZA §7.1).
- `README.md` y `.env.example`: variables `OIDC_*`, `CREDENTIALS_ENCRYPTION_KEY`,
  `HERMES_SIM_SERVICE_CLIENTS`, laboratorio, sin `JWT_SECRET` ni `PLATFORM_SECRET`.
  `docker-compose.yml` igual. `README.md` documenta además lo que Hermes debe hacer para
  integrarse: emitir el contrato §4 (o configurar el mapeo), crear el cliente de widget por
  clínica y entregarlo, y llamar al back-channel logout.

## 10. Preguntas abiertas

Ninguna. Las del revisor se resolvieron en §2, §3, §5.4, §6.1, §6.3 y §8.

## 11. Pruebas

- Unitarias: mapper de claims (rutas, sufijos `[]` y `{}` con cero/uno/varios, mapa de roles,
  cero/varios roles, tenant ausente),
  verificador con JWKS local (issuer/audiencia/algoritmo/expiración), back-channel logout.
- `roles`, `aislamiento-tenant`, `sesion-widget`, `idempotencia`, `fhir-conformance`,
  `hermes-simulador`: mismo comportamiento, tokens firmados por el emisor de pruebas.
- `fronteras`: regla de §5.5.
- `contrato-rutas` (5.3).
- Unitarias de `SecretBox` (cifrar/descifrar, clave errónea, manipulación detectada) y de la
  ruta de credenciales de widget (el secreto nunca sale en respuestas ni auditoría).
- Manual: login en el laboratorio desde el frontend de referencia; logout y `401` posterior;
  Swagger «Authorize» con cada flujo; Postman de punta a punta contra el despliegue.

## 12. Fuera de alcance

- Gestión de usuarios desde nuestra API (se hace en el proveedor).
- Cuentas de paciente.
- Store compartido del rate limit, purga de claves de idempotencia, barrido de vencimientos
  (Fase 6).
- Integración con el Keycloak real de Hermes (se hará cambiando configuración cuando se
  conozca su modelo).
