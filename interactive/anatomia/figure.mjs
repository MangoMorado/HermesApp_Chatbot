// Figura 3D de la anatomía del chatbot: una máquina sobre una mesa giratoria.
// La geometría se arma una vez con el modo 3D del kit anatomy (turning groups):
// la tarjeta es la solicitud, el carro la conversación, la compuerta la verificación,
// la perilla la máquina de estados, el puente FHIR la única conexión y, del lado de
// Hermes, el sello y el tablero de agenda.
//
// CLI:
//   node interactive/anatomia/figure.mjs --audit [--quick] [--only=a,b]
//   node interactive/anatomia/figure.mjs --preview <ruta.html>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kitUrl } from "./kit-path.mjs";
import {
  BASE_H,
  CHATBOT,
  follow,
  HERMES,
  LAST,
  MESA,
  PERILLA_STEP,
  poses,
  SELECTOR,
  STEPS,
  TRAVEL,
} from "./model.mjs";

const k = await import(kitUrl("kit/iso-kit.mjs"));
const G = await import(kitUrl("kit/lathe.mjs"));
const A = await import(kitUrl("kit/audit.mjs"));
const { turning } = await import(kitUrl("kit/turn-build.mjs"));
const TA = await import(kitUrl("kit/turn-audit.mjs"));

const HERE = dirname(fileURLToPath(import.meta.url));

// Cámara. Con la mesa cerca de 30° (donde arranca el recorrido) el azimut deja la máquina
// de costado, vista desde el lado +y: chatbot a la izquierda, Hermes a la derecha y la
// cara del tablero de agenda a la vista.
const W = 640;
const H = 460;
const AZIMUTH = 90;
const ELEVATION = 31;

// Pedestal estático bajo la mesa.
const DISC = { r: 112, z0: -23, z1: -20 };
const PEDESTAL = { r: 104, z0: -20, z1: -MESA.h };

// Cotas del mecanismo (mundo, z = 0 es el tablero de la mesa).
const RAIL_Z = [BASE_H, 11];
const CARRO = { x: -111, y: -18, w: 32, d: 36, r: 2 };
const CARRO_Z = [11, 16];
const TARJETA = { x: -84.2, y: -9, w: 2.4, d: 18, r: 0.5 };
const TARJETA_Z = [16, 32];
const POST_X = -63;
const PUENTE = { x: 17.1, y: -10, w: 25.8, d: 20, r: 0.8 };
const BANDEJA = { x: 43, y: -14, w: 28, d: 28, r: 1.2 };
const COLUMNA = { x: 51, y: -38, w: 12, d: 10, r: 1 };
const COLUMNA_Z = [10, 72];
const TABLERO = { x: 93, y: -33, w: 4, d: 66, r: 0.6 };
const TABLERO_Z = [BASE_H, 52];
const REPISA = { x: 97.1, y: -33, w: 2.9, d: 66, r: 0.5 };
const REPISA_TOP = 11;
const FICHA_H = 6;
// Estado fijo de cada ficha (desplazamiento sobre «libre»); la i = 2 es el grupo `ficha`.
const FICHAS = [24, 0, null, 12, 0, 24];
const PERILLA_R = 4;
const PLATINA_R = 7;
const POINTER_AT = 120;

const ring = (r, z, n = 72) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a), z];
  });

// La mesa gira: se encuadra el círculo completo y lo más alto a cualquier ángulo.
export const P = k.fitProjection(
  [
    ...ring(MESA.r, 0),
    ...ring(MESA.r, -MESA.h),
    ...ring(DISC.r, DISC.z0),
    ...ring(106, TABLERO_Z[1]),
    // La esquina de la tapa de la columna (64, −39) está a ~75 del eje.
    ...ring(76, COLUMNA_Z[1] + 2),
  ],
  W,
  H,
  { pad: 18, azimuth: AZIMUTH, elevation: ELEVATION },
);

// ——— Utilidades de markup en planos (coordenadas del plano, unidades del mundo) ———

const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const pathOf = (points, closed = false) =>
  points.map(([x, y], i) => `${i ? "L" : "M"}${num(x)} ${num(y)}`).join("") + (closed ? "Z" : "");
const circlePath = (cx, cy, r, n = 24) =>
  pathOf(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
    true,
  );
const line = (d, tone = "lo", free = false) =>
  `<path class="iso-line" data-tone="${tone}"${free ? ' data-free=""' : ""} d="${d}"/>`;
const roundRect = (plan, steps = 4) => pathOf(k.roundedPlan(plan, steps), true);
const VERT = (x, y) => G.frameOf([x, y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const polar = (cx, cy, r, deg) => [
  cx + r * Math.cos((deg * Math.PI) / 180),
  cy + r * Math.sin((deg * Math.PI) / 180),
];

// Tornillos en una cara superior: puntos (dots del part) y anillos (markup del plano).
const screwDots = (points, z, size = 0.5) =>
  points.map(([x, y]) => ({ at: [z, x, y], normal: [0, 0, 1], size, tone: "mid" }));
const screwRings = (points, r) => line(points.map(([x, y]) => circlePath(x, y, r, 20)).join(""));

// ——— Escena ———

function makeScene() {
  const R = A.recorder(P);
  const T = turning(P, { recorder: R });
  const mesa = T.group("mesa", { turn: { pivot: MESA.pivot } });
  const slide = (name, direction) =>
    T.group(name, { parent: mesa, slide: { direction, travel: TRAVEL[name] } });
  const g = {
    mesa,
    carro: slide("carro", [1, 0, 0]),
    tarjeta: slide("tarjeta", [1, 0, 0]),
    compuerta: slide("compuerta", [0, 0, 1]),
    sello: slide("sello", [0, 0, -1]),
    ficha: slide("ficha", [0, 0, 1]),
    perilla: T.group("perilla", { parent: mesa, turn: { pivot: SELECTOR } }),
  };
  const layer = T.layer("maquina");
  T.stack(["back", "maquina", "front"]);
  const ctx = { R, T, g, layer };
  pedestal(ctx);
  table(ctx);
  chatbotBase(ctx);
  rails(ctx);
  carriage(ctx);
  gate(ctx);
  selector(ctx);
  bridge(ctx);
  hermesBase(ctx);
  tray(ctx);
  stamp(ctx);
  board(ctx);
  return ctx;
}

// Caja vertical (prisma de plano redondeado) en un grupo de la capa viva.
function box(ctx, name, group, plan, z0, z1, extra = {}) {
  const r = plan.r ?? Math.min(0.6, plan.w / 4, plan.d / 4);
  return ctx.T.prism({
    name,
    group: ctx.g[group],
    layer: ctx.layer,
    plan: { ...plan, r },
    z: z0,
    h: z1 - z0,
    steps: 2,
    bevel: 0.35,
    tone: "mid",
    crease: "lo",
    ...extra,
  });
}

const onTop = (ctx, part, z, svg) =>
  ctx.T.plane({ part, o: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], svg });

// Pieza estática de la capa `back`, con su forma registrada para el audit.
function put(R, item) {
  const shapes = item.shapes.map((shape, index) =>
    R.solid(
      Object.assign(shape, {
        name: shape.name ?? (index ? `${item.name}#${index + 1}` : item.name),
      }),
    ),
  );
  R.put({ ...item, shapes });
}

function pedestal({ R }) {
  const plan = { x: -DISC.r, y: -DISC.r, w: 2 * DISC.r, d: 2 * DISC.r, r: DISC.r };
  const halo = `<path class="iso-halo" d="${k.haloOf(plan, DISC.z0, DISC.z1 - DISC.z0, P)}"/>`;
  const disc = k.solidSvg(k.cylinder(0, 0, DISC.r, DISC.z0, DISC.z1 - DISC.z0, P, 120, 0.6), {
    tone: "lo",
  });
  put(R, {
    name: "stand.disc",
    layer: "back",
    at: [0, 0, DISC.z0],
    svg: halo + disc,
    shapes: [A.cylinder(0, 0, DISC.r, DISC.z0, DISC.z1 - DISC.z0, { ground: true })],
  });
  const h = PEDESTAL.z1 - PEDESTAL.z0;
  const seams = [PEDESTAL.z0 + 3, PEDESTAL.z1 - 2.5]
    .map((z) => k.sideArc(0, 0, PEDESTAL.r, z, P, 96))
    .join("");
  const body = k.solidSvg(k.cylinder(0, 0, PEDESTAL.r, PEDESTAL.z0, h, P, 120, 0.8), {
    tone: "mid",
    crease: "lo",
    inner: k.lineSvg(seams, { tone: "faint" }),
  });
  put(R, {
    name: "stand.pedestal",
    layer: "back",
    at: [0, 0, PEDESTAL.z0],
    svg: body,
    shapes: [A.cylinder(0, 0, PEDESTAL.r, PEDESTAL.z0, h)],
  });
}

// Mesa giratoria: disco con estrías en el canto y graduación cada 5° (mayor cada 30°).
function table(ctx) {
  const part = ctx.T.round({
    name: "mesa.tablero",
    group: ctx.g.mesa,
    layer: ctx.layer,
    F: VERT(0, 0),
    s0: -MESA.h,
    s1: 0,
    r: MESA.r,
    tone: "lo",
    crease: "lo",
    details: {
      // Las estrías terminan sobre dos costuras del canto.
      seams: [-MESA.h + 0.8, -0.8],
      ribs: { s0: -MESA.h + 0.8, s1: -0.8, count: 240, fade: [0.08, 0.5], seams: true, tone: "lo" },
    },
  });
  const rings = [130, 132, 134].map((r) => circlePath(0, 0, r, 240)).join("");
  const minor = [];
  const major = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const big = deg % 30 === 0;
    const from = polar(0, 0, big ? 130 : 132, deg);
    const to = polar(0, 0, 134, deg);
    (big ? major : minor).push(pathOf([from, to]));
  }
  onTop(ctx, part, 0, line(rings) + line(minor.join("")) + line(major.join(""), "mid"));
}

// Placa de etiqueta: ranura interior y tres reglas libres (texto impreso).
function labelPlate(ctx, name, plan) {
  const top = BASE_H + 0.8;
  const screws = [
    [plan.x + 2, plan.y + plan.d / 2],
    [plan.x + plan.w - 2, plan.y + plan.d / 2],
  ];
  const part = box(ctx, name, "mesa", { ...plan, r: 1 }, BASE_H, top, {
    tone: "lo",
    bevel: 0.3,
    details: { dots: screwDots(screws, top, 0.42) },
  });
  const inner = k.insetPlan(plan, 3.6);
  const rows = [0.25, 0.5, 0.75].map((f, i) => {
    const y = inner.y + inner.d * f;
    const length = inner.w * [0.85, 0.6, 0.72][i];
    return pathOf([
      [inner.x + 0.6, y],
      [inner.x + 0.6 + length, y],
    ]);
  });
  const groove = roundRect(k.insetPlan(plan, 1.4), 3);
  onTop(ctx, part, top, line(groove, "faint") + line(rows.join(""), "lo", true));
  return part;
}

// Base en franjas apiladas: zócalo, cuerpo y tapa. Las juntas son la ranura perimetral, y
// cada cara queda baja para que nazca sin salto al ponerse de canto durante el giro.
const BASE_BANDS = [0, 2.7, 5.4, BASE_H];

function bandedBase(ctx, name, plan) {
  const screws = k.corners(plan, 3.5);
  const tones = ["lo", "mid", "mid"];
  let top = null;
  for (let i = 0; i < BASE_BANDS.length - 1; i++) {
    const last = i === BASE_BANDS.length - 2;
    const extra = last
      ? { bevel: 0.8, details: { dots: screwDots(screws, BASE_H) } }
      : { bevel: 0 };
    const part = box(
      ctx,
      last ? name : `${name}.franja${i}`,
      "mesa",
      plan,
      BASE_BANDS[i],
      BASE_BANDS[i + 1],
      {
        steps: 4,
        tone: tones[i],
        ...extra,
      },
    );
    if (last) top = part;
  }
  onTop(ctx, top, BASE_H, screwRings(screws, 1.4));
}

// Base del chatbot: losa con ranura perimetral, tornillos, placa y regla.
function chatbotBase(ctx) {
  bandedBase(ctx, "chatbot.base", CHATBOT);
  labelPlate(ctx, "chatbot.placa", { x: -113, y: 24, w: 24, d: 12 });
  ruler(ctx);
}

// Regla con marcas cada 4 (mayor cada 5) que nacen de su borde.
function ruler(ctx) {
  const plan = { x: -84, y: 32, w: 96, d: 6, r: 0.6 };
  const top = BASE_H + 0.6;
  const part = box(ctx, "chatbot.regla", "mesa", plan, BASE_H, top, {
    tone: "lo",
    crease: "faint",
    bevel: 0,
  });
  const minor = [];
  const major = [];
  for (let i = 0, x = plan.x + 4; x <= plan.x + plan.w - 4; i++, x += 4) {
    const big = i % 5 === 0;
    (big ? major : minor).push(
      pathOf([
        [x, plan.y],
        [x, plan.y + (big ? 3.4 : 1.8)],
      ]),
    );
  }
  // Línea base de borde a borde: las marcas mayores terminan sobre ella.
  const base = pathOf([
    [plan.x, plan.y + 3.4],
    [plan.x + plan.w, plan.y + 3.4],
  ]);
  onTop(ctx, part, top, line(base, "faint") + line(minor.join("")) + line(major.join(""), "mid"));
}

// Rieles de acero con tornillos y topes en los extremos.
function rails(ctx) {
  for (const y of [-13, 9]) {
    // Holgura de 0,3 con cada tope: un contacto vertical a ras se vuelve ambiguo de canto.
    const plan = { x: -112.7, y, w: 125.4, d: 4, r: 0.6 };
    const screws = [];
    for (let x = -106; x < 13; x += 15) screws.push([x, y + 2]);
    box(ctx, `riel.${y < 0 ? "a" : "b"}`, "mesa", plan, RAIL_Z[0], RAIL_Z[1], {
      material: "steel",
      details: { dots: screwDots(screws, RAIL_Z[1], 0.4) },
    });
  }
  for (const [name, x] of [
    ["tope.inicio", -117],
    ["tope.fin", 13],
  ]) {
    const screws = [
      [x + 2, -13],
      [x + 2, 13],
    ];
    box(ctx, name, "mesa", { x, y: -17, w: 4, d: 34, r: 0.8 }, BASE_H, 16, {
      material: "gunmetal",
      bevel: 0.4,
      details: { seams: [12], dots: screwDots(screws, 16, 0.45) },
    });
  }
}

// Carro (conversación) con casquillos, remaches y tirador; encima, la tarjeta.
function carriage(ctx) {
  const rivets = [];
  for (let x = -104; x <= -90; x += 3.5) rivets.push([x, -12.5], [x, 12.5]);
  box(ctx, "carro.cuerpo", "carro", CARRO, CARRO_Z[0], CARRO_Z[1], {
    material: "gunmetal",
    tone: "hi",
    bevel: 0.6,
    details: { seams: [12.6], dots: screwDots(rivets, CARRO_Z[1], 0.4) },
  });
  for (const x of [-110, -85]) {
    for (const y of [-18, 14]) {
      box(ctx, `carro.casquillo.${x}.${y}`, "carro", { x, y, w: 5, d: 4, r: 0.8 }, 16, 18, {
        material: "steel",
        details: { dots: screwDots([[x + 2.5, y + 2]], 18, 0.42) },
      });
    }
  }
  box(ctx, "carro.tirador.cuello", "carro", { x: -99, y: 18.1, w: 8, d: 1.9, r: 0.4 }, 12.5, 14.5, {
    material: "steel",
  });
  box(ctx, "carro.tirador", "carro", { x: -101, y: 20.1, w: 12, d: 1.8, r: 0.6 }, 12, 15, {
    material: "steel",
    details: {
      dots: [-99, -91].map((x) => ({ at: [13.5, x, 21.9], normal: [0, 1, 0], size: 0.4 })),
    },
  });
  box(ctx, "tarjeta", "tarjeta", TARJETA, TARJETA_Z[0], TARJETA_Z[1], {
    tone: "hi",
    lit: true,
    bevel: 0.3,
  });
}

// Compuerta (verificación): placas de pie, postes con tapa y travesaño que sube.
function gate(ctx) {
  for (const [side, y0] of [
    ["a", -29],
    ["b", 24],
  ]) {
    const foot = { x: POST_X - 3, y: y0 - 2, w: 12, d: 9, r: 1 };
    const bolts = [
      [foot.x + 1.6, foot.y + 1.6],
      [foot.x + 10.4, foot.y + 7.4],
    ];
    box(ctx, `compuerta.pie.${side}`, "mesa", foot, BASE_H, BASE_H + 1, {
      material: "steel",
      details: { dots: screwDots(bolts, BASE_H + 1, 0.42) },
    });
    const post = { x: POST_X, y: y0, w: 6, d: 5, r: 0.6 };
    box(ctx, `compuerta.poste.${side}`, "mesa", post, BASE_H + 1, 46, {
      material: "gunmetal",
      details: { seams: [12, 43] },
    });
    const cap = { x: POST_X - 1, y: y0 - 1, w: 8, d: 7, r: 1 };
    box(ctx, `compuerta.tapa.${side}`, "mesa", cap, 46, 48, {
      material: "steel",
      details: { dots: screwDots([[POST_X + 3, y0 + 2.5]], 48, 0.45) },
    });
  }
  // El travesaño guarda 0,1 con cada poste (dentro de la tolerancia de contacto del audit).
  const bar = { x: -62, y: -23.9, w: 4, d: 47.8, r: 0.6 };
  box(ctx, "compuerta.travesano", "compuerta", bar, 20, 24, {
    material: "steel",
    tone: "hi",
    details: {
      seams: [22],
      dots: [-18, -6, 6, 18].map((y) => ({ at: [22, -58, y], normal: [1, 0, 0], size: 0.42 })),
    },
  });
}

// Selector: platina con cinco retenes y perilla de cinco posiciones (máquina de estados).
function selector(ctx) {
  const [cx, cy] = SELECTOR;
  const platina = ctx.T.round({
    name: "selector.platina",
    group: ctx.g.mesa,
    layer: ctx.layer,
    F: VERT(cx, cy),
    s0: BASE_H,
    s1: 11,
    r: PLATINA_R,
    tone: "mid",
    material: "steel",
  });
  const marks = [];
  for (let i = 0; i <= LAST; i++) {
    const deg = POINTER_AT + PERILLA_STEP * i;
    marks.push(pathOf([polar(cx, cy, PERILLA_R, deg), polar(cx, cy, PLATINA_R, deg)]));
  }
  onTop(ctx, platina, 11, line(marks.join(""), "mid"));
  selectorKnob(ctx);
}

// Perilla moleteada y su puntero: giran juntos, 60° por paso.
function selectorKnob(ctx) {
  const [cx, cy] = SELECTOR;
  ctx.T.round({
    name: "selector.perilla",
    group: ctx.g.perilla,
    layer: ctx.layer,
    F: VERT(cx, cy),
    s0: 11,
    s1: 15,
    r: PERILLA_R,
    tone: "hi",
    material: "gunmetal",
    details: {
      seams: [11.5, 14.5],
      ribs: { s0: 11.5, s1: 14.5, count: 36, seams: true, tone: "lo" },
    },
  });
  const a = (POINTER_AT * Math.PI) / 180;
  ctx.T.prism({
    name: "selector.puntero",
    group: ctx.g.perilla,
    layer: ctx.layer,
    F: {
      o: [cx, cy, 0],
      a: [0, 0, 1],
      u: [Math.cos(a), Math.sin(a), 0],
      v: [-Math.sin(a), Math.cos(a), 0],
    },
    polygon: [
      [-1.4, -0.9],
      [2.4, -0.6],
      [3.5, 0],
      [2.4, 0.6],
      [-1.4, 0.9],
    ],
    s0: 15,
    s1: 16.2,
    tone: "hi",
    bevel: 0.2,
    material: "steel",
  });
}

// Puente FHIR: la única conexión entre chatbot y Hermes, con su única etiqueta grabada.
function bridge(ctx) {
  box(ctx, "puente.soporte.a", "mesa", { x: 17.1, y: -10, w: 5.9, d: 20, r: 0.6 }, BASE_H, 12, {
    material: "steel",
  });
  box(ctx, "puente.soporte.b", "mesa", { x: 35, y: -10, w: 7.9, d: 20, r: 0.6 }, BASE_H, 12, {
    material: "steel",
  });
  const bolts = [
    [19, -8],
    [19, 8],
    [41, -8],
    [41, 8],
  ];
  const part = box(ctx, "puente", "mesa", PUENTE, 12, 16, {
    material: "copper",
    tone: "hi",
    bevel: 0.5,
    details: { seams: [14], dots: screwDots(bolts, 16, 0.45) },
  });
  // El texto corre a lo largo de x y se lee de frente desde el lado +y (el de la cámara).
  const label = `<text class="iso-face-text" data-tone="mid" font-size="6.4" text-anchor="middle" transform="translate(0 2.3)">FHIR</text>`;
  ctx.T.plane({ part, o: [30, 0, 16], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], svg: label });
}

// Base de Hermes: losa con ranura perimetral, tornillos y placa.
function hermesBase(ctx) {
  bandedBase(ctx, "hermes.base", HERMES);
  labelPlate(ctx, "hermes.placa", { x: 39, y: 26, w: 22, d: 11 });
}

// Bandeja de entrada de Hermes con dos labios y la columna del sello.
function tray(ctx) {
  box(ctx, "hermes.bandeja", "mesa", BANDEJA, BASE_H, 16, {
    material: "brass",
    tone: "hi",
    bevel: 0.5,
    details: { seams: [11], dots: screwDots(k.corners(BANDEJA, 2.4), 16, 0.45) },
  });
  for (const [side, y] of [
    ["a", -14],
    ["b", 11],
  ]) {
    box(ctx, `hermes.labio.${side}`, "mesa", { x: 43, y, w: 28, d: 3, r: 0.6 }, 16, 18, {
      material: "brass",
    });
  }
  const plate = { x: 48, y: -41, w: 18, d: 15, r: 1.2 };
  box(ctx, "hermes.columna.placa", "mesa", plate, BASE_H, 10, {
    material: "brass",
    details: { dots: screwDots(k.corners(plate, 1.8), 10, 0.45) },
  });
  // La columna va en dos tramos con brida: cada cara es la mitad de alta.
  const joint = (COLUMNA_Z[0] + COLUMNA_Z[1]) / 2;
  box(ctx, "hermes.columna", "mesa", COLUMNA, COLUMNA_Z[0], joint, {
    material: "brass",
    tone: "hi",
    details: { seams: [14] },
  });
  box(ctx, "hermes.columna.alta", "mesa", COLUMNA, joint, COLUMNA_Z[1], {
    material: "brass",
    tone: "hi",
    details: { seams: [68] },
  });
  box(ctx, "hermes.columna.tapa", "mesa", { x: 50, y: -39, w: 14, d: 12, r: 1.4 }, 72, 74, {
    material: "brass",
    details: { dots: screwDots([[57, -33]], 74, 0.5) },
  });
}

// Sello de Hermes: corredera en la columna, brazo, cabeza y almohadilla.
function stamp(ctx) {
  box(ctx, "sello.corredera", "sello", { x: 52, y: -28, w: 10, d: 4, r: 0.6 }, 52, 64, {
    material: "brass",
    details: {
      dots: [54.5, 59.5].map((x) => ({ at: [62, x, -24], normal: [0, 1, 0], size: 0.42 })),
    },
  });
  box(ctx, "sello.brazo", "sello", { x: 53, y: -23.9, w: 8, d: 27.9, r: 0.6 }, 58, 62, {
    material: "brass",
    tone: "hi",
    details: { dots: screwDots([[57, -1]], 62, 0.45) },
  });
  box(ctx, "sello.cabeza", "sello", { x: 52, y: -10, w: 10, d: 20, r: 1 }, 48, 58, {
    material: "brass",
    tone: "hi",
    bevel: 0.5,
    details: { seams: [51] },
  });
  box(ctx, "sello.almohadilla", "sello", { x: 53, y: -9, w: 8, d: 18, r: 0.8 }, 46, 48, {
    material: "rubber",
  });
}

// Tablero de agenda: reglas de borde a borde y fichas libre / apartado / confirmado.
// El tablero es una rejilla de tablillas: seis columnas (una por ficha) en dos tramos. La
// junta horizontal marca el paso de «apartado» a «confirmado» (z 32) y una regla en z 20
// el de «libre» a «apartado». Tablillas angostas y bajas: sus caras nacen sin salto al girar.
const SLAT_GAP = 0.2;
const SLAT_JOINT = 32;
const SLAT_RULE = 20;

function boardSlats(ctx) {
  const width = TABLERO.d / FICHAS.length;
  const face = TABLERO.x + TABLERO.w;
  for (let i = 0; i < FICHAS.length; i++) {
    const y0 = TABLERO.y + i * width + SLAT_GAP / 2;
    const plan = { ...TABLERO, y: y0, d: width - SLAT_GAP };
    const lower = box(ctx, `agenda.tablilla.${i}`, "mesa", plan, TABLERO_Z[0], SLAT_JOINT, {
      material: "brass",
      tone: "hi",
    });
    box(ctx, `agenda.tablilla.${i}.alta`, "mesa", plan, SLAT_JOINT, TABLERO_Z[1], {
      material: "brass",
      tone: "hi",
    });
    const rule = pathOf([
      [y0, SLAT_RULE],
      [y0 + plan.d, SLAT_RULE],
    ]);
    ctx.T.plane({
      part: lower,
      o: [face, 0, 0],
      u: [0, 1, 0],
      v: [0, 0, 1],
      normal: [1, 0, 0],
      svg: line(rule),
    });
  }
}

function board(ctx) {
  boardSlats(ctx);
  boardTrim(ctx);
  boardTokens(ctx);
}

// Tapa superior y repisa inferior del tablero, atornilladas.
function boardTrim(ctx) {
  box(ctx, "agenda.tapa", "mesa", { x: 92.4, y: -34, w: 5.2, d: 68, r: 0.8 }, 52, 53.6, {
    material: "brass",
    details: {
      dots: screwDots(
        [
          [95, -30],
          [95, 30],
        ],
        53.6,
        0.45,
      ),
    },
  });
  box(ctx, "agenda.repisa", "mesa", REPISA, BASE_H, REPISA_TOP, {
    material: "brass",
    details: {
      dots: screwDots(
        [
          [98.5, -30],
          [98.5, 30],
        ],
        REPISA_TOP,
        0.42,
      ),
    },
  });
}

// Fichas de la agenda: libre (sobre la repisa), apartado (+12) o confirmado (+24).
function boardTokens(ctx) {
  const face = TABLERO.x + TABLERO.w;
  FICHAS.forEach((lift, i) => {
    const c = -27.5 + 11 * i;
    const z = REPISA_TOP + (lift ?? 0);
    const group = lift === null ? "ficha" : "mesa";
    const plan = { x: face + 0.1, y: c - 4, w: 2.5, d: 8, r: 0.4 };
    box(ctx, `agenda.ficha.${i}`, group, plan, z, z + FICHA_H, {
      material: "gunmetal",
      tone: "hi",
      bevel: 0.25,
    });
  });
}

// ——— Construcción y audit ———

const backSvg = (R) => {
  const items = R.items
    .filter((item) => item.layer === "back")
    .sort((a, b) => a.key - b.key)
    .map((item) => item.svg);
  const label =
    "Una máquina sobre una mesa giratoria: a la izquierda el chatbot, con un carro sobre rieles que lleva una tarjeta, una compuerta, una perilla de cinco posiciones y un puente FHIR; a la derecha Hermes, con una bandeja, un sello en una columna y un tablero de agenda con fichas.";
  return k.figureSvg({ width: W, height: H, label, body: items });
};

const frontSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>`;

export async function buildFigure({ verify = false } = {}) {
  const { R, T } = makeScene();
  const out = T.build({ statics: R.items, poses, verify });
  A.settle(R, P);
  const aria =
    "Anatomía del chatbot: arrastra para girar la mesa y usa las flechas para avanzar por los pasos";
  const stageHtml = `<div class="iso-stage iso-turn an-stage" tabindex="0" role="slider" aria-label="${aria}" aria-valuemin="0" aria-valuemax="${LAST}" aria-valuenow="0" aria-valuetext="${STEPS[0].readout}">${backSvg(R)}${out.layerSvg("maquina", { width: W, height: H })}${frontSvg()}</div>`;
  const result = { stageHtml, css: out.css, data: { turn: out.data, W, H }, report: out.report };
  if (verify) result.verify = out.verify;
  return result;
}

export async function auditFigure({ quick = false, only = null } = {}) {
  const { R, T } = makeScene();
  T.build({ statics: R.items, poses });
  A.settle(R, P);
  const argv = ["--audit"];
  const kit = A.auditOrExit(R, P, { argv });
  const orbit = TA.orbitOrExit(T, R, P, {
    argv,
    sweep: { at: (x) => follow({ mesa: x, t: 0 }), from: 0, to: 360, frame: 0.3 },
    clips: [
      {
        name: "tour",
        at: (s) => follow({ mesa: 30 + 4 * s, t: s }),
        from: 0,
        to: LAST,
        frame: 1 / 60,
      },
    ],
    poses: [30, 120, 210, 300].map((mesa) => follow({ mesa, t: LAST })),
    quick,
    only,
  });
  const problems = A.failures(kit) + TA.orbitFailures(orbit);
  return { kit, orbit, passed: problems === 0 };
}

// ——— Preview de prueba (HTML mínimo, fuera del repo) ———

const PREVIEW_LOOP = `
if (matchMedia("(prefers-color-scheme: light)").matches) document.body.setAttribute("data-theme", "light");
const stage = document.querySelector(".an-stage");
let held = false;
const controller = TURN.mount(stage, DATA.turn, { follow, onHold: () => (held = true) });
const readout = document.querySelector("[data-readout]");
const query = new URLSearchParams(location.search);
const start = performance.now();
function tick(now) {
  if (held) return;
  const s = (now - start) / 1000;
  const fixed = Math.min(LAST, Math.max(0, Number(query.get("t")) || 0));
  const t = query.has("t") ? fixed : Math.min(LAST, (s * 0.6) % (LAST + 1.5));
  const mesa = query.has("mesa") ? Number(query.get("mesa")) : 30 + 6 * s;
  controller.set({ mesa, t });
  if (readout) readout.textContent = STEPS[Math.round(t)].readout + " · " + (mesa % 360).toFixed(0) + "°";
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
`;

async function writePreview(target) {
  const { turnScript } = await import(kitUrl("scripts/inline-kit.mjs"));
  const fig = await buildFigure();
  const model = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
  const body = k.plateHtml({
    fig: "Fig 1",
    title: "Anatomía del chatbot",
    hint: "Arrastra para girar · ← → pasos",
    readout: STEPS[0].readout,
    body: `<style>${fig.css}</style>${fig.stageHtml}`,
  });
  const script = `${turnScript()}\n${model}\nconst DATA = ${JSON.stringify(fig.data)};\n${PREVIEW_LOOP}`;
  const page = k.pageHtml({ title: "Anatomía (preview)", theme: "dark", body, script, width: 680 });
  writeFileSync(target, page);
  const r = fig.report;
  process.stdout.write(
    `wrote ${target} · ${(page.length / 1024).toFixed(0)} KB · ${r.parts} parts · build ${r.seconds.toFixed(1)} s\n`,
  );
}

async function main(argv) {
  const preview = argv.indexOf("--preview");
  if (preview >= 0) {
    const target = argv[preview + 1];
    if (!target) throw new Error("--preview necesita una ruta de salida");
    await writePreview(resolve(target));
    return;
  }
  if (argv.includes("--audit")) {
    const only =
      argv
        .find((a) => a.startsWith("--only="))
        ?.slice(7)
        .split(",") ?? null;
    await auditFigure({ quick: argv.includes("--quick"), only });
    return;
  }
  const { report } = await buildFigure();
  process.stdout.write(`${report.parts} parts · build ${report.seconds.toFixed(1)} s\n`);
}

// En Windows la letra de unidad puede variar en mayúsculas: se compara sin distinguirlas.
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
