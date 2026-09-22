import type { Clock } from "../domain/ports/clock";

/** Adaptador: implementa el puerto de reloj con la hora del proceso. */
export const systemClock: Clock = {
  now: () => new Date(),
};
