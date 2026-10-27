import { InvalidRequestError } from "../../shared/domain/invalid-request-error";
import type { Clock } from "../../shared/domain/ports/clock";
import { IdentityUnavailableError } from "../domain/machine-credential-error";
import type { ClosedSessions } from "../domain/ports/closed-sessions";
import type { LogoutTokenVerifier } from "../domain/ports/logout-token-verifier";

export type CloseProviderSession = (logoutToken: unknown) => Promise<void>;

/**
 * Back-channel logout: verifica el logout_token y marca el `sid` como cerrado hasta que
 * caduque el ultimo token que pudo emitirse en esa sesion (vida maxima + tolerancia de
 * reloj). Idempotente por naturaleza.
 */
export function createCloseProviderSession(deps: {
  verifier: LogoutTokenVerifier;
  closedSessions: ClosedSessions;
  clock: Clock;
  maxTokenLifetimeSeconds: number;
  clockToleranceSeconds: number;
}): CloseProviderSession {
  return async (logoutToken) => {
    if (typeof logoutToken !== "string" || logoutToken.length === 0) {
      throw new InvalidRequestError("logout_token ausente");
    }
    let providerSessionId: string;
    try {
      ({ providerSessionId } = await deps.verifier.verifyLogout(logoutToken));
    } catch (error) {
      // Proveedor inalcanzable: 503 para que reintente; el token no es necesariamente invalido.
      if (error instanceof IdentityUnavailableError) {
        throw error;
      }
      throw new InvalidRequestError("logout_token invalido");
    }
    // Un token emitido justo antes del cierre vive `maxTokenLifetime` y aun se acepta durante
    // la tolerancia de reloj tras su `exp`: el cierre debe cubrir ambas.
    const windowSeconds = deps.maxTokenLifetimeSeconds + deps.clockToleranceSeconds;
    const until = new Date(deps.clock.now().getTime() + windowSeconds * 1000);
    await deps.closedSessions.close(providerSessionId, until);
  };
}
