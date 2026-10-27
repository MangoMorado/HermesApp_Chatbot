import type { Role } from "../role";

/**
 * Lo que el nucleo espera encontrar dentro de un token ya validado.
 * `tenantId` es `null` solo cuando el rol es `platform`.
 */
export type TokenClaims = {
  readonly subject: string;
  readonly role: Role;
  readonly tenantId: string | null;
  readonly providerSessionId?: string;
  // Transitorio: se elimina en la tarea 5 junto con el verificador HS256.
  readonly sessionId?: string;
};

/**
 * Puerto de verificacion. La firma, el algoritmo y el reloj son detalle del
 * adaptador; el nucleo solo sabe que un token o es valido o no lo es.
 */
export type TokenVerifier = {
  verify(token: string): Promise<TokenClaims>;
};
