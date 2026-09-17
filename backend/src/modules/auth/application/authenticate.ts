import type { Actor } from "../domain/actor";
import { unauthorized } from "../domain/auth-error";
import type { TokenVerifier } from "../domain/ports/token-verifier";

const BEARER = /^Bearer (.+)$/;

export type Authenticate = (authorizationHeader: string | null) => Promise<Actor>;

/**
 * Caso de uso: convierte la cabecera Authorization en un actor.
 * Lanza AuthError(`unauthorized`) ante cualquier fallo, sin distinguir la causa:
 * decir "token expirado" frente a "firma invalida" ya es informacion.
 */
export function createAuthenticate(verifier: TokenVerifier): Authenticate {
  return async (authorizationHeader) => {
    if (!authorizationHeader) {
      throw unauthorized("Falta la cabecera Authorization");
    }

    const match = BEARER.exec(authorizationHeader);
    const token = match?.[1];
    if (!token) {
      throw unauthorized("La cabecera Authorization no es un Bearer token");
    }

    try {
      const claims = await verifier.verify(token);
      return {
        subject: claims.subject,
        tenantId: claims.tenantId,
        role: claims.role,
        ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
      };
    } catch {
      throw unauthorized();
    }
  };
}
