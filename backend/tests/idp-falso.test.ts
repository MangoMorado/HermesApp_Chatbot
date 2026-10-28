import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import {
  fakeIdpCalls,
  resetFakeIdp,
  setFakeIdpDown,
  TEST_CLIENT_SECRET,
  TEST_OIDC,
} from "./helpers/idp";

function rawClientCredentials(clientId: string, secret: string): Promise<Response> {
  return fetch(`${TEST_OIDC.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
}

async function clientCredentials(clientId: string, secret: string) {
  return (await rawClientCredentials(clientId, secret)).json();
}

describe("sesion-widget: proveedor OIDC falso", () => {
  it("discovery y JWKS responden en el issuer de pruebas", async () => {
    const d = await (await fetch(`${TEST_OIDC.issuer}/.well-known/openid-configuration`)).json();
    expect(d.issuer).toBe(TEST_OIDC.issuer);
    expect((await (await fetch(d.jwks_uri)).json()).keys).toHaveLength(2);
  });

  it("client_credentials emite roles y tenant por convencion de client_id", async () => {
    const body = await clientCredentials("widget-tenant-a", TEST_CLIENT_SECRET);
    const payload = decodeJwt(body.access_token);
    expect(payload).toMatchObject({
      roles: ["widget"],
      tenant_id: "tenant-a",
      aud: "chatbot-api",
      iss: TEST_OIDC.issuer,
    });
    expect(payload.sid).toBeUndefined();
    expect(body.expires_in).toBe(300);
  });

  it("secreto erroneo da 401 invalid_client", async () =>
    expect((await rawClientCredentials("service-x", "mal")).status).toBe(401));

  it("caido: fetch rechaza", async () => {
    setFakeIdpDown(true);
    try {
      await expect(fetch(`${TEST_OIDC.issuer}/.well-known/openid-configuration`)).rejects.toThrow();
    } finally {
      setFakeIdpDown(false);
    }
  });

  it("registra cada llamada una sola vez, la de token con su clientId", async () => {
    resetFakeIdp();
    await clientCredentials("service-tenant-a", TEST_CLIENT_SECRET);
    const tokenCalls = fakeIdpCalls().filter((call) => call.url.endsWith("/token"));
    expect(tokenCalls).toEqual([
      { url: `${TEST_OIDC.issuer}/protocol/openid-connect/token`, clientId: "service-tenant-a" },
    ]);
    expect(fakeIdpCalls()).toHaveLength(1);
  });
});
