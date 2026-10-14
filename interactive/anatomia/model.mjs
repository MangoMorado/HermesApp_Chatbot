// Modelo puro de la figura: un parámetro t (0…4) mueve todas las piezas.
// Lo comparten la geometría (figure.mjs), el runtime (live.js, inlinado) y la página.

export const STEPS = [
  {
    title: "Menú",
    readout: "paso 1/5 · menú",
    detail:
      "El paciente abre el chat y elige qué quiere hacer. La solicitud todavía es un borrador sobre el carro.",
  },
  {
    title: "Verificación",
    readout: "paso 2/5 · verificación",
    detail:
      "Antes de seguir, el bot verifica quién es con preguntas de su propio banco. Si acierta, la compuerta se abre. La respuesta no se guarda en ninguna parte.",
  },
  {
    title: "Recorrido",
    readout: "paso 3/5 · recorrido",
    detail:
      "La conversación avanza paso a paso por los rieles: mismo paso y mismos datos, misma respuesta. La compuerta se cierra detrás.",
  },
  {
    title: "Solicitud a Hermes",
    readout: "paso 4/5 · cupo apartado",
    detail:
      "La solicitud cruza el puente FHIR, la única conexión entre las dos piezas. El cupo queda apartado (busy_tentative), no confirmado.",
  },
  {
    title: "Hermes confirma",
    readout: "paso 5/5 · cita confirmada",
    detail:
      "Solo Hermes pone el sello. La cita en firme la confirma, reprograma o cancela Hermes; el chatbot nunca.",
  },
];
export const LAST = STEPS.length - 1;

// Geometría compartida (unidades del mundo, z hacia arriba, z = 0 es el tablero de la mesa).
export const MESA = { pivot: [0, 0], r: 136, h: 7 };
export const BASE_H = 8;
export const CHATBOT = { x: -119, y: -42, w: 142, d: 84, r: 5 };
export const HERMES = { x: 35, y: -42, w: 84, d: 84, r: 5 };
export const SELECTOR = [-100, -30];
export const TRAVEL = { carro: 92, tarjeta: 140, compuerta: 16, sello: 14, ficha: 24 };
export const PERILLA_STEP = -60;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => v * v * (3 - 2 * v);
const seg = (t, a, b) => ease(clamp01((t - a) / (b - a)));

// Valores de figura { mesa, t } → valores de grupo del motor 3D.
export const follow = (values) => {
  const t = values.t ?? 0;
  const carro = 16 * seg(t, 0, 0.5) + 76 * seg(t, 1, 1.6);
  return {
    ...values,
    carro,
    compuerta: 16 * (seg(t, 0.55, 0.95) - seg(t, 1.65, 1.95)),
    tarjeta: carro + 48 * seg(t, 2.1, 2.8),
    sello: 14 * (seg(t, 3, 3.35) - seg(t, 3.6, 3.95)),
    ficha: 12 * seg(t, 2.6, 2.9) + 12 * seg(t, 3.3, 3.55),
    perilla: PERILLA_STEP * t,
  };
};

// Estados alcanzables para T.build: el giro completo y todo el recorrido de t.
export const poses = () => {
  const out = [];
  for (let i = 0; i < 720; i++) out.push(follow({ mesa: i * 0.5, t: ((i % 160) / 160) * LAST }));
  for (let i = 0; i <= 400; i++) out.push(follow({ mesa: 30, t: (i / 400) * LAST }));
  return out;
};
