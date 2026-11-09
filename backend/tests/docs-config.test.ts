import { afterEach, describe, expect, it } from "vitest";
import { docsWiring } from "@/composition/docs-wiring";
import { type AppConfig, loadConfig } from "@/config/env";
import { IdentityUnavailableError } from "@/modules/auth/domain/machine-credential-error";
import {
  createOidcDiscovery,
  type OidcDiscovery,
} from "@/modules/auth/infrastructure/oidc-discovery";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, saved);
});

const ISSUER = "https://idp.docs.test/realms/x";

function fakeFetch(document: Record<string, unknown>): typeof fetch {
  return async () => new Response(JSON.stringify(document), { status: 200 });
}

describe("docs: discovery con authorization_endpoint", () => {
  const base = { issuer: ISSUER, jwks_uri: `${ISSUER}/certs`, token_endpoint: `${ISSUER}/token` };

  it("sin authorization_endpoint resuelve null", async () => {
    const discovery = createOidcDiscovery({ issuer: ISSUER, httpTimeoutMs: 1000 }, fakeFetch(base));
    expect((await discovery()).authorizationEndpoint).toBeNull();
  });

  it("con authorization_endpoint lo devuelve", async () => {
    const discovery = createOidcDiscovery(
      { issuer: ISSUER, httpTimeoutMs: 1000 },
      fakeFetch({ ...base, authorization_endpoint: `${ISSUER}/auth` }),
    );
    expect((await discovery()).authorizationEndpoint).toBe(`${ISSUER}/auth`);
  });
});

describe("docs: configuracion", () => {
  it("por defecto apagado y con el cliente chatbot-swagger", () => {
    delete process.env.DOCS_ENABLED;
    delete process.env.DOCS_OIDC_CLIENT_ID;
    expect(loadConfig().docs).toEqual({ enabled: false, oidcClientId: "chatbot-swagger" });
  });

  it("refleja las variables", () => {
    process.env.DOCS_ENABLED = "true";
    process.env.DOCS_OIDC_CLIENT_ID = "otro";
    expect(loadConfig().docs).toEqual({ enabled: true, oidcClientId: "otro" });
  });

  it("solo el texto true enciende", () => {
    process.env.DOCS_ENABLED = "yes";
    expect(loadConfig().docs.enabled).toBe(false);
  });
});

const ENDPOINTS: OidcDiscovery = {
  jwksUri: "https://idp.fake/certs",
  tokenEndpoint: "https://idp.fake/token",
  authorizationEndpoint: "https://idp.fake/auth",
};

function config(simulator: boolean): AppConfig {
  return {
    ...loadConfig(),
    hermesSimulatorEnabled: simulator,
    docs: { enabled: true, oidcClientId: "chatbot-swagger" },
  };
}

describe("docs: wiring", () => {
  it("sin simulador no ofrece sim", async () => {
    const wiring = docsWiring(config(false), async () => ENDPOINTS);
    expect(wiring.contracts.map((c) => c.name)).toEqual(["chatbot", "platform"]);
    expect(await wiring.servedDocument("sim")).toBeNull();
  });

  it("con simulador ofrece los tres", () => {
    const wiring = docsWiring(config(true), async () => ENDPOINTS);
    expect(wiring.contracts.map((c) => c.name)).toEqual(["chatbot", "platform", "sim"]);
  });

  it("un nombre desconocido da null", async () => {
    const wiring = docsWiring(config(true), async () => ENDPOINTS);
    expect(await wiring.servedDocument("nada")).toBeNull();
    expect(await wiring.servedDocument("__proto__")).toBeNull();
  });

  it("el documento servido lleva el token endpoint del proveedor", async () => {
    const wiring = docsWiring(config(false), async () => ENDPOINTS);
    const served = JSON.stringify(await wiring.servedDocument("chatbot"));
    expect(served).toContain("https://idp.fake/token");
    expect(served).not.toContain("oidc.invalid");
  });

  it("si el discovery falla, propaga IdentityUnavailableError", async () => {
    const wiring = docsWiring(config(false), async () => {
      throw new IdentityUnavailableError();
    });
    await expect(wiring.servedDocument("chatbot")).rejects.toBeInstanceOf(IdentityUnavailableError);
  });
});
