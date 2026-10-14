// Runtime de la figura «anatomía del chatbot».
// Se inlina en un <script type="module"> después de turnScript(), model.mjs (sin export)
// y `const DATA = …;`, así que TURN, STEPS, LAST, follow y DATA ya existen aquí.
// La figura lleva su propio bucle: el controlador del kit nunca corre su rAF.

const anStage = document.querySelector(".an-stage");
const anReadout = document.querySelector("[data-readout]");
const anTitle = document.querySelector("[data-step-title]");
const anText = document.querySelector("[data-step-text]");
const anButtons = [...document.querySelectorAll("ol.an-steps button[data-step]")];
const anThemeButton = document.querySelector("button[data-theme-toggle]");
const anStill = matchMedia("(prefers-reduced-motion: reduce)");

// Ritmos del movimiento.
const T_RATE = 0.9; // pasos por segundo hacia delante (×2 hacia atrás)
const MESA_TAU = 0.12; // segundos de la persecución exponencial de la mesa
const TOUR_WAIT = 1.8; // segundos de espera en cada paso del tour
const TOUR_SPIN = 6; // grados por segundo de la mesa durante el tour
const RESUME_MS = 3600; // el tour vuelve tras esta pausa sin interacción
const KEY_TURN = 15; // grados por pulsación de ↑/↓

// Estado de la figura: valores vistos y objetivos.
const anState = {
  t: 0,
  tTarget: 0,
  mesa: 0,
  mesaTarget: 0,
  touring: !anStill.matches,
  tourWait: 0,
  idle: 0,
  frame: 0,
  last: 0,
  visible: false,
  drawn: null,
  own: false,
  setMs: 0,
  halfRate: false,
  parity: false,
  shownStep: -1,
  ariaText: "",
};

const clampStep = (value) => Math.min(LAST, Math.max(0, value));
const degreesOf = (value) => ((Math.round(value) % 360) + 360) % 360;

// Lectura: esquina de la tarjeta, panel del paso, botones y atributos ARIA.
const showReadout = () => {
  const text = `${STEPS[Math.round(anState.t)].readout} · ${degreesOf(anState.mesa)}°`;
  if (anReadout && anReadout.textContent !== text) anReadout.textContent = text;
};

// ARIA del slider: paso objetivo y ángulo visible; se escribe solo si cambia.
const describeAria = () => {
  const index = clampStep(Math.round(anState.tTarget));
  const text = `Paso ${index + 1} de ${LAST + 1}: ${STEPS[index].title}. Mesa a ${degreesOf(anState.mesa)}°`;
  if (text === anState.ariaText) return;
  anState.ariaText = text;
  anStage.setAttribute("aria-valuenow", String(index));
  anStage.setAttribute("aria-valuetext", text);
};

const describe = () => {
  describeAria();
  const index = clampStep(Math.round(anState.tTarget));
  const step = STEPS[index];
  if (index === anState.shownStep) return;
  anState.shownStep = index;
  if (anTitle) anTitle.textContent = step.title;
  if (anText) anText.textContent = step.detail;
  for (const button of anButtons) {
    const pressed = Number(button.dataset.step) === index;
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
  }
};

// Montaje del motor 3D. Si una herramienta mueve la figura por window.__isoTurn,
// sus valores se adoptan como vistos y como objetivo, y el tour queda parado
// hasta que el lector vuelva a actuar (convención del kit para tomar el control).
const controller = TURN.mount(anStage, DATA.turn, {
  follow,
  onHold: () => stopTour(),
  onFrame: (turned) => {
    if (!anState.own) adoptValues(turned.values);
    showReadout();
  },
});

function adoptValues(values) {
  // Un re-render del propio kit (p. ej. al redimensionar) repite lo último pintado:
  // no hay nada que adoptar y no debe cortar una transición en curso.
  const drawn = anState.drawn;
  if (drawn && values.mesa === drawn.mesa && (values.t ?? drawn.t) === drawn.t) return;
  anState.mesa = anState.mesaTarget = values.mesa ?? anState.mesa;
  anState.t = anState.tTarget = clampStep(values.t ?? anState.t);
  anState.drawn = { mesa: anState.mesa, t: anState.t };
  describe();
}

const draw = () => {
  const start = performance.now();
  anState.own = true;
  controller.set({ mesa: anState.mesa, t: anState.t });
  anState.own = false;
  anState.drawn = { mesa: anState.mesa, t: anState.t };
  // Medio ritmo adaptativo: media móvil del coste de `set`.
  anState.setMs = anState.setMs * 0.9 + (performance.now() - start) * 0.1;
  if (anState.setMs > 14) anState.halfRate = true;
  else if (anState.setMs < 9) anState.halfRate = false;
  describeAria();
};

// Tour: recorre los pasos 0→4 con una espera en cada uno, vuelve a 0 y repite.
const advanceTour = (dt) => {
  anState.mesaTarget += TOUR_SPIN * dt;
  if (anState.t !== anState.tTarget) return;
  anState.tourWait += dt;
  if (anState.tourWait < TOUR_WAIT) return;
  anState.tourWait = 0;
  const current = clampStep(Math.round(anState.tTarget));
  anState.tTarget = current >= LAST ? 0 : current + 1;
  describe();
};

// t avanza a velocidad constante hacia su objetivo (el doble de rápido hacia atrás).
const advanceT = (dt, calm) => {
  const gap = anState.tTarget - anState.t;
  if (calm || gap === 0) {
    anState.t = anState.tTarget;
    return;
  }
  const stride = (gap > 0 ? T_RATE : 2 * T_RATE) * dt;
  anState.t = Math.abs(gap) <= stride ? anState.tTarget : anState.t + Math.sign(gap) * stride;
};

// La mesa persigue su objetivo con un seguimiento exponencial.
const advanceMesa = (dt, calm) => {
  const gap = anState.mesaTarget - anState.mesa;
  anState.mesa = calm ? anState.mesaTarget : anState.mesa + gap * (1 - Math.exp(-dt / MESA_TAU));
  if (Math.abs(anState.mesaTarget - anState.mesa) < 1e-3) anState.mesa = anState.mesaTarget;
};

const changed = () =>
  anState.drawn === null ||
  Math.abs(anState.drawn.mesa - anState.mesa) > 1e-4 ||
  Math.abs(anState.drawn.t - anState.t) > 1e-6;

const isSettled = () =>
  !anState.touring && anState.t === anState.tTarget && anState.mesa === anState.mesaTarget;

const stopTour = () => {
  anState.touring = false;
  clearTimeout(anState.idle);
};

function tick(now) {
  const dt = anState.last ? Math.min((now - anState.last) / 1000, 1 / 30) : 1 / 60;
  anState.last = now;
  const calm = anStill.matches;
  if (calm && anState.touring) stopTour();
  if (anState.touring) advanceTour(dt);
  advanceT(dt, calm);
  advanceMesa(dt, calm);
  const settled = isSettled();
  if (changed()) {
    anState.parity = !anState.parity;
    if (!anState.halfRate || anState.parity || settled) draw();
  }
  anState.frame = anState.visible && !settled ? requestAnimationFrame(tick) : 0;
}

const run = () => {
  if (anState.frame || !anState.visible) return;
  anState.last = 0;
  anState.frame = requestAnimationFrame(tick);
};

// Cualquier interacción pausa el tour; vuelve solo tras RESUME_MS sin tocar nada.
const resumeTour = () => {
  if (anStill.matches) return;
  anState.touring = true;
  anState.tourWait = 0;
  anState.tTarget = clampStep(Math.round(anState.t));
  run();
};

const hold = () => {
  stopTour();
  anState.idle = setTimeout(resumeTour, RESUME_MS);
};

const goToStep = (index) => {
  anState.tTarget = clampStep(index);
  describe();
  run();
};

const turnTo = (degrees) => {
  anState.mesaTarget = degrees;
  describe();
  run();
};

new IntersectionObserver(
  (entries) => {
    anState.visible = entries[entries.length - 1].isIntersecting;
    if (anState.visible) run();
    else if (anState.frame) {
      cancelAnimationFrame(anState.frame);
      anState.frame = 0;
    }
  },
  { rootMargin: "120px 0px" },
).observe(anStage);

// Arrastre: el ángulo del puntero sobre el plano del tablero gira la mesa.
let anDrag = null;
const DRAG_Z = 8;

anStage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  hold();
  anDrag = {
    from: controller.angleAt(event.clientX, event.clientY, DRAG_Z, "mesa"),
    base: anState.mesa,
    id: event.pointerId,
    captured: false,
  };
});

anStage.addEventListener("pointermove", (event) => {
  if (!anDrag || event.pointerId !== anDrag.id) return;
  hold();
  const delta = controller.angleAt(event.clientX, event.clientY, DRAG_Z, "mesa") - anDrag.from;
  if (!anDrag.captured && Math.abs(delta) > 1.5) {
    anDrag.captured = true;
    anStage.setPointerCapture(event.pointerId);
    anStage.setAttribute("data-drag", "");
  }
  if (!anDrag.captured) return;
  anState.mesaTarget = anDrag.base + delta;
  describe();
  run();
});

const release = (event) => {
  if (!anDrag || event.pointerId !== anDrag.id) return;
  anDrag = null;
  anStage.removeAttribute("data-drag");
  try {
    anStage.releasePointerCapture(event.pointerId);
  } catch {
    // El puntero ya no estaba capturado.
  }
};
anStage.addEventListener("pointerup", release);
anStage.addEventListener("pointercancel", release);

// Teclado: ←/→ paso, ↑/↓ giro, Inicio/Fin primer y último paso.
// Durante el tour se parte del paso que se ve, no del objetivo del tour.
const KEY_ACTIONS = {
  ArrowRight: (seen) => goToStep(seen.step + 1),
  ArrowLeft: (seen) => goToStep(seen.step - 1),
  ArrowUp: (seen) => turnTo(seen.mesa + KEY_TURN),
  ArrowDown: (seen) => turnTo(seen.mesa - KEY_TURN),
  Home: () => goToStep(0),
  End: () => goToStep(LAST),
};

anStage.addEventListener("keydown", (event) => {
  const action = KEY_ACTIONS[event.key];
  if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const touring = anState.touring;
  const seen = {
    step: Math.round(touring ? anState.t : anState.tTarget),
    mesa: touring ? anState.mesa : anState.mesaTarget,
  };
  hold();
  action(seen);
});

for (const button of anButtons) {
  button.addEventListener("click", () => {
    hold();
    goToStep(Number(button.dataset.step));
  });
}

anStill.addEventListener("change", () => {
  // Al desactivarse el movimiento reducido, el tour vuelve tras la pausa habitual.
  if (anStill.matches) stopTour();
  else hold();
  run();
});

// Tema: el inicial sigue a prefers-color-scheme; el botón alterna oscuro y claro.
const applyTheme = (theme) => {
  document.body.setAttribute("data-theme", theme);
  if (anThemeButton)
    anThemeButton.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
};

if (matchMedia("(prefers-color-scheme: light)").matches) applyTheme("light");
else applyTheme(document.body.getAttribute("data-theme") ?? "dark");

if (anThemeButton) {
  if (!anThemeButton.textContent.trim()) anThemeButton.textContent = "Tema claro";
  anThemeButton.addEventListener("click", () => {
    applyTheme(document.body.getAttribute("data-theme") === "light" ? "dark" : "light");
  });
}

draw();
describe();
showReadout();
