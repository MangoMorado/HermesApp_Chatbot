import type { Role } from "../role";

export type IssueTokenInput = {
  readonly subject: string;
  readonly tenantId: string;
  readonly role: Role;
  /** Solo para el rol `widget`. */
  readonly sessionId?: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
};

/** Puerto de emision. Firma y algoritmo son detalle del adaptador. */
export type TokenIssuer = {
  issue(input: IssueTokenInput): Promise<string>;
};
