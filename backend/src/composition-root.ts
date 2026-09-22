import { loadConfig } from "./config/env";
import { type Authenticate, createAuthenticate } from "./modules/auth/application/authenticate";
import { createJoseTokenVerifier } from "./modules/auth/infrastructure/jose-token-verifier";
import { type CheckHealth, createCheckHealth } from "./modules/health/application/check-health";
import { systemClock } from "./modules/shared/infrastructure/system-clock";

/**
 * Composition root unico: ensambla adaptadores concretos con los casos de uso.
 * Los adaptadores de entrada (route handlers) solo leen de aqui.
 */
export type Container = {
  readonly checkHealth: CheckHealth;
  readonly authenticate: Authenticate;
};

let container: Container | undefined;

export function getContainer(): Container {
  if (!container) {
    const config = loadConfig();
    container = {
      checkHealth: createCheckHealth(systemClock),
      authenticate: createAuthenticate(createJoseTokenVerifier(config.jwt)),
    };
  }
  return container;
}
