import type { AppConfig } from "../config/env";
import { type Authenticate, createAuthenticate } from "../modules/auth/application/authenticate";
import {
  type CloseProviderSession,
  createCloseProviderSession,
} from "../modules/auth/application/close-provider-session";
import type { ClosedSessions } from "../modules/auth/domain/ports/closed-sessions";
import {
  createOidcDiscovery,
  type OidcDiscovery,
} from "../modules/auth/infrastructure/oidc-discovery";
import { createOidcTokenVerifier } from "../modules/auth/infrastructure/oidc-token-verifier";
import { createPrismaClosedSessions } from "../modules/auth/infrastructure/prisma-closed-sessions";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";

export type AuthWiring = {
  readonly authenticate: Authenticate;
  readonly closedSessions: ClosedSessions;
  readonly closeProviderSession: CloseProviderSession;
  /** Una sola instancia de discovery: la comparten el verificador y los clientes maquina. */
  readonly oidcDiscovery: () => Promise<OidcDiscovery>;
};

/**
 * Cableado de identidad: el verificador solo acepta tokens del proveedor OIDC
 * (RS256/ES256 por discovery y JWKS) y consulta las sesiones cerradas en Postgres.
 */
export function authWiring(db: PrismaExecutor, config: AppConfig): AuthWiring {
  const oidcDiscovery = createOidcDiscovery(config.oidc.issuer);
  const closedSessions = createPrismaClosedSessions(db);
  const verifier = createOidcTokenVerifier(config.oidc, oidcDiscovery);
  return {
    authenticate: createAuthenticate({ verifier, closedSessions, clock: systemClock }),
    closedSessions,
    closeProviderSession: createCloseProviderSession({
      verifier,
      closedSessions,
      clock: systemClock,
      maxTokenLifetimeSeconds: config.oidc.maxTokenLifetimeSeconds,
    }),
    oidcDiscovery,
  };
}
