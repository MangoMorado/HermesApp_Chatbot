import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IdentityUnavailableError,
  MachineCredentialMismatchError,
  MachineCredentialMissingError,
} from "@/modules/auth/domain/machine-credential-error";
import type { MachineCredentialResolver } from "@/modules/auth/domain/ports/machine-credentials";
import {
  configServiceResolver,
  createOidcClientCredentials,
} from "@/modules/auth/infrastructure/oidc-client-credentials";
import { createOidcDiscovery } from "@/modules/auth/infrastructure/oidc-discovery";
import {
  fakeIdpCalls,
  resetFakeIdp,
  setFakeIdpDown,
  TEST_CLIENT_SECRET,
  TEST_OIDC,
} from "./helpers/idp";

const ref = { kind: "service", tenantId: "t1" } as const;

function mutableClock(start = new Date("2026-10-27T10:00:00Z")) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

function tokenCalls(): number {
  return fakeIdpCalls().filter((call) => call.clientId !== undefined).length;
}

describe("client-credentials", () => {
  let clock: ReturnType<typeof mutableClock>;
  const discovery = createOidcDiscovery({ issuer: TEST_OIDC.issuer, httpTimeoutMs: 5000 });
  const good: MachineCredentialResolver = async (r) => ({
    clientId: `${r.kind}-${r.tenantId}`,
    clientSecret: TEST_CLIENT_SECRET,
  });
  const sourceWith = (resolve: MachineCredentialResolver) =>
    createOidcClientCredentials({ discovery, resolve, clock, httpTimeoutMs: 5000 });

  beforeEach(() => {
    resetFakeIdp();
    clock = mutableClock();
  });

  it("obtiene token con roles del cliente", async () => {
    const t = await sourceWith(good).tokenFor(ref);
    expect(decodeJwt(t.accessToken)).toMatchObject({ roles: ["service"], tenant_id: "t1" });
  });

  it("cachea hasta expiresAt - 30 s", async () => {
    const source = sourceWith(good);
    await source.tokenFor(ref);
    await source.tokenFor(ref);
    expect(tokenCalls()).toBe(1);
    clock.advance(271_000);
    await source.tokenFor(ref);
    expect(tokenCalls()).toBe(2);
  });

  it("rotar el secreto invalida la cache", async () => {
    let secret = TEST_CLIENT_SECRET;
    const source = sourceWith(async () => ({ clientId: "service-t1", clientSecret: secret }));
    await source.tokenFor(ref);
    secret = "otro-secreto";
    await expect(source.tokenFor(ref)).rejects.toBeInstanceOf(IdentityUnavailableError);
    expect(tokenCalls()).toBe(2);
  });

  it("sin credenciales -> MachineCredentialMissingError", async () => {
    await expect(sourceWith(async () => null).tokenFor(ref)).rejects.toBeInstanceOf(
      MachineCredentialMissingError,
    );
  });

  it("secreto rechazado -> IdentityUnavailableError", async () => {
    const source = sourceWith(async () => ({ clientId: "service-t1", clientSecret: "mal" }));
    await expect(source.tokenFor(ref)).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it("proveedor caido -> IdentityUnavailableError", async () => {
    setFakeIdpDown(true);
    await expect(sourceWith(good).tokenFor(ref)).rejects.toBeInstanceOf(IdentityUnavailableError);
    setFakeIdpDown(false);
  });

  it("token endpoint que no responde -> IdentityUnavailableError por timeout", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const source = createOidcClientCredentials({
      discovery: async () => ({ jwksUri: "https://idp.x/certs", tokenEndpoint: "https://idp.x/t" }),
      resolve: good,
      clock,
      httpTimeoutMs: 20,
      fetchFn: hanging,
    });
    await expect(source.tokenFor(ref)).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it("un token que no pasa la validacion no se entrega ni se cachea", async () => {
    const rejection = new Error("no sirve");
    const source = createOidcClientCredentials({
      discovery,
      resolve: good,
      clock,
      httpTimeoutMs: 5000,
      validate: async () => {
        throw rejection;
      },
    });
    await expect(source.tokenFor(ref)).rejects.toBe(rejection);
    await expect(source.tokenFor(ref)).rejects.toBe(rejection);
    expect(tokenCalls()).toBe(2);
  });

  it("un token cacheado para una clinica no se entrega a otra aunque compartan cliente", async () => {
    const refA = { kind: "service", tenantId: "t1" } as const;
    const refB = { kind: "service", tenantId: "t2" } as const;
    // Mismo cliente para ambas clinicas: el proveedor siempre emite tenant_id t1.
    const shared: MachineCredentialResolver = async () => ({
      clientId: "service-t1",
      clientSecret: TEST_CLIENT_SECRET,
    });
    const source = createOidcClientCredentials({
      discovery,
      resolve: shared,
      clock,
      httpTimeoutMs: 5000,
      validate: async (token, wanted) => {
        if (decodeJwt(token.accessToken).tenant_id !== wanted.tenantId) {
          throw new MachineCredentialMismatchError(wanted.kind);
        }
      },
    });
    const first = await source.tokenFor(refA);
    expect(tokenCalls()).toBe(1);
    const second = source.tokenFor(refB);
    await expect(second).rejects.toBeInstanceOf(MachineCredentialMismatchError);
    expect(tokenCalls()).toBe(2);
    // La clinica propietaria sigue sirviendose de su cache.
    expect(await source.tokenFor(refA)).toBe(first);
    expect(tokenCalls()).toBe(2);
  });

  const wildcard = new Map([["*", { clientId: "service-{tenant}", clientSecret: "s" }]]);

  it("comodin de service", async () => {
    expect(await configServiceResolver(wildcard)({ kind: "service", tenantId: "t9" })).toEqual({
      clientId: "service-t9",
      clientSecret: "s",
    });
  });

  it("la entrada exacta gana al comodin", async () => {
    const map = new Map([
      ["*", { clientId: "service-{tenant}", clientSecret: "s" }],
      ["t9", { clientId: "propio", clientSecret: "x" }],
    ]);
    expect(await configServiceResolver(map)({ kind: "service", tenantId: "t9" })).toEqual({
      clientId: "propio",
      clientSecret: "x",
    });
  });

  it("widget nunca se resuelve desde config", async () => {
    expect(await configServiceResolver(wildcard)({ kind: "widget", tenantId: "t9" })).toBeNull();
  });
});
