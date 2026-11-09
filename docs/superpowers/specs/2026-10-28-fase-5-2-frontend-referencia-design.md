# Fase 5.2 — Frontend de referencia con login OIDC (diseño)

> Estado: **abierta**.
> Fuente del alcance: `ROADMAP.md` §Fase 5, entregables 1 y 4, criterios 1 y 3 (manual en
> navegador). Corte de sub-proyectos en la §3 de
> `2026-10-27-fase-5-identidad-oidc-contrato-design.md` (en adelante, «spec de fase»). Manda
> `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

El frontend de este repo es un **ejemplo** de lo que construirá Hermes, y el simulador sirve
para probar y para mostrar cómo funciona el sistema. Ninguno de los dos se despliega al conectar
con Hermes. Aun así, **todo token que usen lo emite el proveedor de identidad**: no hay campo
para pegar un JWT, no hay atajos locales y no hay secretos de cliente en el navegador.

Hoy la franja de sesión (`components/shell/session-drawer.tsx`) pide pegar un JWT, que se guarda
en `sessionStorage` (`lib/token.ts`). El alta de clínicas (`components/simulador/tenants-panel.tsx`)
pide pegar un segundo token de rol `platform`. Esta entrega sustituye los dos por un login
estándar Authorization Code + PKCE contra el proveedor.

| Sub-proyecto | Contenido | Entregables | Criterios |
| --- | --- | --- | --- |
| 5.1 Corte de identidad | Cerrada en `main` (PR #13) | 2, 3, 4, 5, 6, 7 | 1, 2, 3, 4, 5, 6 |
| **5.2 Frontend de referencia** (esta spec) | Login PKCE en `/panel` y `/simulador`, persona `platform` en el laboratorio, fin del token pegado | 1, 4 | 1, 3 (manual en navegador) |
| 5.3 Contrato publicado | Swagger UI, Postman, `contrato-rutas` | 8, 9, 10 | 7, 8 |

### 1.1 Objetivos

- Admin, operador y plataforma entran a la consola por el proveedor (Authorization Code + PKCE,
  cliente público `chatbot-reference-ui` del laboratorio) y salen por él.
- La sesión se renueva sola mientras la pestaña sigue abierta.
- Cerrar sesión cierra también la sesión del proveedor. El back-channel logout de la 5.1 hace
  que el token anterior, reutilizado, reciba `401`.
- El laboratorio crea una persona con rol `platform`, sin `tenant_id`, que da de alta clínicas
  desde `/simulador` con su propia sesión.

### 1.2 Anti-objetivos (fallaría aunque funcione)

- Que quede algún camino para pegar o inyectar un JWT a mano en la consola.
- Que el navegador reciba un secreto de cliente (incluido el de `chatbot-platform`).
- Que el frontend dependa de `keycloak-js` o que el texto `keycloak` aparezca en
  `frontend/src/**` (lo vigila la suite `fronteras`).
- Que el frontend decida permisos decodificando el token: el rol y la clínica que se muestran
  son los que confirma el backend.
- Que la URL del proveedor o el client id se horneen en el build: se leen en tiempo de ejecución,
  igual que `PUBLIC_BACKEND_URL`.

## 2. Decisiones tomadas

Las marcadas *usuario* se acordaron en el brainstorming; las marcadas *diseño* son del redactor,
revisables.

| Tema | Decisión | Quién | Razón |
| --- | --- | --- | --- |
| Papel del frontend | Ejemplo de Hermes y herramienta de pruebas/demostración. Todo token lo emite el proveedor | usuario | Mostrar el camino real, sin atajos |
| Alta de clínicas | La hace una **persona** con usuario de rol `platform` en el proveedor, con su sesión PKCE | usuario | El secreto de `chatbot-platform` no puede ir al navegador |
| `/chat` | Sigue abierto, sin login: se pega la clave pública del widget como hoy | usuario | Es la vista de un sitio público de clínica |
| Widget | Sin cambios de comportamiento: ya abre y renueva su sesión con el proveedor y `conversation_secret` desde la 5.1. Solo se verifica a mano | diseño | La 5.1 dejó el widget completo |
| Librería OIDC | `oidc-client-ts` (genérica, certificable, sin código del proveedor) | diseño | Evita escribir PKCE, `state`, `nonce` y renovación a mano; cumple el anti-objetivo de `keycloak-js` |
| Almacenamiento | `sessionStorage` (por pestaña), como hoy | diseño | Mismo alcance que el token pegado; cerrar la pestaña cierra la consola |
| Renovación | Automática con el `refresh_token` del proveedor antes de vencer el acceso (5 min en el laboratorio) | diseño | Spec de fase §6.3: la renovación es del cliente |
| Cambio de rol | Cerrar sesión y entrar con otro usuario | diseño | Un rol por token (spec de fase §4) |
| Cierre de sesión | RP-initiated logout (`end_session_endpoint`) con `id_token_hint` y vuelta a la página de inicio | diseño | Cierra la sesión del proveedor, que dispara el back-channel hacia la API |
| Identidad de `platform` | Nuevo `GET /api/platform/v1/me` → `{ subject, role }` | diseño | `/api/v1/me` excluye `platform` y no debe ganarlo (spec de fase §6.4); la franja sigue mostrando lo que confirma el backend |
| Qué `/me` llamar | `useIdentity()` pide `/api/v1/me` y `/api/platform/v1/me` en paralelo y se queda con el que responda `200`. Si ninguno, muestra el error de `/api/v1/me` | diseño | Sin decodificar el token y sin usar un `403` como señal ambigua |
| `/chat` y la sesión | Queda dentro del grupo `(console)` y de `AuthProvider`, que no bloquea la carga sin sesión. Si hay sesión de clínica, conserva el relleno de la clave vigente | diseño | Sigue abierto sin login (decisión del usuario) y no pierde lo que hace hoy |
| Logout `401` | La prueba de token reutilizado tras logout se hace **solo en Easypanel**. En local el logout funciona, pero el back-channel apunta a `LAB_API_URL` (la API desplegada) y el backend local no se entera | diseño | Un realm, un `backchannel.logout.url`; el proveedor no alcanza `localhost` |
| Configuración | `PUBLIC_OIDC_ISSUER` y `PUBLIC_OIDC_CLIENT_ID` en `frontend/src/config/env.ts`, leídas en el servidor por petición y pasadas al cliente por props | diseño | Mismo patrón que `publicBackendUrl()` |
| Persona `platform` | `idp:lab` crea `platform-lab` con rol `platform` y sin atributo `tenant_id` | diseño | Nombre sin clínica, coherente con `admin-<slug>` / `operator-<slug>` |
| Redirecciones | `LAB_FRONTEND_URLS` ya alimenta los redirect URIs de `chatbot-reference-ui`; se documenta incluir ahí la URL del frontend de Easypanel | diseño | El script ya lo soporta; solo falta usarlo |

## 3. Arquitectura del frontend

```
frontend/src/
  config/env.ts            + oidcIssuer(), oidcClientId()  (solo servidor)
  lib/auth/                nuevo: único lugar que importa oidc-client-ts
    user-manager.ts        crea el UserManager con la config recibida
    auth-provider.tsx      contexto cliente: estado, signIn(), signOut()
    callback.ts            procesa la vuelta del proveedor
  lib/token.ts             getToken() pasa a leer el access token del UserManager
  lib/use-session.ts       useToken() / useIdentity() con la misma firma
  app/(console)/layout.tsx lee env en el servidor y monta AuthProvider dentro de Providers
  app/(console)/auth/callback/page.tsx   ruta de retorno del login
  components/shell/session-drawer.tsx    sin campo de token: botones y claims
  components/simulador/tenants-panel.tsx sin campo de token: usa la sesión si es platform
```

- **La firma de `getToken()` / `useToken()` no cambia.** Paneles, bandeja, cupos y
  `apiFetcher` siguen igual; solo cambia de dónde sale el token. `useIdentity()` pasa a devolver
  una unión (identidad de clínica con `tenant_id`, o de plataforma sin él); sus consumidores
  (`marquee`, `(console)/page`, `chat-console`, `bot-config-screen`, `knowledge-board`) se
  ajustan a esa unión. El diff se concentra en `lib/auth/`, la franja, el alta de clínicas y esos
  consumidores.
- `apiFetcher` sigue mandando `Authorization: Bearer` por el proxy same-origin
  (`app/api/[...path]`). `platformFetcher` deja de recibir un token pegado: toma el de la sesión.
- El `redirect_uri` es `<origen>/auth/callback`; tras el login se vuelve a la ruta desde la que
  se pidió (guardada en el `state` de OIDC). `post_logout_redirect_uri` es `<origen>/`.
- El montaje `(embed)` del widget queda fuera de `AuthProvider`. `/chat` queda dentro (§2): carga
  y conversa sin sesión; con sesión de clínica, `chat-console` sigue proponiendo la clave vigente.
  El widget nunca usa el token de la consola.

### 3.1 Qué ve cada rol

| Sesión | `/panel` | `/simulador` (datos y bandeja) | `/simulador` (alta de clínicas) | Franja de sesión |
| --- | --- | --- | --- | --- |
| Sin sesión | Botón «Iniciar sesión» | Botón «Iniciar sesión» | Botón «Iniciar sesión» | «Iniciar sesión» |
| `admin` | Completo | Completo | Explica que hace falta entrar como `platform` | rol, clínica, sujeto (`/api/v1/me`) |
| `operator` | Lo que su rol alcanza, como hoy | Lo que devuelva la API (hoy `403`, mostrado con `ErrorBox`) | Igual que `admin` | rol, clínica, sujeto |
| `platform` | Explica que `platform` no opera dentro de una clínica | Igual que `/panel` | Formulario de alta con el token de la sesión | rol y sujeto (`/api/platform/v1/me`), sin clínica |

El frontend elige qué pantalla mostrar según el rol que confirma el backend, sin replicar las
reglas de autorización: si la API responde `401`/`403`/`404`, se muestra su error tal cual.

### 3.2 Errores y bordes

- Token renovado que falla (refresh vencido o sesión cerrada en el proveedor): se borra la
  sesión local y se muestra «Iniciar sesión». Un `401` de la API dispara un intento de
  renovación; si vuelve a fallar, mismo resultado.
- Retorno del proveedor con `error` (usuario canceló, cliente mal configurado): la página de
  callback lo muestra con su `error_description` y un enlace a volver a intentar.
- Configuración ausente (`PUBLIC_OIDC_ISSUER` o `PUBLIC_OIDC_CLIENT_ID` vacías): la consola
  muestra un aviso de configuración en lugar del botón; no se cae.

## 4. Backend

Un único cambio de contrato:

- `GET /api/platform/v1/me` con `platformRoute` (`backend/src/http/platform-route.ts`, que
  aplica `requirePlatformActor`), respuesta `{ subject: string, role: "platform" }`. Se declara en el OpenAPI de plataforma, se regenera
  (`openapi:generate`) y el cliente orval del frontend se regenera sin edición manual.
- `/api/v1/me` no cambia y sigue sin aceptar `platform`.

## 5. Laboratorio (`backend/scripts/idp-lab/`)

- `UserPlan.tenantId` pasa a opcional. `buildLabPlan` añade `platform-lab` con rol `platform` y
  sin atributo `tenant_id`. El resto de usuarios no cambia. `createUser` y `ensureUser`
  (`apply.ts`) omiten el atributo cuando no hay `tenantId` (no escriben `[undefined]`).
- La reconciliación idempotente de usuarios cubre al nuevo (crea si falta; asigna rol y
  contraseña `LAB_USER_PASSWORD`).
- El resumen final lo lista junto a los demás usuarios.
- Pruebas unitarias del plan: existe `platform-lab`, tiene rol `platform` y no lleva
  `tenant_id`.

## 6. Pruebas

- Unitarias del frontend (Vitest): `lib/auth/` con un `UserManager` falso (estado inicial,
  login, renovación, fallo de renovación borra la sesión, logout); `useToken()` refleja el
  usuario actual; la franja muestra «Iniciar sesión» sin sesión y los claims con sesión; el alta
  de clínicas solo envía con rol `platform` y nunca muestra un campo de token.
- Backend: `GET /api/platform/v1/me` en `roles` (solo `platform` → 200; los demás roles → `403`
  `forbidden` de `requirePlatformActor`) y `contrato-api` alineada.
- `fronteras` sigue verde (sin `keycloak` en `frontend/src/**`).
- React Doctor 100/100.
- **Manual en navegador** (criterios 1 y 3), local y en Easypanel contra `chatbot-lab`:
  1. Entrar como `admin-clinica-norte`: `/panel` y `/simulador` cargan; la franja muestra rol y
     clínica.
  2. Entrar como `operator-clinica-sur`: ve solo lo de su clínica y rol.
  3. Entrar como `platform-lab`: dar de alta una clínica desde `/simulador`.
  4. Dejar la pestaña más de 5 minutos: la consola sigue operando (renovación).
  5. **Solo en Easypanel:** copiar el access token de `sessionStorage`, cerrar sesión, y
     reutilizarlo con `curl` contra `/api/v1/me` de la API desplegada: `401`.
  6. `/chat` con la clave de una clínica, sin login: abre y conversa. Con sesión de admin,
     propone la clave vigente.

## 7. Cambios de documentación en la misma entrega

- `README.md` y `frontend/.env.example`: `PUBLIC_OIDC_ISSUER`, `PUBLIC_OIDC_CLIENT_ID`; incluir
  la URL del frontend desplegado en `LAB_FRONTEND_URLS` al correr `idp:lab`; usuario
  `platform-lab`.
- `ROADMAP.md`: bloque **Estado** al cerrar (GOBERNANZA §7.1).
- `CLAUDE.md`: estado de la 5.2 al cerrar.
- `GOBERNANZA.md`: sin cambio de política previsto (la regla de agnosticismo ya cubre el
  frontend).

## 8. Fuera de alcance

- `/chat` y el widget (ya resueltos en la 5.1).
- Swagger UI, Postman y `contrato-rutas` (5.3).
- Gestión de usuarios desde la consola (se hace en el proveedor).
- Endurecimiento de la consola (CSP, almacenamiento en memoria en vez de `sessionStorage`):
  Fase 6.
