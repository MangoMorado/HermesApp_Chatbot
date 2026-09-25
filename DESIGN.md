---
name: Ingenius360
description: Panel operativo y consola del chatbot, leído como un tablero de salidas sobre índigo.
colors:
  ground: "#140c33"
  board: "#1e1450"
  cell: "#271a63"
  cell-hi: "#30207a"
  slot: "#0f0a28"
  flap-top: "#181040"
  rule: "#3a2c86"
  rule-soft: "#2c1f6e"
  ink: "#f4f1ff"
  ink-2: "#b9b0e0"
  ink-3: "#9d94c9"
  accent: "#8851fa"
  accent-hi: "#9d6bff"
  accent-ink: "#ffffff"
  focus: "#c8b0fb"
  ok: "#4ade9a"
  hold: "#f2c94c"
  busy: "#ff7a93"
  off: "#9d94c9"
  info: "#c8b0fb"
  danger: "#ff9b6b"
  danger-ground: "#3b1a2a"
typography:
  display:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 550
    lineHeight: 1.5
  column-head:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  data:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    fontFeature: "tnum"
  tile:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.04em"
    fontFeature: "tnum"
  flap:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  tile: "4px"
  control: "6px"
  board: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.cell-hi}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hi}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
  button-small:
    padding: "0 10px"
    height: "28px"
  button-danger-armed:
    backgroundColor: "{colors.danger-ground}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.slot}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  field-key:
    textColor: "{colors.ink-3}"
    typography: "{typography.data}"
  board:
    backgroundColor: "{colors.board}"
    rounded: "{rounded.board}"
  board-column-head:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.ink-2}"
    typography: "{typography.column-head}"
    padding: "8px 20px"
  board-row:
    height: "44px"
    padding: "4px 20px"
  board-row-selected:
    backgroundColor: "{colors.cell-hi}"
  tile:
    textColor: "{colors.ink}"
    typography: "{typography.tile}"
    rounded: "{rounded.tile}"
    padding: "0 8px"
    height: "28px"
  flap:
    textColor: "{colors.off}"
    typography: "{typography.flap}"
    rounded: "{rounded.tile}"
    padding: "0 10px"
    height: "28px"
  flap-ok:
    textColor: "{colors.ok}"
  flap-hold:
    textColor: "{colors.hold}"
  flap-busy:
    textColor: "{colors.busy}"
  flap-info:
    textColor: "{colors.info}"
  notice-error:
    backgroundColor: "{colors.danger-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  marquee:
    backgroundColor: "{colors.board}"
    padding: "0 24px"
    height: "56px"
  session-chip:
    backgroundColor: "{colors.slot}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
---

# Design System: Ingenius360

## Overview

**Creative North Star: "El tablero de salidas"**

El panel de Ingenius360 se lee como el tablero de salidas de una terminal: cada cupo, cita o registro es una fila de celdas de ancho fijo y su estado se lee de un vistazo en una paleta split-flap. El mundo es un índigo casi negro tomado del peso profundo del logotipo, con la cara del tablero y sus celdas escalonadas en tonos de la misma familia, filetes finos en lugar de sombras y el violeta de marca reservado para la acción primaria y la selección.

La densidad es operativa: filas de 44 px, encabezados de columna pequeños y pegajosos, datos técnicos (horas, fechas, ids, claves de API) en fuente monoespaciada y todo lo humano en Figtree, la sans geométrica que acompaña al wordmark. El color de estado es ley: vive solo en las paletas, así que un vistazo al tablero dice qué está libre sin que nada más compita por el ojo. La navegación también es de terminal: una marquesina de 56 px con los andenes (pantallas) numerados y atajos de teclado 1 a 4.

Rechazo confirmado: la consola SaaS de tarjetas con barra lateral y resplandor violeta. Aquí no hay glow, ni sombras de tarjeta, ni barra lateral.

**Key Characteristics:**
- Tema oscuro índigo de una sola familia tonal (ground → board → cell → cell-hi).
- Profundidad por tono y filete de 1 px, nunca por sombra.
- Paleta split-flap como único portador de color de estado; horas en paletas neutras.
- Dos fuentes con frontera estricta: Figtree para lo humano, Martian Mono para lo técnico.
- Retícula de 4 px.
- Rótulos de dos capas: nombre humano y clave de API.

## Colors

Una familia índigo-violeta de marca, con cinco tintas de estado que solo aparecen en las paletas y un naranja reservado al error.

### Primary
- **Violeta Ingenius** (accent): color del wordmark. Solo acción primaria (botón primario), selección (subrayado del andén y la pestaña activos, contorno interior de la fila elegida) y el tinte de hover de filetes. Nunca decorativo.
- **Violeta Encendido** (accent-hi): hover del botón primario y color del cursor de texto.
- **Blanco de Acción** (accent-ink): texto sobre el violeta.

### Neutral
- **Índigo Noche** (ground): fondo de página; también el `color-scheme` oscuro y la pista de la barra de scroll.
- **Cara del Tablero** (board): superficie de tableros, marquesina, franja de sesión, bloques de formulario y filas de la portada. Es también el `themeColor` del navegador.
- **Celda** (cell): encabezados de columna, botón secundario en reposo, hover de fila elegible, base del skeleton.
- **Celda Encendida** (cell-hi): fila seleccionada, hover del botón secundario, brillo del skeleton.
- **Ranura** (slot): lo más hundido: interior de inputs, chip de sesión, `kbd`, mitad inferior de paletas y tiles.
- **Tapa de Paleta** (flap-top): mitad superior de paletas y tiles; el corte a 50% entre flap-top y slot dibuja la bisagra split-flap.
- **Filete** (rule): bordes de tablero, inputs, botones y separadores de sección.
- **Filete Tenue** (rule-soft): separador entre filas del tablero y huecos de 1 px entre salidas de la portada.
- **Tinta** (ink): texto principal.
- **Lavanda Media** (ink-2): texto secundario, descripciones, encabezados de columna, andenes en reposo.
- **Lavanda Apagada** (ink-3): pistas, claves de API, pie del tablero, celdas vacías (`—`), teclas `kbd`.
- **Anillo de Foco** (focus): contorno de 2 px de `:focus-visible` en todo el producto.

### Tintas de estado (solo en la paleta)
- **Verde Libre** (ok): exclusivamente LIBRE.
- **Ámbar Tentativo** (hold): TENTATIVO y PRE-REGISTRO.
- **Rosa Ocupado** (busy): OCUPADO, NO ASISTIÓ, RECHAZADO.
- **Gris Fuera de Servicio** (off): NO DISPONIBLE, CANCELADA, INACTIVA, SIN SESIÓN y cualquier estado desconocido.
- **Lavanda Informativa** (info): todo otro estado positivo o neutro: ACTIVO, ACTIVA, AGENDADA, ATENDIDA, EN SESIÓN. Fuera de las paletas, la misma lavanda colorea los enlaces.

### Error
- **Naranja de Error** (danger) sobre **Vino de Aviso** (danger-ground): la franja de aviso de error (borde, código del contrato) y el botón de borrado en dos pasos cuando está armado. Nunca es un estado.

### Named Rules
**The Status-Is-Law Rule.** El color de estado vive solo en la paleta (`.flap`). Verde solo para LIBRE; ámbar tentativo; rosa ocupado; gris no disponible o inactivo; lavanda para cualquier otro estado positivo o neutro. Ningún texto, borde, fondo, icono o gráfico fuera de la paleta usa ok, hold o busy.

**The Orange-Means-Error Rule.** El naranja (danger) es el idioma del error: avisos de error y la confirmación armada de un borrado. Jamás marca un estado de negocio.

**The Violet-Is-Action Rule.** El violeta de marca aparece solo donde el usuario actúa o ha elegido: botón primario, andén/pestaña activos, fila seleccionada. Un violeta decorativo es un error.

## Typography

**Display Font:** Figtree (con system-ui, sans-serif), cargada vía `next/font` como `--font-ui`.
**Body Font:** Figtree.
**Label/Mono Font:** Martian Mono 400/600 (con ui-monospace, monospace), cargada como `--font-data`, con cifras tabulares.

**Character:** Figtree es la sans geométrica que acompaña al wordmark: cálida y legible para lo humano. Martian Mono es la tipografía del tablero: ancha, técnica, con cifras de igual ancho para que las horas se alineen como paletas.

### Hierarchy
- **Display** (650, 1.75rem / 1.5rem a ≤760px, 1.2, -0.02em): título de página (h1), uno por pantalla.
- **Headline** (650, 1.25rem, 1.3): título de tablero.
- **Title** (650, 1.0625rem, 1.3): h2 de secciones, nombre de registro y de destino en la portada (600).
- **Body** (400, 0.9375rem, 1.5): texto corrido; descripciones de página hasta 68ch.
- **Label** (550, 0.8125rem): nombre humano del campo; también pistas y pies (400, ink-3/ink-2).
- **Column head** (600, 0.6875rem, 0.08em, mayúsculas): solo encabezados de columna del tablero, en Figtree.
- **Data** (Martian Mono 400, 0.8125rem, tabular): ids, claves de API, fechas, reloj, códigos de error, request_id, valores técnicos en inputs.
- **Tile** (Martian Mono 600, 0.875rem, 0.04em, tabular): horas en paleta neutra.
- **Flap** (Martian Mono 600, 0.75rem, 0.06em, mayúsculas): rótulo de estado.
- **Día de tablero** (Martian Mono, 0.75rem, 0.06em, mayúsculas): fila separadora por jornada.

### Named Rules
**The Two-Voices Rule.** Martian Mono solo para horas, fechas, ids, claves técnicas y el rotulado de paletas y tiles. Todo texto humano va en Figtree, incluido el texto de las opciones de un `select`. Un input lleva la clase de datos solo si su valor es técnico (fecha, token, id, número de documento).

**The Two-Layer Label Rule.** Cada campo se rotula en dos capas en la misma línea: el nombre humano (Label, ink) a la izquierda y la clave del contrato de API (Data 0.6875rem, ink-3) alineada a la derecha.

## Layout

Retícula de 4 px: todos los espacios observados son 4, 8, 12, 16, 20, 24 y 32 px. La página es una columna centrada de hasta 1360 px con 32 px arriba, 24 px laterales y 64 px abajo, y 24 px entre bloques.

- **Marquesina** pegajosa de 56 px arriba: marca, andenes numerados, y a la derecha reloj y chip de sesión. Bajo ella se despliega la franja de sesión (dos columnas; una a ≤760px), abierta por defecto sin token.
- **División principal** (`split`): tablero dominante a 2fr y columna lateral de mínimo 320 px a 1fr. **CRUD del simulador**: formularios a 280–360 px y listado al resto. Ambas pasan a una columna a ≤1080px.
- **Tablero**: encabezado con título, pista y controles (fila flexible con wrap, alineados abajo, 12 px de separación); tabla con encabezado pegajoso y cuerpo con scroll hasta min(640px, 70vh) (sin límite a ≤760px).

### Named Rules
**The Departure-Board Rule.** Las filas de los tableros se agrupan por día bajo una fila separadora en mono; las horas van en tiles neutros; las columnas de hora, ids y claves se ciñen a su contenido (ancho 1%) y la columna de estado ocupa el resto.

**The Narrow-Board Rule.** A ≤760px las columnas marcadas como opcionales desaparecen, el relleno lateral de celdas baja de 20 a 8 px, el wordmark cede al isotipo y se ocultan reloj y teclas `kbd`. Las columnas esenciales (hora y estado) nunca se ocultan.

## Elevation & Depth

Sistema plano. No hay `box-shadow` de elevación: la profundidad se construye por tono dentro de la familia índigo (ranura más oscura que el fondo, tablero más claro que el fondo, celdas más claras que el tablero) y por filetes de 1 px. La única sombra del producto es el contorno interior de 1 px violeta de la fila seleccionada, que es un borde, no una elevación. La marquesina es pegajosa pero no proyecta sombra: solo un filete inferior.

### Named Rules
**The Tone-Not-Shadow Rule.** Para separar o elevar, sube un escalón tonal (ground → board → cell → cell-hi) o añade un filete; nunca una sombra ni un resplandor.

## Shapes

Esquinas contenidas y funcionales: 4 px para piezas de tablero (paletas, tiles, `kbd`), 6 px para controles (botones, inputs, avisos), 12 px para contenedores (tableros, bloques de formulario, lista de destinos) y píldora completa solo para el chip de sesión y el punto de sesión. Los contenedores recortan su contenido (`overflow: hidden`) para que encabezados y filas respeten la esquina. La forma firma es la bisagra split-flap: un degradado duro al 50% entre la tapa y la ranura, compartido por paletas de estado y tiles de hora.

## Components

### Buttons
Sobrios y táctiles: se hunden un píxel al pulsar.
- **Shape:** esquina suave (6px), 36 px de alto, 16 px de relleno lateral, Figtree 600.
- **Secundario (por defecto):** fondo celda, filete, tinta. Hover: celda encendida y filete teñido de violeta al 60%.
- **Primario:** violeta sobre blanco; hover al violeta encendido. Uno por grupo de acciones.
- **Ghost:** transparente, lavanda media; para acciones terciarias (copiar request_id, recargar).
- **Small:** 28 px de alto, 10 px de relleno, 0.8125rem.
- **Borrado en dos pasos:** texto naranja en reposo; al armarse, fondo vino y borde naranja; el segundo clic confirma.
- **Estados:** `:active` baja 1 px; deshabilitado al 45% de opacidad; ocupado con cursor de progreso. Transiciones de 160 ms con `ease-out` exponencial.

### Chips
- **Chip de sesión:** píldora de 32 px en ranura con filete; punto de 8 px, rol · tenant y tecla 4. Hover: filete violeta. A ≤760px muestra solo el rol.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** cara del tablero sobre índigo noche.
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Border:** filete de 1 px; secciones internas separadas por filete superior.
- **Internal Padding:** encabezado 16/20 px, cuerpo 16/20/20 px, bloque de formulario 16 px.

### Inputs / Fields
- **Style:** 36 px, ranura, filete, esquina 6px, 12 px de relleno; placeholder en lavanda apagada. Selects sin apariencia nativa con chevron SVG lavanda a 12 px del borde derecho; el selector de fecha nativo se tiñe hacia lavanda.
- **Hover:** filete teñido de violeta al 50%.
- **Focus:** contorno de 2 px en color foco sin separación y borde transparente.
- **Rótulo:** siempre de dos capas (ver The Two-Layer Label Rule).

### Navigation
- **Marquesina y andenes:** andenes en Figtree 550 lavanda media con su tecla `kbd` en mono; hover a tinta; activo en tinta con subrayado violeta de 2 px y `kbd` con borde violeta. Atajos 1–3 para pantallas y 4 para la sesión.
- **Pestañas:** misma gramática que los andenes, 44 px de alto, contador en lavanda apagada; scroll horizontal si no caben.
- **Marca:** wordmark bicolor por diseño («Ing» en violeta y el resto en índigo oscuro); sobre el índigo de la marquesina se usa la variante clara (`logotipo-claro.png`), donde la parte oscura pasa a blanco. Isotipo a ≤760px y como icono de la app.

### Paleta de estado (Flap)
Componente firma. Pieza de 28 px, esquina 4px, bisagra split-flap, rotulado Martian Mono 600 en mayúsculas coloreado según la tinta de estado; por defecto gris. Al llegar datos, cada paleta voltea desde −88° con un destello de brillo en 240 ms, escalonada 24 ms por fila (tope de 16 filas); nula con `prefers-reduced-motion`. Un estado desconocido se muestra tal cual en gris.

### Tile de hora
La misma pieza que la paleta, sin color: tinta sobre la bisagra, 0.875rem, cifras tabulares. En listas sin agrupar va precedida del día en mono lavanda media. El instante ISO completo queda en `title`.

### Tablero (Board)
Encabezados de columna pegajosos en celda; filas de 44 px con filete tenue; hover de fila elegible a celda; fila seleccionada en celda encendida con contorno interior violeta. Estados: sin consultar y vacío como mensaje centrado (título en tinta, pista en lavanda); cargando como cuatro filas skeleton con brillo; pie con el número de filas y aviso de más páginas.

### Aviso (Notice)
Franja de error: vino con borde naranja, código del contrato en mono naranja, mensaje en tinta, botón ghost para copiar el request_id y la traza en mono lavanda media. La variante de éxito usa ranura y filete, sin color de estado.

### Salidas (portada)
Lista de destinos separados por huecos de 1 px en filete tenue: tecla grande en mono lavanda apagada (1.5rem), nombre y descripción, y una paleta de estado a la derecha. Hover: celda.

## Do's and Don'ts

### Do:
- **Do** poner cada estado de negocio en una paleta (`Flap`) y en ningún otro sitio: verde solo LIBRE, ámbar tentativo, rosa ocupado, gris no disponible/inactivo, lavanda para el resto.
- **Do** mostrar horas en tiles neutros y agrupar las filas del tablero por día.
- **Do** ceñir columnas técnicas a su contenido (ancho 1%) y dejar que la columna de estado ocupe el resto; marcar como opcionales las columnas prescindibles para que desaparezcan a ≤760px.
- **Do** rotular cada campo con nombre humano y clave de API.
- **Do** usar Martian Mono solo para horas, fechas, ids, claves técnicas y rotulado de paletas/tiles; Figtree para todo lo humano, incluidas las opciones de un `select`.
- **Do** mantener todos los espacios en la retícula de 4 px.
- **Do** separar superficies por escalón tonal y filete de 1 px.
- **Do** usar la variante clara del wordmark sobre índigo, conservando «Ing» en violeta.

### Don't:
- **Don't** usar ok, hold o busy fuera de la paleta: ni en textos, bordes, puntos, gráficos ni fondos.
- **Don't** usar el naranja de error para un estado ni para decorar; solo avisos de error y borrado armado.
- **Don't** usar el violeta de marca como decoración, degradado o resplandor; solo acción primaria y selección.
- **Don't** añadir sombras de tarjeta, glow violeta ni barra lateral: el tablero es plano y la navegación va en la marquesina.
- **Don't** poner texto humano en Martian Mono ni datos técnicos en Figtree.
- **Don't** recolorear el wordmark en un solo tono ni usar la versión oscura sobre el índigo.
