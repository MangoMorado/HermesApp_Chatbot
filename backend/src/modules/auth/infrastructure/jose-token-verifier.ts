import { jwtVerify } from "jose";
import type { TokenClaims, TokenVerifier } from "../domain/ports/token-verifier";
import { isRole } from "../domain/role";

export type JwtSettings = {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
};

function readClaim(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Adaptador: verifica HS256 con `jose` y traduce el payload a claims del nucleo. */
export function createJoseTokenVerifier(settings: JwtSettings): TokenVerifier {
  const key = new TextEncoder().encode(settings.secret);

  return {
    async verify(token: string): Promise<TokenClaims> {
      const { payload } = await jwtVerify(token, key, {
        issuer: settings.issuer,
        audience: settings.audience,
        algorithms: ["HS256"],
      });

      const subject = readClaim(payload, "sub");
      const tenantId = readClaim(payload, "tenant_id");
      const role = payload.role;
      const sessionId = readClaim(payload, "session_id");

      if (!subject || !tenantId || !isRole(role)) {
        throw new Error("El token no trae sub, tenant_id o role validos");
      }

      return { subject, tenantId, role, ...(sessionId ? { sessionId } : {}) };
    },
  };
}
