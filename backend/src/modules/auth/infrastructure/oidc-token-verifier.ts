import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AppConfig } from "@/config/env";
import { IdentityUnavailableError } from "../domain/machine-credential-error";
import type { LogoutTokenVerifier } from "../domain/ports/logout-token-verifier";
import type { TokenVerifier } from "../domain/ports/token-verifier";
import { mapClaims } from "./claims-mapper";
import type { OidcDiscovery } from "./oidc-discovery";

const ALGORITHMS = ["RS256", "ES256"];
const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * Fallo al traer el JWKS: red, timeout, respuesta no 200 o JSON invalido. Una clave que no
 * casa con el `kid` o el algoritmo es un fallo del token, no del proveedor.
 */
function isJwksFetchFailure(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) {
    return true;
  }
  return (
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid ||
    error.code === errors.JOSEError.code
  );
}

/** Envuelve el JWKS remoto: los fallos de infraestructura salen como `IdentityUnavailableError`. */
function classifiedKeys(remote: JWTVerifyGetKey): JWTVerifyGetKey {
  return async (header, token) => {
    try {
      return await remote(header, token);
    } catch (error) {
      throw isJwksFetchFailure(error) ? new IdentityUnavailableError() : error;
    }
  };
}

/**
 * Adaptador: verifica tokens RS256/ES256 del proveedor OIDC contra su JWKS. Clasifica el
 * error: proveedor inalcanzable (discovery o JWKS) -> `IdentityUnavailableError`; cualquier
 * otro fallo es del token.
 */
export function createOidcTokenVerifier(
  settings: AppConfig["oidc"],
  discovery: () => Promise<OidcDiscovery>,
): TokenVerifier & LogoutTokenVerifier {
  let keys: JWTVerifyGetKey | null = null;
  let keysUri = "";

  async function resolveKeys(): Promise<JWTVerifyGetKey> {
    const { jwksUri } = await discovery();
    if (!keys || keysUri !== jwksUri) {
      keys = classifiedKeys(
        createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: settings.httpTimeoutMs }),
      );
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
        requiredClaims: ["exp"],
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
