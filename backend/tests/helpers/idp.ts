import { type CryptoKey, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

/**
 * Proveedor OIDC falso para las suites: envuelve `fetch` y atiende discovery, JWKS y
 * `client_credentials` del issuer de pruebas sin red. El resto de URLs pasa al fetch original.
 */
export const TEST_OIDC = {
  issuer: "https://idp.test/realms/chatbot-test",
  audience: "chatbot-api",
  logoutAudience: "chatbot-reference-ui",
};
export const TEST_CLIENT_SECRET = "test-client-secret";

const TOKEN_LIFETIME_SECONDS = 300;
const HS_SECRET = new TextEncoder().encode("secreto-compartido-hs256-de-pruebas-largo");

const rsa = await generateKeyPair("RS256", { extractable: true });
const ec = await generateKeyPair("ES256", { extractable: true });
const foreign = await generateKeyPair("RS256", { extractable: true });
const publicJwks: { keys: JWK[] } = {
  keys: [
    { ...(await exportJWK(rsa.publicKey)), kid: "rs", alg: "RS256", use: "sig" },
    { ...(await exportJWK(ec.publicKey)), kid: "es", alg: "ES256", use: "sig" },
  ],
};

type Alg = "RS256" | "ES256" | "HS256";

export type SignOptions = {
  role?: string;
  roles?: unknown;
  tenantId?: unknown;
  subject?: string;
  sid?: string;
  expiresIn?: string;
  /** Omite `exp`: el verificador debe rechazar el token. */
  withoutExp?: boolean;
  issuer?: string;
  audience?: string;
  alg?: Alg;
  foreignKey?: boolean;
  extra?: Record<string, unknown>;
};

function signingMaterial(options: { alg?: Alg; foreignKey?: boolean }): {
  alg: Alg;
  kid: string | undefined;
  key: CryptoKey | Uint8Array;
} {
  const alg = options.alg ?? "RS256";
  if (alg === "HS256") {
    return { alg, kid: undefined, key: HS_SECRET };
  }
  if (options.foreignKey) {
    return { alg, kid: "rs", key: foreign.privateKey };
  }
  return alg === "ES256"
    ? { alg, kid: "es", key: ec.privateKey }
    : { alg, kid: "rs", key: rsa.privateKey };
}

async function sign(
  claims: Record<string, unknown>,
  head: { alg?: Alg; foreignKey?: boolean },
  fields: {
    subject?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    withoutExp?: boolean;
  },
): Promise<string> {
  const { alg, kid, key } = signingMaterial(head);
  const jwt = new SignJWT(claims)
    .setProtectedHeader(kid ? { alg, kid } : { alg })
    .setIssuer(fields.issuer ?? TEST_OIDC.issuer)
    .setAudience(fields.audience ?? TEST_OIDC.audience)
    .setIssuedAt();
  if (!fields.withoutExp) {
    jwt.setExpirationTime(fields.expiresIn ?? "5m");
  }
  if (fields.subject) {
    jwt.setSubject(fields.subject);
  }
  return jwt.sign(key);
}

export async function signToken(options: SignOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = {
    roles: options.roles ?? (options.role ? [options.role] : []),
    ...options.extra,
  };
  if (options.tenantId !== undefined) {
    claims.tenant_id = options.tenantId;
  }
  if (options.sid) {
    claims.sid = options.sid;
  }
  return sign(claims, options, { ...options, subject: options.subject ?? "usuario-de-prueba" });
}

export async function signLogoutToken(
  options: {
    sid?: string;
    audience?: string;
    events?: unknown;
    nonce?: string;
    issuer?: string;
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = {
    events: options.events ?? { "http://schemas.openid.net/event/backchannel-logout": {} },
    jti: crypto.randomUUID(),
  };
  if (options.sid) {
    claims.sid = options.sid;
  }
  if (options.nonce) {
    claims.nonce = options.nonce;
  }
  return sign(
    claims,
    {},
    { issuer: options.issuer, audience: options.audience ?? TEST_OIDC.logoutAudience },
  );
}

// --- Proveedor falso -----------------------------------------------------------------------

type FakeCall = { url: string; clientId?: string };

const calls: FakeCall[] = [];
let down = false;
let trailingSlash = false;
let installed = false;

export function fakeIdpCalls(): readonly FakeCall[] {
  return calls;
}

export function resetFakeIdp(): void {
  calls.length = 0;
  down = false;
  trailingSlash = false;
}

/** El discovery anuncia el issuer con barra final (`TEST_OIDC.issuer + "/"`), como algunos IdP. */
export function setFakeIdpTrailingSlash(value: boolean): void {
  trailingSlash = value;
}

export function setFakeIdpDown(value: boolean): void {
  down = value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function basicCredentials(request: Request): { id: string; secret: string } | null {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) {
    return null;
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const index = decoded.indexOf(":");
  if (index < 0) {
    return null;
  }
  return {
    id: decodeURIComponent(decoded.slice(0, index)),
    secret: decodeURIComponent(decoded.slice(index + 1)),
  };
}

function claimsForClient(clientId: string): { roles: string[]; tenant?: string } {
  if (clientId === "platform-client") {
    return { roles: ["platform"] };
  }
  if (clientId.startsWith("widget-")) {
    return { roles: ["widget"], tenant: clientId.slice("widget-".length) };
  }
  if (clientId.startsWith("service-")) {
    return { roles: ["service"], tenant: clientId.slice("service-".length) };
  }
  return { roles: [] };
}

async function tokenResponse(request: Request): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const credentials = basicCredentials(request);
  // Cada peticion al endpoint de token se registra aqui, una sola vez.
  calls.push(credentials ? { url: request.url, clientId: credentials.id } : { url: request.url });
  if (form.get("grant_type") !== "client_credentials") {
    return json({ error: "unsupported_grant_type" }, 400);
  }
  if (!credentials || credentials.secret !== TEST_CLIENT_SECRET) {
    return json({ error: "invalid_client" }, 401);
  }
  const { roles, tenant } = claimsForClient(credentials.id);
  const accessToken = await signToken({
    roles,
    tenantId: tenant,
    subject: `service-account-${credentials.id}`,
  });
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_LIFETIME_SECONDS,
  });
}

async function handleIdp(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.slice(new URL(TEST_OIDC.issuer).pathname.length);
  if (path === "/.well-known/openid-configuration") {
    return json({
      issuer: trailingSlash ? `${TEST_OIDC.issuer}/` : TEST_OIDC.issuer,
      jwks_uri: `${TEST_OIDC.issuer}/protocol/openid-connect/certs`,
      token_endpoint: `${TEST_OIDC.issuer}/protocol/openid-connect/token`,
    });
  }
  if (path === "/protocol/openid-connect/certs") {
    return json(publicJwks);
  }
  if (path === "/protocol/openid-connect/token" && request.method === "POST") {
    return tokenResponse(request);
  }
  return json({ error: "not_found" }, 404);
}

function isTokenRequest(request: Request): boolean {
  return (
    request.method === "POST" && request.url === `${TEST_OIDC.issuer}/protocol/openid-connect/token`
  );
}

export function installFakeIdp(): void {
  if (installed) {
    return;
  }
  installed = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(TEST_OIDC.issuer)) {
      return original(input, init);
    }
    if (!isTokenRequest(request)) {
      calls.push({ url: request.url });
    }
    if (down) {
      throw new TypeError("fetch failed: proveedor de identidad caido");
    }
    return handleIdp(request);
  }) as typeof fetch;
}

/** Token `platform` del proveedor falso: `client_credentials` con `platform-client`. */
export async function platformToken(): Promise<string> {
  const basic = Buffer.from(`platform-client:${TEST_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${TEST_OIDC.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  return ((await response.json()) as { access_token: string }).access_token;
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
