import type { SendOutcome } from "./chat-client";

/** Marca del último envío resuelto: decide el foco y el borrador, sin tocar la carga inicial. */
export type Settled = {
  /** Sube con cada resultado de envío (también `invalid`): pide devolver el foco al control. */
  readonly seq: number;
  /** Sube solo cuando el turno avanza (no en `invalid`): vacía el borrador. */
  readonly turns: number;
};

export function nextSettled(previous: Settled | null, kind: SendOutcome["kind"]): Settled {
  const seq = (previous?.seq ?? 0) + 1;
  const turns = (previous?.turns ?? 0) + (kind === "invalid" ? 0 : 1);
  return { seq, turns };
}

/** ¿Hay un resultado de envío que el control aún no atendió? */
export function shouldFocus(settled: Settled | null, seen: number): boolean {
  return settled !== null && settled.seq !== seen;
}
