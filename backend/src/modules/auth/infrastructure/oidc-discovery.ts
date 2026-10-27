export type OidcDiscovery = { jwksUri: string; tokenEndpoint: string };

function readUrl(document: Record<string, unknown>, field: string): string {
  const value = document[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`El discovery OIDC no trae ${field}`);
  }
  return value;
}

async function fetchDiscovery(issuer: string, fetchFn: typeof fetch): Promise<OidcDiscovery> {
  const response = await fetchFn(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`Discovery OIDC respondio ${response.status}`);
  }
  const document = (await response.json()) as Record<string, unknown>;
  if (document.issuer !== issuer) {
    throw new Error("El issuer del discovery no coincide con el configurado");
  }
  return {
    jwksUri: readUrl(document, "jwks_uri"),
    tokenEndpoint: readUrl(document, "token_endpoint"),
  };
}

/**
 * Resuelve el documento de discovery una sola vez. Si falla, se olvida el intento
 * para reintentar en la siguiente llamada.
 */
export function createOidcDiscovery(
  issuer: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): () => Promise<OidcDiscovery> {
  let pending: Promise<OidcDiscovery> | null = null;
  return () => {
    if (!pending) {
      const attempt = fetchDiscovery(issuer, fetchFn);
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
