import { type CheckHealth, createCheckHealth } from "./modules/health/application/check-health";
import { systemClock } from "./modules/health/infrastructure/system-clock";

/**
 * Composition root unico: ensambla adaptadores concretos con los casos de uso.
 * Los adaptadores de entrada (route handlers) solo leen de aqui.
 */
export type Container = {
  readonly checkHealth: CheckHealth;
};

let container: Container | undefined;

export function getContainer(): Container {
  if (!container) {
    container = {
      checkHealth: createCheckHealth(systemClock),
    };
  }
  return container;
}
