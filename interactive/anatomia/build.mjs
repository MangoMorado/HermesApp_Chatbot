// Arma interactive/anatomia.html: figura 3D (figure.mjs), runtime (live.js) y la página en español.
// Uso: node interactive/anatomia/build.mjs [--verify] · --audit [--quick] [--only=a,b]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kitUrl } from "./kit-path.mjs";
import { CHATBOT, HERMES, MESA, STEPS } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "anatomia.html");
const argv = process.argv.slice(2);

const k = await import(kitUrl("kit/iso-kit.mjs"));
const { turnScript } = await import(kitUrl("scripts/inline-kit.mjs"));

// figure.mjs (U1) puede no existir todavía; si existe, cualquier error suyo debe romper el build.
async function loadFigure() {
  if (!existsSync(join(HERE, "figure.mjs"))) return null;
  return import("./figure.mjs");
}

const readOptional = (name) => {
  const path = join(HERE, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const W = 640;
const H = 460;
const STAGE_ATTRS = `tabindex="0" role="slider" aria-label="Máquina del chatbot sobre una mesa giratoria: arrastra para girarla, flechas izquierda y derecha para cambiar de paso" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0" aria-valuetext="paso 1 de 5: ${STEPS[0].title}"`;

// Figura provisional: mesa, pedestal y las dos bases, estática, mientras llega figure.mjs.
function placeholderFigure() {
  const P = k.fitProjection(
    [...k.boxCorners({ x: -MESA.r, y: -MESA.r, w: 2 * MESA.r, d: 2 * MESA.r }, -23, 0), [0, 0, 74]],
    W,
    H,
    { pad: 28, azimuth: 40, elevation: 31 },
  );
  const S = (paths, style) => k.solidSvg(paths, style);
  const seam = (plan, z) => k.lineSvg(k.sideSeam(plan, z, P, 8), { tone: "faint" });
  const base = (plan) => S(k.slabOf(plan, 0, 8, P, 8, 1), { tone: "mid", inner: seam(plan, 3) });
  const bases = [CHATBOT, HERMES]
    .map((plan) => ({ plan, depth: k.depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, 0], P) }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ plan }) => base(plan));
  const body = [
    `<path class="iso-halo" d="${k.cylinder(0, 0, 112, -23, 3, P, 96).fill}"/>`,
    S(k.cylinder(0, 0, 112, -23, 3, P, 96), { tone: "lo" }),
    S(k.cylinder(0, 0, 104, -20, 13, P, 96), { tone: "lo" }),
    S(k.cylinder(0, 0, MESA.r, -MESA.h, MESA.h, P, 128, 1), { tone: "mid", crease: "lo" }),
    ...bases,
  ];
  const svg = k.figureSvg({
    width: W,
    height: H,
    label:
      "Mesa giratoria con la base del chatbot y la base de Hermes; la figura 3D completa está pendiente.",
    body,
  });
  const stageHtml = `<div class="iso-stage an-stage" ${STAGE_ATTRS}>${svg}<p class="an-pending">figura 3D pendiente</p></div>`;
  return { stageHtml, css: "", data: null };
}

// Respaldo del navegador cuando no hay live.js: pasos, lectura y tema. Se inlina con toString().
function fallbackLive() {
  const body = document.body;
  const readout = document.querySelector("[data-readout]");
  const title = document.querySelector("[data-step-title]");
  const text = document.querySelector("[data-step-text]");
  const buttons = [...document.querySelectorAll("button[data-step]")];
  const show = (index) => {
    const step = STEPS[index];
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.step) === index));
    }
    if (readout) readout.textContent = step.readout;
    if (title) title.textContent = step.title;
    if (text) text.textContent = step.detail;
  };
  for (const button of buttons) {
    button.addEventListener("click", () => show(Number(button.dataset.step)));
  }
  if (window.matchMedia("(prefers-color-scheme: light)").matches) body.dataset.theme = "light";
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    body.dataset.theme = body.dataset.theme === "light" ? "dark" : "light";
  });
}

function pageScript(figure, live) {
  const model = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
  if (!figure.data || !live) return `${model}\n(${fallbackLive.toString()})();\n`;
  return `${turnScript()}\n${model}\nconst DATA = ${JSON.stringify(figure.data)};\n${live}`;
}

const stepButtons = () =>
  STEPS.map(
    (step, index) =>
      `<li><button type="button" class="an-step" data-step="${index}" aria-pressed="${index === 0}"><span class="an-step-n">${index + 1}</span><span class="an-step-t">${step.title}</span></button></li>`,
  ).join("");

const PIEZAS = [
  [
    "La tarjeta",
    "Es la solicitud del paciente. Es la única pieza iluminada: síguela con la vista.",
  ],
  ["El carro sobre rieles", "Es la conversación. Avanza paso a paso y nunca se sale del camino."],
  [
    "La perilla de cinco posiciones",
    "Es la máquina de estados. Cada posición es un paso fijo: mismo paso y mismos datos, misma respuesta.",
  ],
  ["La compuerta", "Es la verificación. Solo se abre si el paciente demuestra quién es."],
  ["El puente FHIR", "Es la única conexión entre el chatbot y Hermes. No hay otra puerta."],
  [
    "La bandeja y el sello",
    "Son Hermes, la fuente de verdad. Lo que Hermes sella, queda en firme.",
  ],
  ["El tablero", "Es la agenda. Cada ficha marca un cupo libre, apartado o confirmado."],
  ["La mesa giratoria", "Sirve para mirar la máquina desde cualquier lado. Arrástrala."],
];

const NUNCA = [
  [
    "No usa inteligencia artificial.",
    "Nada de LLM, embeddings, RAG ni n8n. Cada frase sale de la configuración de la clínica, de su base de conocimiento o de la agenda.",
  ],
  ["No confirma citas.", "Solo deja solicitudes. Confirmar, mover o cancelar es cosa de Hermes."],
  [
    "No adivina de quién es la cuenta.",
    "La clínica (el tenant) sale solo del token JWT, nunca de lo que escribe el usuario.",
  ],
  [
    "No guarda lo que no debe.",
    "Ni las respuestas de verificación ni datos clínicos quedan en mensajes, registros o auditoría.",
  ],
];

const FASES = [
  ["hecho", "Fases 1 a 3", "Cerradas: base del proyecto, agenda y el chat completo."],
  [
    "hecho",
    "Fase 4.1, 4.2 y 4.3",
    "En main: lectura FHIR, escritura de maestros y pre-agenda por FHIR.",
  ],
  ["siguiente", "Fase 4.4", "Lo que sigue: el simulador de Hermes hablando por FHIR."],
];

const defs = (rows) =>
  rows.map(([term, text]) => `<div><dt>${term}</dt><dd>${text}</dd></div>`).join("");
const items = (rows) =>
  rows.map(([lead, text]) => `<li><strong>${lead}</strong> ${text}</li>`).join("");
const phases = (rows) =>
  rows
    .map(
      ([state, name, text]) =>
        `<li data-state="${state}"><span class="an-phase-state">${state === "hecho" ? "Hecho" : "Siguiente"}</span><strong>${name}</strong><span>${text}</span></li>`,
    )
    .join("");

function plate(figure) {
  return k.plateHtml({
    fig: "Fig 1",
    title: "Anatomía del chatbot",
    hint: "Arrastra para girar · ← → pasos",
    readout: STEPS[0].readout,
    keys: [
      { mark: "lit", label: "La tarjeta: la solicitud que viaja" },
      { mark: "raised", label: "Todo lo que gira con la mesa" },
    ],
    caption:
      "A la izquierda, el chatbot; a la derecha, Hermes. Solo los une el puente FHIR, y el sello solo lo pone Hermes.",
    body: figure.stageHtml,
  });
}

function mainHtml(figure) {
  return `<main id="contenido" class="an-main">
<section class="an-intro">
<p class="an-eyebrow">Ingenius 360 · anatomía</p>
<h1>El proyecto, en una máquina</h1>
<p class="an-lead">Un chatbot que ayuda a pedir citas médicas, contado como una máquina de verdad. Cada pieza es una parte del sistema. Gira la mesa, recorre los cinco pasos y mira cómo viaja una solicitud desde el chat hasta Hermes.</p>
</section>
${plate(figure)}
<section class="an-walk" aria-labelledby="an-pasos">
<h2 id="an-pasos">Los cinco pasos</h2>
<ol class="an-steps">${stepButtons()}</ol>
<div class="an-step-panel" aria-live="polite">
<h3 data-step-title>${STEPS[0].title}</h3>
<p data-step-text>${STEPS[0].detail}</p>
</div>
</section>
<section class="an-block" aria-labelledby="an-piezas">
<h2 id="an-piezas">Las piezas</h2>
<dl class="an-defs">${defs(PIEZAS)}</dl>
</section>
<section class="an-block" aria-labelledby="an-nunca">
<h2 id="an-nunca">Lo que nunca hace</h2>
<ul class="an-never">${items(NUNCA)}</ul>
</section>
<section class="an-block" aria-labelledby="an-va">
<h2 id="an-va">Cómo va</h2>
<ol class="an-phases">${phases(FASES)}</ol>
</section>
</main>`;
}

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#140c33">
<title>Anatomía del chatbot · Ingenius 360</title>
<meta name="description" content="El chatbot de agenda clínica explicado como una máquina 3D: la solicitud, la verificación, el puente FHIR y Hermes, que es quien confirma.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400..700&amp;family=Martian+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">`;

const HEADER = `<a class="an-skip" href="#contenido">Saltar al contenido</a>
<header class="an-bar">
<a class="an-brand" href="index.html"><img src="logotipo-claro.png" alt="Ingenius 360" width="115" height="28"></a>
<nav class="an-nav" aria-label="Navegación">
<a href="index.html">Ver el relato técnico</a>
<button type="button" class="an-theme" data-theme-toggle aria-label="Cambiar entre tema claro y oscuro">Tema</button>
</nav>
</header>`;

const FOOTER = `<footer class="an-foot">
<p>Esta vista es la versión sencilla. Si quieres el detalle de arquitectura, contratos y pruebas, lee el <a href="index.html">relato técnico completo</a>.</p>
</footer>`;

function pageHtml(figure, live) {
  const css = [k.ISO_CSS, figure.css, readFileSync(join(HERE, "anatomia.css"), "utf8")].join("\n");
  const script = pageScript(figure, live).replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html>
<html lang="es">
<head>
${HEAD}
<style>${css}</style>
</head>
<body class="iso an-page" data-theme="dark">
${HEADER}
${mainHtml(figure)}
${FOOTER}
<script type="module">${script}</script>
</body>
</html>
`;
}

async function audit(mod) {
  if (!mod?.auditFigure) {
    console.error("audit: falta figure.mjs (auditFigure); no hay nada que auditar todavía.");
    process.exitCode = 1;
    return;
  }
  const only =
    argv
      .find((arg) => arg.startsWith("--only="))
      ?.slice(7)
      .split(",") ?? null;
  await mod.auditFigure({ quick: argv.includes("--quick"), only });
}

async function main() {
  const mod = await loadFigure();
  if (argv.includes("--audit")) return audit(mod);
  const figure = mod
    ? await mod.buildFigure({ verify: argv.includes("--verify") })
    : placeholderFigure();
  const live = readOptional("live.js");
  const page = pageHtml(figure, live);
  writeFileSync(OUT, page);
  const parts = [
    `wrote interactive/anatomia.html · ${(page.length / 1024).toFixed(0)} KB`,
    mod ? "figura 3D" : "figura provisional",
    live && figure.data ? "live.js" : "respaldo sin live.js",
  ];
  process.stdout.write(`${parts.join(" · ")}\n`);
}

await main();
