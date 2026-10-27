import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { IdentityUnavailableError } from "@/modules/auth/domain/machine-credential-error";
import { createOidcDiscovery, discoveryUrl } from "@/modules/auth/infrastructure/oidc-discovery";
import { createOidcTokenVerifier } from "@/modules/auth/infrastructure/oidc-token-verifier";
import {
  resetFakeIdp,
  setFakeIdpDown,
  setFakeIdpTrailingSlash,
  signLogoutToken,
  signToken,
  TEST_OIDC,
} from "./helpers/idp";

const settings = loadConfig().oidc;
let verifier = createOidcTokenVerifier(settings, createOidcDiscovery(settings));

beforeEach(() => {
  resetFakeIdp();
  verifier = createOidcTokenVerifier(settings, createOidcDiscovery(settings));
});

/** fetch que nunca responde: solo termina cuando la senal de timeout aborta. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

describe("oidc-verificador: verify", () => {
  it.each(["RS256", "ES256"] as const)("acepta %s valido", async (alg) => {
    const claims = await verifier.verify(await signToken({ role: "admin", tenantId: "t", alg }));
    expect(claims).toMatchObject({ role: "admin", tenantId: "t" });
  });

  it.each([
    ["firma con clave ajena", { foreignKey: true }],
    ["HS256", { alg: "HS256" as const }],
    ["emisor ajeno", { issuer: "https://otro" }],
    ["audiencia ajena", { audience: "otra" }],
    ["expirado mas alla de la tolerancia", { expiresIn: "-31s" }],
    ["sin exp", { withoutExp: true }],
  ])("rechaza %s", async (_, opts) => {
    const token = await signToken({ role: "admin", tenantId: "t", ...opts });
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it("expirado dentro de la tolerancia pasa", async () => {
    const token = await signToken({ role: "admin", tenantId: "t", expiresIn: "-10s" });
    expect((await verifier.verify(token)).role).toBe("admin");
  });

  it("proveedor caido -> IdentityUnavailableError y luego se recupera", async () => {
    const token = await signToken({ role: "admin", tenantId: "t" });
    setFakeIdpDown(true);
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(IdentityUnavailableError);
    setFakeIdpDown(false);
    expect((await verifier.verify(token)).role).toBe("admin");
  });

  it("JWKS inalcanzable tras un discovery valido -> IdentityUnavailableError", async () => {
    const discovery = createOidcDiscovery(settings);
    await discovery();
    const fresh = createOidcTokenVerifier(settings, discovery);
    setFakeIdpDown(true);
    const token = await signToken({ role: "admin", tenantId: "t" });
    await expect(fresh.verify(token)).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it("firma ajena con el proveedor arriba no es un fallo del proveedor", async () => {
    const token = await signToken({ role: "admin", tenantId: "t", foreignKey: true });
    const error = await verifier.verify(token).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IdentityUnavailableError);
  });
});

describe("oidc-verificador: verifyLogout", () => {
  it("logout token valido devuelve sid", async () =>
    expect(await verifier.verifyLogout(await signLogoutToken({ sid: "s1" }))).toEqual({
      providerSessionId: "s1",
    }));

  it.each([
    ["sin evento", { events: {} }],
    ["con nonce", { nonce: "n" }],
    ["sin sid", { sid: undefined }],
    ["audiencia no listada", { audience: TEST_OIDC.audience }],
  ])("rechaza %s", async (_, opts) => {
    const token = await signLogoutToken({ sid: "s1", ...opts });
    await expect(verifier.verifyLogout(token)).rejects.toThrow();
  });
});

describe("oidc-discovery", () => {
  const withSlash = `${TEST_OIDC.issuer}/`;

  it("exige que el issuer del documento coincida", async () => {
    const discovery = createOidcDiscovery({ ...settings, issuer: withSlash });
    await expect(discovery()).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it("la URL del discovery quita la barra final; el issuer no", () => {
    expect(discoveryUrl(withSlash)).toBe(`${TEST_OIDC.issuer}/.well-known/openid-configuration`);
    expect(discoveryUrl(TEST_OIDC.issuer)).toBe(discoveryUrl(withSlash));
  });

  it("issuer con barra final verifica un token cuyo iss la lleva", async () => {
    setFakeIdpTrailingSlash(true);
    const slashed = { ...settings, issuer: withSlash };
    const slashedVerifier = createOidcTokenVerifier(slashed, createOidcDiscovery(slashed));
    const token = await signToken({ role: "admin", tenantId: "t", issuer: withSlash });
    expect((await slashedVerifier.verify(token)).role).toBe("admin");
  });

  it("sin barra final, un iss con barra no coincide", async () => {
    const token = await signToken({ role: "admin", tenantId: "t", issuer: withSlash });
    await expect(verifier.verify(token)).rejects.not.toBeInstanceOf(IdentityUnavailableError);
  });

  it("discovery que no responde -> IdentityUnavailableError por timeout", async () => {
    const discovery = createOidcDiscovery({ ...settings, httpTimeoutMs: 20 }, hangingFetch);
    await expect(discovery()).rejects.toBeInstanceOf(IdentityUnavailableError);
  });
});
