import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AppConfig } from "@/config/env";
import type { LogoutTokenVerifier } from "../domain/ports/logout-token-verifier";
import type { TokenVerifier } from "../domain/ports/token-verifier";
import { mapClaims } from "./claims-mapper";
import type { OidcDiscovery } from "./oidc-discovery";

const ALGORITHMS = ["RS256", "ES256"];
const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/** Adaptador: verifica tokens RS256/ES256 del proveedor OIDC contra su JWKS. */
export function createOidcTokenVerifier(
  settings: AppConfig["oidc"],
  discovery: () => Promise<OidcDiscovery>,
): TokenVerifier & LogoutTokenVerifier {
  let keys: JWTVerifyGetKey | null = null;
  let keysUri = "";

  async function resolveKeys(): Promise<JWTVerifyGetKey> {
    const { jwksUri } = await discovery();
    if (!keys || keysUri !== jwksUri) {
      keys = createRemoteJWKSet(new URL(jwksUri));
      keysUri = jwksUri;
    }
    return keys;
  }

  const common = { issuer: settings.issuer, algorithms: ALGORITHMS };
  const clockTolerance = settings.clockToleranceSeconds;

  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, await resolveKeys(), {
        ...common,
        audience: settings.audience,
        clockTolerance,
      });
      return mapClaims(payload, settings);
    },

    async verifyLogout(token) {
      const { payload } = await jwtVerify(token, await resolveKeys(), {
        ...common,
        audience: [...settings.logoutAudiences],
        clockTolerance,
      });
      const events = payload.events as Record<string, unknown> | undefined;
      const event = events?.[BACKCHANNEL_EVENT];
      const sid = payload.sid;
      if (typeof event !== "object" || event === null || "nonce" in payload) {
        throw new Error("logout_token invalido");
      }
      if (typeof sid !== "string" || sid.length === 0) {
        throw new Error("logout_token sin sid");
      }
      return { providerSessionId: sid };
    },
  };
}
