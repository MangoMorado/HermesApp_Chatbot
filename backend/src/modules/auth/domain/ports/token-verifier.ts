import type { Role } from "../role";

/** Lo que el nucleo espera encontrar dentro de un token ya validado. */
export type TokenClaims = {
  readonly subject: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly sessionId?: string;
};

/**
 * Puerto de verificacion. La firma, el algoritmo y el reloj son detalle del
 * adaptador; el nucleo solo sabe que un token o es valido o no lo es.
 */
export type TokenVerifier = {
  verify(token: string): Promise<TokenClaims>;
};
