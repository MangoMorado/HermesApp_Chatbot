import { SignJWT } from "jose";
import type { TokenIssuer } from "../domain/ports/token-issuer";
import type { JwtSettings } from "./jose-token-verifier";

const toSeconds = (instant: Date) => Math.floor(instant.getTime() / 1000);

/** Adaptador: firma HS256 con los mismos emisor y audiencia que exige el verificador. */
export function createJoseTokenIssuer(settings: JwtSettings): TokenIssuer {
  const key = new TextEncoder().encode(settings.secret);

  return {
    issue(input) {
      const claims: Record<string, string> = { tenant_id: input.tenantId, role: input.role };
      if (input.sessionId) {
        claims.session_id = input.sessionId;
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(input.subject)
        .setIssuer(settings.issuer)
        .setAudience(settings.audience)
        .setIssuedAt(toSeconds(input.issuedAt))
        .setExpirationTime(toSeconds(input.expiresAt))
        .sign(key);
    },
  };
}
