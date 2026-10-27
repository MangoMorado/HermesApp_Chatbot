import type { Clock } from "@/modules/shared/domain/ports/clock";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { AuthenticatedActor } from "../domain/actor";
import { unauthorized } from "../domain/auth-error";
import type { ClosedSessions } from "../domain/ports/closed-sessions";
import type { TokenClaims, TokenVerifier } from "../domain/ports/token-verifier";

const BEARER = /^Bearer (.+)$/;

export type Authenticate = (authorizationHeader: string | null) => Promise<AuthenticatedActor>;

export type AuthenticateDeps = {
  readonly verifier: TokenVerifier;
  readonly closedSessions: ClosedSessions;
  readonly clock: Clock;
};

function bearerToken(authorizationHeader: string | null): string {
  if (!authorizationHeader) {
    throw unauthorized("Falta la cabecera Authorization");
  }
  const token = BEARER.exec(authorizationHeader)?.[1];
  if (!token) {
    throw unauthorized("La cabecera Authorization no es un Bearer token");
  }
  return token;
}

/** `platform` no lleva tenant; cualquier otro rol sin tenant no es un actor valido. */
function toActor(claims: TokenClaims): AuthenticatedActor {
  const { subject, role } = claims;
  if (role === "platform") {
    return { subject, role };
  }
  if (claims.tenantId === null) {
    throw unauthorized();
  }
  return { subject, tenantId: toTenantId(claims.tenantId), role };
}

/**
 * Caso de uso: convierte la cabecera Authorization en un actor.
 * Lanza AuthError(`unauthorized`) ante cualquier fallo del token, sin distinguir la causa:
 * decir "token expirado" frente a "firma invalida" ya es informacion.
 * La consulta de sesiones cerradas queda fuera de esa conversion: una base caida es un 500.
 */
export function createAuthenticate(deps: AuthenticateDeps): Authenticate {
  return async (authorizationHeader) => {
    const token = bearerToken(authorizationHeader);

    let claims: TokenClaims;
    let actor: AuthenticatedActor;
    try {
      claims = await deps.verifier.verify(token);
      actor = toActor(claims);
    } catch {
      throw unauthorized();
    }

    const sid = claims.providerSessionId;
    if (sid && (await deps.closedSessions.isClosed(sid, deps.clock.now()))) {
      throw unauthorized();
    }
    return actor;
  };
}
