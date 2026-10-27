import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createOidcDiscovery } from "@/modules/auth/infrastructure/oidc-discovery";
import { createOidcTokenVerifier } from "@/modules/auth/infrastructure/oidc-token-verifier";
import { resetFakeIdp, setFakeIdpDown, signLogoutToken, signToken, TEST_OIDC } from "./helpers/idp";

const settings = loadConfig().oidc;
let verifier = createOidcTokenVerifier(settings, createOidcDiscovery(settings.issuer));

beforeEach(() => {
  resetFakeIdp();
  verifier = createOidcTokenVerifier(settings, createOidcDiscovery(settings.issuer));
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
  ])("rechaza %s", async (_, opts) => {
    const token = await signToken({ role: "admin", tenantId: "t", ...opts });
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it("expirado dentro de la tolerancia pasa", async () => {
    const token = await signToken({ role: "admin", tenantId: "t", expiresIn: "-10s" });
    expect((await verifier.verify(token)).role).toBe("admin");
  });

  it("proveedor caido rechaza y luego se recupera", async () => {
    const token = await signToken({ role: "admin", tenantId: "t" });
    setFakeIdpDown(true);
    await expect(verifier.verify(token)).rejects.toThrow();
    setFakeIdpDown(false);
    expect((await verifier.verify(token)).role).toBe("admin");
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
  it("exige que el issuer del documento coincida", async () => {
    const discovery = createOidcDiscovery("https://idp.test/realms/chatbot-test/");
    await expect(discovery()).rejects.toThrow();
  });
});
