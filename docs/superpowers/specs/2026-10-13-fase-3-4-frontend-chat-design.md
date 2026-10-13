# Fase 3.4 — Frontend del chat: widget, consola y panel (diseño)

> Estado: **implementada** en la rama `fase-3-4-frontend-chat` (pendiente de merge por el usuario), con sus tests unitarios y puertas de calidad en verde; el **recorrido manual en navegador** y las suites de BD (`test:db`) siguen **pendientes**. Plan en `docs/superpowers/plans/2026-10-13-fase-3-4-frontend-chat.md`.
> Fuente del alcance: `ROADMAP.md` §Fase 3, entregable 5 y la interfaz de los entregables 7 y 8;
> corte de sub-proyectos en la §1 de `2026-09-22-fase-3-1-tenant-listo-design.md`.
> Manda `GOBERNANZA.md` ante cualquier conflicto.

## 1. Objetivo y corte

La 3.4 pone interfaz a lo que la 3.1, la 3.2 y la 3.3 dejaron por HTTP. Al cerrarla, el
criterio 1 de la Fase 3 se recorre en un navegador: un paciente conversa con el bot
(identificación → verificación o pre-registro → agendar / reprogramar / cancelar / consultas /
asesor) y un admin aprueba o rechaza la solicitud desde la bandeja.

Incluye:

- Un **widget de chat** con un solo núcleo y tres montajes: script incrustable, página para
  iframe y consola `/chat`.
- Páginas de panel: base de conocimiento y configuración del bot.
- Bandeja del simulador.

No incluye: tema o colores por tenant; lectura y gestión de handoff-tickets (Fase 5); control
de quién incrusta el iframe (§2); FHIR (Fase 4); los dos hallazgos aparcados de la 3.3 (pista
de correo y eco de documento), que son de backend y van por su propio arreglo.

## 2. Decisiones tomadas

| Tema | Decisión | Razón |
| --- | --- | --- |
| Alcance de `/chat` | Consola de pruebas **y** widget embebible para sitios de tenants | Pedido del producto: el paciente es usuario de igual peso que el operador |
| Incrustación | Dos modelos: script en la página e iframe | Pedido del producto; comparten núcleo, el coste extra es un montaje |
| Control de origen en iframe | Ninguno propio: el admin añade el origen del frontend a `allowed_origins` | Cero cambios de contrato. Coste asumido: con la clave pública cualquiera puede incrustar el iframe; la protección por origen queda solo en el modo script |
| Núcleo | React, empaquetado con esbuild para el script | Un solo paradigma de UI; consola e iframe importan el componente. Pasar a Preact es un cambio de build |
| Camino de red | El widget habla **directo al backend** por CORS en los tres montajes | Es lo que la 3.3 construyó; el proxy del frontend no reenvía `Origin` y haría caer a todos los pacientes en un mismo cubo del rate limit |
| Cliente del chat | Tercer destino de orval con mutator propio | El mutator actual usa rutas relativas y el JWT del panel; el cliente no se escribe a mano |
| Sesión del paciente | `sessionStorage`, por clave de widget | Recargar conserva la conversación; cerrar la pestaña la termina. El historial ya llega redactado |
| Validación | No se duplican rangos ni reglas: se muestra el `422` del backend | Regla del frontend: sin reglas de negocio |

## 3. Cambios fuera de `frontend/`

La 3.4 no cambia el comportamiento del contrato REST. Toca dos cosas:

1. **Etiqueta OpenAPI.** Las cuatro operaciones del widget (`openWidgetSession`,
   `refreshWidgetSession`, `getWidgetConversation`, `sendWidgetMessage`) reciben
   `tags: ["widget"]` en `backend/src/http/openapi*.ts` para que orval pueda filtrarlas. Se
   regenera `openapi.json` y los clientes. Con `mode: "tags-split"` esas operaciones salen del
   archivo `default` del cliente del panel; nada en el frontend las usa hoy.
2. **Variable de entorno.** `PUBLIC_BACKEND_URL` en el frontend: URL del backend alcanzable
   desde el navegador. Se lee en runtime, solo en `frontend/src/config/env.ts`, y llega a las
   páginas como dato desde un componente de servidor. Por defecto `http://localhost:3001`.
   Se documenta en `.env.example`, `docker-compose.yml` y `README.md`.

## 4. Núcleo del widget (`frontend/src/widget/`)

```
frontend/src/widget/
  api/            # cliente generado por orval (destino `widget`); no se edita
  fetcher.ts      # mutator: URL absoluta + token del widget
  session.ts      # abrir, restaurar y renovar la sesión; almacenamiento
  chat-client.ts  # cargar conversación y enviar un turno; reintentos
  use-chat.ts     # estado de React sobre chat-client
  chat-widget.tsx # interfaz
  styles.ts       # estilos como cadena (ver §10.1)
  widget-api.ts   # puerto sobre el cliente generado (ver §10.2)
  failure.ts      # errores -> mensaje para el paciente (ver §10.2)
  embed-config.ts # lectura pura de data-key/data-api (ver §10.2)
  settled.ts      # foco y vaciado del borrador tras un envio (ver §10.8)
  embed.tsx       # punto de entrada del script
```

### 4.1 Interfaz

`ChatWidget` recibe `apiBase`, `widgetKey` y `mode`:

- `floating`: botón flotante que abre un panel de chat (script).
- `fill`: ocupa todo su contenedor (iframe y consola).

Pinta únicamente lo que devuelve el backend: la lista de mensajes (`bot` / `patient`, con los
redactados tal como llegan), las opciones del turno como botones y la entrada que el turno
pide (`none`: sin campo; `text`: campo de texto, máximo 500 caracteres; `date`: selector de
fecha que envía `YYYY-MM-DD` como `text`). No decide ningún paso del flujo.

Accesibilidad: la lista de mensajes es una región `aria-live="polite"`, el foco pasa al primer
control del turno nuevo, todo se opera con teclado y el panel flotante se cierra con `Esc`.

### 4.2 Sesión

- Clave de almacenamiento: `ingenius.widget.<widgetKey>` → `{ token, expires_at }`.
- **Arranque:** si hay token vigente, `GET /widget/conversation` restaura historial y turno. Si
  no hay o el backend responde `401`, `POST /widget/sessions` con la clave y un
  `Idempotency-Key` de 32+ caracteres, y después `GET /widget/conversation`.
- **Renovación:** `POST /widget/sessions/refresh` cuando falta menos de un minuto para
  `expires_at`, comprobado antes de cada envío.
- Si `sessionStorage` no está disponible (iframe con almacenamiento bloqueado), la sesión vive
  en memoria: funciona, pero no sobrevive a la recarga.

### 4.3 Envío de un turno

Cada envío genera un `Idempotency-Key` con `crypto.randomUUID()`. Si la petición falla por red
o `5xx`, el reintento manual del paciente reutiliza **la misma clave y el mismo cuerpo**; la
clave se descarta al recibir una respuesta `2xx` o `4xx`.

| Respuesta | Comportamiento |
| --- | --- |
| `200` | Añade el eco del paciente y las líneas del bot; reemplaza opciones y entrada |
| `409` con `details.reason = "stale_option"` | Recarga la conversación y muestra el turno vigente |
| `401` | Abre sesión nueva y recarga la conversación; no reenvía el turno |
| `403` | Estado terminal «Este sitio no está autorizado para el chat» |
| `422` | Muestra el mensaje del backend junto al campo; el turno sigue vigente |
| `429` | Bloquea el envío los segundos de `Retry-After` |
| Red / `5xx` | Aviso con botón «Reintentar» |

El eco del paciente se pinta con la etiqueta de la opción elegida. Para el texto libre no se
pinta lo que el paciente escribió: tras el `200` se recarga la conversación y se muestra el eco
que el backend persistió (redactado o enmascarado). Así el widget nunca enseña más que el
historial.

## 5. Montajes

### 5.1 Script

`npm run build:widget` empaqueta `src/widget/embed.tsx` con esbuild en un IIFE
`public/widget.js` (React incluido, CSS incrustado como texto). El archivo es generado: va en
`.gitignore`, y `npm run build` y el Dockerfile lo producen antes de `next build`.

```html
<script src="https://<frontend>/widget.js" data-key="<clave>" data-api="https://<backend>" async></script>
```

`embed.tsx` lee `data-key` y `data-api` de `document.currentScript`, crea un elemento
anfitrión con Shadow DOM, inyecta los estilos y monta `ChatWidget` en modo `floating`. Sin
alguno de los dos atributos escribe un `console.error` y no monta nada. El Shadow DOM aísla los
estilos en ambos sentidos; las fuentes son las del sistema (no se cargan fuentes externas en
el sitio del tenant).

### 5.2 Iframe

Página `/widget?key=<clave>` que monta `ChatWidget` en modo `fill` con `PUBLIC_BACKEND_URL`.
Sin cabecera de panel. Sin `key` muestra un estado vacío con el mensaje de uso.

Para que no herede la cabecera, `src/app` se parte en dos grupos de rutas: `(console)` con el
layout actual (`Marquee`, `Providers`) y `(embed)` con un layout mínimo. Las URL existentes no
cambian.

### 5.3 Consola `/chat`

Dentro del grupo `(console)`. Dos columnas: herramientas y el widget en modo `fill`.

- Con sesión `admin` u `operator` lee `bot-config` y propone la clave vigente; siempre se puede
  pegar otra clave a mano.
- Compara `window.location.origin` con `allowed_origins` y, si falta, lo avisa. Con rol `admin`
  ofrece un botón que lo añade (`addAllowedOrigin`).
- «Nueva sesión» borra la sesión guardada de esa clave y remonta el widget.

La consola no usa ningún atajo: recorre el mismo camino CORS que un sitio de tenant.

## 6. Páginas del panel

Todas en el grupo `(console)`, con el patrón actual: token pegado en la franja de sesión,
cliente orval, `useAction` para escrituras con `Idempotency-Key`, `ErrorBox` para errores y los
componentes de `components/ui/`. Sistema visual: `DESIGN.md`.

### 6.1 `/panel/conocimiento` (lee `operator` · `admin`; escribe `admin`)

Listado paginado por cursor, agrupado por categoría y ordenado por `position`. Alta y edición
en un formulario con `category`, `question`, `answer`, `detail`, `keywords`, `position` y
`active`. Borrado con confirmación. Con rol `operator` los controles de escritura no se
muestran; si se llega a un `403`, se muestra tal cual.

### 6.2 `/panel/bot` (lee `operator` · `admin`; escribe `admin`)

Cuatro tableros sobre `GET /bot-config`:

- **Textos.** Una fila por clave con su valor efectivo y la marca «personalizado» cuando
  `overridden` es `true`. Guardar envía `PATCH` con esa clave; «Predeterminado» envía `null`.
- **Parámetros.** Una fila por clave con su valor. Guardar envía `PATCH`; el rango lo valida
  el backend.
- **Orígenes permitidos.** Lista con alta (`POST`) y baja (`DELETE`) individuales.
- **Claves del widget.** Clave vigente y, si existe, la clave en gracia con su vencimiento.
  Rotar pide confirmación. Debajo, los dos fragmentos listos para copiar (script e iframe) con
  la clave vigente, y la nota de que el iframe exige que el origen del frontend esté en la
  lista de orígenes.

### 6.3 `/simulador/bandeja` (`admin`)

Solicitudes pendientes de `GET /api/sim/v1/inbox`, paginadas por cursor, con tipo, paciente,
cupo y vencimiento. Aprobar y rechazar por fila, cada uno con su `Idempotency-Key`; tras
resolver se refresca la lista. La API solo lista pendientes y el rechazo no lleva motivo, así
que la página no ofrece filtro por estado ni campo de motivo. Con el simulador apagado el
backend responde `404` y la página lo muestra como «Simulador apagado en este entorno».

### 6.4 Navegación

`Marquee` y la portada pasan de tres a siete destinos, en este orden y con estos atajos:
`1` Panel · `2` Conocimiento · `3` Bot · `4` Ajustes · `5` Chat · `6` Simulador · `7` Bandeja ·
`0` Sesión (antes `4`).

## 7. Errores

Las páginas del panel no añaden manejo nuevo: `ApiClientError` y `ErrorBox` ya muestran
`code`, `message` y `request_id`. El widget usa su propio mutator y traduce los errores a los
estados de la tabla de §4.3; al paciente nunca se le muestra el `request_id` ni un código, solo
un mensaje en español. Los textos de esos estados de error son del widget (fallos de
transporte), no del flujo: no salen de `bot-config`.

## 8. Pruebas y puertas

- **Vitest (lógica pura, sin dependencias de test nuevas).**
  - `session`: abre cuando no hay token, restaura cuando lo hay, renueva cerca del
    vencimiento, reabre ante `401`, funciona sin `sessionStorage`.
  - `chat-client`: reutiliza la `Idempotency-Key` en el reintento y la descarta tras `2xx`/`4xx`;
    recarga ante `stale_option`; respeta `Retry-After`.
  - `fetcher`: URL absoluta, cabecera `Authorization` del widget y nunca la del panel.
  - `embed`: no monta sin `data-key` o `data-api`.
- **Puertas:** `biome ci`, typecheck, tests y React Doctor en verde; `contrato-api` del backend
  en verde tras regenerar OpenAPI; clientes orval regenerados sin edición manual.
- **Recorrido manual** del criterio 1 contra el backend local con el seed, en los tres
  montajes (el script, desde una página HTML estática servida en otro puerto de `localhost`),
  más aprobar y rechazar en la bandeja. Requiere Postgres arrancado desde Laragon.

## 9. Documentación al cerrar

`README.md` (variable nueva, cómo incrustar el widget, mapa de páginas), `CLAUDE.md` y
`frontend/AGENTS.md` (estado y mapa), `GOBERNANZA.md` si la decisión del iframe sin control de
origen se considera política, y `PRODUCT.md` (el contexto operativo quedó en la Fase 2).

## 10. Refinamientos al implementar

Salen de leer el código al planificar e implementar.

1. **CSS como cadena, no `styles.css`.** `styles.ts` exporta `WIDGET_CSS` y `ChatWidget` lo pinta en un `<style>`. Así el mismo código sirve dentro del Shadow DOM y en las páginas Next, sin cargadores de CSS en esbuild.
2. **Archivos añadidos al núcleo:** `widget-api.ts` (puerto sobre el cliente generado; evita el choque de nombre con la carpeta `api/`), `failure.ts` (errores → mensaje para el paciente) y `embed-config.ts` (lectura pura de `data-key`/`data-api`, separada del arranque con efectos).
3. **`429` sin cabecera.** `Retry-After` no es legible por CORS (el backend solo expone `X-Request-Id`). El widget usa `error.details.retry_after_seconds`, que el backend ya envía en el cuerpo. El `429` solo puede ocurrir al abrir sesión.
4. **Eco del texto libre:** tras el `200` se pide `GET /widget/conversation` y se toma el **último mensaje del paciente** como eco. Las líneas del bot salen siempre de la respuesta del `POST` (pueden ir completas ahí y redactadas en el historial).
5. **Grupos de rutas con un solo layout raíz.** `app/layout.tsx` conserva `<html>`, fuentes y `globals.css`; `(console)/layout.tsx` añade `Providers`, `Marquee` y `<main>`; `(embed)` no añade nada.
6. **El destino orval `chatbot` excluye el tag `widget`** (`filters.mode: "exclude"`), para que las operaciones del widget existan en un único cliente.
7. **Listas con «Cargar más»** (`useInfiniteQuery`) en conocimiento y bandeja: es la paginación por cursor de la spec.
8. **`settled.ts`:** el foco pasa al primer control solo tras un envío del paciente, y el borrador solo se vacía cuando el turno avanza (no ante un 422).
