import { IdentityUnavailableError } from "../domain/machine-credential-error";

export type OidcDiscovery = {
  jwksUri: string;
  tokenEndpoint: string;
  /** Opcional: un proveedor que solo hace client_credentials no lo publica. */
  authorizationEndpoint: string | null;
};

export type OidcDiscoverySettings = { readonly issuer: string; readonly httpTimeoutMs: number };

function readUrl(document: Record<string, unknown>, field: string): string {
  const value = document[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`El discovery OIDC no trae ${field}`);
  }
  return value;
}

function optionalUrl(document: Record<string, unknown>, field: string): string | null {
  const value = document[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Solo aqui se quita la barra final: el issuer se compara tal cual contra `iss`. */
export function discoveryUrl(issuer: string): string {
  let end = issuer.length;
  while (end > 0 && issuer[end - 1] === "/") {
    end--;
  }
  return `${issuer.slice(0, end)}/.well-known/openid-configuration`;
}

async function fetchDiscovery(
  settings: OidcDiscoverySettings,
  fetchFn: typeof fetch,
): Promise<OidcDiscovery> {
  const response = await fetchFn(discoveryUrl(settings.issuer), {
    signal: AbortSignal.timeout(settings.httpTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Discovery OIDC respondio ${response.status}`);
  }
  const document = (await response.json()) as Record<string, unknown>;
  if (document.issuer !== settings.issuer) {
    throw new Error("El issuer del discovery no coincide con el configurado");
  }
  return {
    jwksUri: readUrl(document, "jwks_uri"),
    tokenEndpoint: readUrl(document, "token_endpoint"),
    authorizationEndpoint: optionalUrl(document, "authorization_endpoint"),
  };
}

/** Cualquier fallo del discovery (red, timeout, documento) es del proveedor, no del token. */
async function attemptDiscovery(
  settings: OidcDiscoverySettings,
  fetchFn: typeof fetch,
): Promise<OidcDiscovery> {
  try {
    return await fetchDiscovery(settings, fetchFn);
  } catch (error) {
    throw new IdentityUnavailableError(
      error instanceof Error ? `Discovery OIDC: ${error.message}` : undefined,
    );
  }
}

/**
 * Resuelve el documento de discovery una sola vez. Si falla, se olvida el intento
 * para reintentar en la siguiente llamada.
 */
export function createOidcDiscovery(
  settings: OidcDiscoverySettings,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): () => Promise<OidcDiscovery> {
  let pending: Promise<OidcDiscovery> | null = null;
  return () => {
    if (!pending) {
      const attempt = attemptDiscovery(settings, fetchFn);
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) {
          pending = null;
        }
      });
    }
    return pending;
  };
}
