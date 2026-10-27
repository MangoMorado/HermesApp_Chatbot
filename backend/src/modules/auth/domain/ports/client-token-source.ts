import type { MachineCredentialRef } from "./machine-credentials";

export type ClientToken = { readonly accessToken: string; readonly expiresAt: Date };

/** Obtiene tokens de acceso para un cliente maquina (flujo client_credentials). */
export type ClientTokenSource = {
  tokenFor(ref: MachineCredentialRef): Promise<ClientToken>;
};
