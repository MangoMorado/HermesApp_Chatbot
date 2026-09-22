import { SignJWT } from "jose";
import type { Role } from "@/modules/auth/domain/role";

export const TEST_JWT = {
  secret: "secreto-de-pruebas-suficientemente-largo-para-hs256",
  issuer: "chatbot-ingenius-360",
  audience: "chatbot-ingenius-360",
};

type TokenOptions = {
  role: Role;
  tenantId: string;
  subject?: string;
  sessionId?: string;
  expiresIn?: string;
  issuer?: string;
  audience?: string;
  secret?: string;
};

export async function signToken(options: TokenOptions): Promise<string> {
  const claims: Record<string, string> = { tenant_id: options.tenantId, role: options.role };
  if (options.sessionId) {
    claims.session_id = options.sessionId;
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(options.subject ?? "usuario-de-prueba")
    .setIssuer(options.issuer ?? TEST_JWT.issuer)
    .setAudience(options.audience ?? TEST_JWT.audience)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(new TextEncoder().encode(options.secret ?? TEST_JWT.secret));
}

export function authorized(token: string): Request {
  return authedRequest("http://localhost/api/v1/me", token);
}

/** Request autenticado a una URL arbitraria (suites HTTP). */
export function authedRequest(url: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(url, { ...init, headers });
}
