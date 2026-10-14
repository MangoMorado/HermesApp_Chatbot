import type { TokenIssuer } from "@/modules/auth/domain/ports/token-issuer";
import type { ServiceTokenIssuer } from "../domain/ports/fhir-http";

const QUARTER_HOUR_MS = 15 * 60_000;

/** Token `service` de un tenant. La Fase 5 cambia el emisor, no esta funcion. */
export function createServiceTokens(issuer: TokenIssuer): ServiceTokenIssuer {
  return {
    issue(tenantId) {
      const issuedAt = new Date();
      return issuer.issue({
        subject: `hermes-${tenantId}`,
        tenantId,
        role: "service",
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + QUARTER_HOUR_MS),
      });
    },
  };
}
