import {
  IdentityUnavailableError,
  MachineCredentialMismatchError,
} from "../domain/machine-credential-error";
import type { ClientToken } from "../domain/ports/client-token-source";
import type { MachineCredentialRef } from "../domain/ports/machine-credentials";
import type { TokenClaims, TokenVerifier } from "../domain/ports/token-verifier";

export type MachineTokenCheck = (token: ClientToken, ref: MachineCredentialRef) => Promise<void>;

/**
 * Antes de entregar un token de cliente maquina, se verifica con el mismo verificador que
 * usaran las rutas y se exige el rol y la clinica pedidos. Un token que no verifica o que es
 * de otro rol o clinica nunca se entrega: el cliente esta mal configurado.
 */
export function createMachineTokenCheck(verifier: TokenVerifier): MachineTokenCheck {
  return async (token, ref) => {
    let claims: TokenClaims;
    try {
      claims = await verifier.verify(token.accessToken);
    } catch (error) {
      if (error instanceof IdentityUnavailableError) {
        throw error;
      }
      throw new MachineCredentialMismatchError(ref.kind);
    }
    if (claims.role !== ref.kind || claims.tenantId !== ref.tenantId) {
      throw new MachineCredentialMismatchError(ref.kind);
    }
  };
}
