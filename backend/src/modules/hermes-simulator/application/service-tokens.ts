import type { ClientTokenSource } from "@/modules/auth/domain/ports/client-token-source";
import type { ServiceTokenIssuer } from "../domain/ports/fhir-http";

/** Token `service` de un tenant: lo entrega el proveedor por client_credentials. */
export function createServiceTokens(source: ClientTokenSource): ServiceTokenIssuer {
  return {
    async issue(tenantId) {
      const token = await source.tokenFor({ kind: "service", tenantId });
      return token.accessToken;
    },
  };
}
