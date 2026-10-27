import { InvalidRequestError } from "../../shared/domain/invalid-request-error";
import type { Clock } from "../../shared/domain/ports/clock";
import type { ClosedSessions } from "../domain/ports/closed-sessions";
import type { LogoutTokenVerifier } from "../domain/ports/logout-token-verifier";

export type CloseProviderSession = (logoutToken: unknown) => Promise<void>;

/**
 * Back-channel logout: verifica el logout_token y marca el `sid` como cerrado hasta que
 * caduque el ultimo token que pudo emitirse en esa sesion. Idempotente por naturaleza.
 */
export function createCloseProviderSession(deps: {
  verifier: LogoutTokenVerifier;
  closedSessions: ClosedSessions;
  clock: Clock;
  maxTokenLifetimeSeconds: number;
}): CloseProviderSession {
  return async (logoutToken) => {
    if (typeof logoutToken !== "string" || logoutToken.length === 0) {
      throw new InvalidRequestError("logout_token ausente");
    }
    let providerSessionId: string;
    try {
      ({ providerSessionId } = await deps.verifier.verifyLogout(logoutToken));
    } catch {
      throw new InvalidRequestError("logout_token invalido");
    }
    const until = new Date(deps.clock.now().getTime() + deps.maxTokenLifetimeSeconds * 1000);
    await deps.closedSessions.close(providerSessionId, until);
  };
}
