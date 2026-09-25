---
version: 1
slug: "frontend-src-app-layout-tsx"
primary_target: "frontend/src/app/layout.tsx"
related_targets: ["frontend/src/app/panel/page.tsx","frontend/src/app/panel/ajustes/page.tsx","frontend/src/app/simulador/page.tsx"]
---

# Panel operativo Ingenius360 (shell, panel, ajustes, simulador)

Modo: Operate. Audiencia hoy: equipo técnico / QA que prueba fases con JWT de `token:dev`; ids y request_id visibles pero secundarios. Tarea: autenticarse, consultar agenda/disponibilidad/expediente, ajustar el tenant y sembrar maestros en el simulador. Restricciones: sin reglas de negocio en el frontend, cliente orval intacto, mismas llamadas a la API; rediseño con reorganización de UX autorizada; tema oscuro índigo pedido por el usuario.

## Direction contract

THESIS: El panel es un tablero de salidas: cada cupo, cita o registro es una fila de celdas de ancho fijo cuyo estado se lee de un vistazo. Rechaza la consola SaaS de tarjetas con barra lateral y glow violeta.

OWN-WORLD: Fondo índigo casi negro (#140C33), cara del tablero #1E1450, celdas #271A63 con filetes #3A2C86; tinta #F4F1FF y lavanda #B9B0E0. Violeta de marca #8851FA solo para acción primaria y selección. Color de estado por ley: libre verde, tentativo ámbar, ocupado rosa, no disponible gris, y en ningún otro lugar. Figtree para la interfaz; Martian Mono solo para horas, fechas e ids. Retícula de 4 px. Rótulos de dos capas: nombre humano sobre clave técnica.

STORY: QA pega el token, ve rol y tenant confirmados por /me, pasa por teclado (1–4) entre pantallas, consulta la agenda como un tablero y siembra datos en el simulador por pestañas sin perder lo escrito.

FIRST VIEWPORT: Marquesina superior de 56 px: isotipo y wordmark claro a la izquierda, andenes Panel/Ajustes/Simulador con su tecla, reloj en vivo y chip de sesión (rol · tenant) a la derecha. En /panel, el tablero de agenda ocupa ~2/3 del ancho: el encabezado del tablero contiene los filtros Desde/Hasta/Agenda y las acciones Buscar libres (primaria) y Ver agenda; las filas Inicio · Fin · Estado ocupan el resto. Columna derecha: agendas activas (clic = elegir) y expediente.

FORM: Tablero de salidas split-flap, candidato 3 de mi lista ordenada; seed key 70137331. Interacción firma: al llegar datos, las celdas de estado voltean como paletas, escalonadas por fila (200 ms, nulas con reduced-motion).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
