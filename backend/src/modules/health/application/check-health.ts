import type { Clock } from "../domain/ports/clock";

export type HealthStatus = {
  readonly status: "ok";
  readonly checkedAt: string;
};

export type CheckHealth = () => HealthStatus;

/** Caso de uso: reporta que el servicio responde. No consulta dependencias externas. */
export function createCheckHealth(clock: Clock): CheckHealth {
  return () => ({
    status: "ok",
    checkedAt: clock.now().toISOString(),
  });
}
