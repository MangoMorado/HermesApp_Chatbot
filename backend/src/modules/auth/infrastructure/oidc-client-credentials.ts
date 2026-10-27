import { createHash } from "node:crypto";
import type { AppConfig } from "@/config/env";
import {
  IdentityUnavailableError,
  MachineCredentialMissingError,
} from "@/modules/auth/domain/machine-credential-error";
import type {
  ClientToken,
  ClientTokenSource,
} from "@/modules/auth/domain/ports/client-token-source";
import type {
  MachineCredential,
  MachineCredentialRef,
  MachineCredentialResolver,
} from "@/modules/auth/domain/ports/machine-credentials";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { OidcDiscovery } from "./oidc-discovery";

const SAFETY_MARGIN_MS = 30_000;

type Deps = {
  discovery: () => Promise<OidcDiscovery>;
  resolve: MachineCredentialResolver;
  clock: Clock;
  fetchFn?: typeof fetch;
};

type RequestDeps = Pick<Deps, "discovery" | "clock"> & { fetchFn: typeof fetch };

function cacheKey(credential: MachineCredential): string {
  const digest = createHash("sha256").update(credential.clientSecret).digest("hex");
  return `${credential.clientId}:${digest}`;
}

function basicHeader(credential: MachineCredential): string {
  const pair = `${encodeURIComponent(credential.clientId)}:${encodeURIComponent(credential.clientSecret)}`;
  return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
}

async function postForToken(deps: RequestDeps, credential: MachineCredential): Promise<Response> {
  try {
    const { tokenEndpoint } = await deps.discovery();
    return await deps.fetchFn(tokenEndpoint, {
      method: "POST",
      headers: {
        Authorization: basicHeader(credential),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
  } catch {
    throw new IdentityUnavailableError();
  }
}

async function requestToken(
  deps: RequestDeps,
  credential: MachineCredential,
): Promise<ClientToken> {
  const response = await postForToken(deps, credential);
  if (!response.ok) {
    throw new IdentityUnavailableError(`El proveedor respondio ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  if (typeof body?.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new IdentityUnavailableError("Respuesta de token invalida");
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(deps.clock.now().getTime() + body.expires_in * 1000),
  };
}

/** Token source client_credentials con cache por cliente + huella del secreto. */
export function createOidcClientCredentials(deps: Deps): ClientTokenSource {
  const requestDeps: RequestDeps = {
    discovery: deps.discovery,
    clock: deps.clock,
    fetchFn: deps.fetchFn ?? ((...args) => fetch(...args)),
  };
  const cache = new Map<string, ClientToken>();
  return {
    async tokenFor(ref: MachineCredentialRef): Promise<ClientToken> {
      const credential = await deps.resolve(ref);
      if (!credential) {
        throw new MachineCredentialMissingError(ref.kind);
      }
      const key = cacheKey(credential);
      const cached = cache.get(key);
      if (cached && cached.expiresAt.getTime() - SAFETY_MARGIN_MS > deps.clock.now().getTime()) {
        return cached;
      }
      const token = await requestToken(requestDeps, credential);
      cache.set(key, token);
      return token;
    },
  };
}

/** Resuelve el cliente service desde config: entrada exacta o comodin "*" con {tenant}. */
export function configServiceResolver(
  clients: AppConfig["simServiceClients"],
): MachineCredentialResolver {
  return async (ref) => {
    if (ref.kind !== "service") {
      return null;
    }
    const exact = clients.get(ref.tenantId);
    if (exact) {
      return { clientId: exact.clientId, clientSecret: exact.clientSecret };
    }
    const wildcard = clients.get("*");
    if (!wildcard) {
      return null;
    }
    return {
      clientId: wildcard.clientId.replaceAll("{tenant}", ref.tenantId),
      clientSecret: wildcard.clientSecret,
    };
  };
}
