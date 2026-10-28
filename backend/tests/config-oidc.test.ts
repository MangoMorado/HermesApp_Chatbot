import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, saved);
});

/** Aplica overrides sobre el entorno de pruebas (`undefined` borra) y carga la config. */
function load(overrides: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  return loadConfig();
}

describe("alta-chatbot: configuracion OIDC", () => {
  it("sin OIDC_ISSUER no arranca", () =>
    expect(() => load({ OIDC_ISSUER: undefined })).toThrow(/OIDC_ISSUER/));

  it("tenant claim con puntos y sufijos", () => {
    expect(load({ OIDC_TENANT_CLAIM: "org.tenant_id" }).oidc.tenantClaim).toEqual({
      segments: ["org", "tenant_id"],
      pick: "value",
    });
    expect(load({ OIDC_TENANT_CLAIM: "organization[]" }).oidc.tenantClaim).toEqual({
      segments: ["organization"],
      pick: "single-element",
    });
    expect(load({ OIDC_TENANT_CLAIM: "organization{}" }).oidc.tenantClaim).toEqual({
      segments: ["organization"],
      pick: "single-key",
    });
  });

  it("un sufijo en medio de la ruta es invalido", () =>
    expect(() => load({ OIDC_TENANT_CLAIM: "a[].b" })).toThrow(/OIDC_TENANT_CLAIM/));

  it("OIDC_ROLE_MAP mapea a roles del producto", () =>
    expect([
      ...load({ OIDC_ROLE_MAP: "clinic-staff=operator,clinic-admin=admin" }).oidc.roleMap,
    ]).toEqual([
      ["clinic-staff", "operator"],
      ["clinic-admin", "admin"],
    ]));

  it("OIDC_ROLE_MAP con rol desconocido no arranca", () =>
    expect(() => load({ OIDC_ROLE_MAP: "x=root" })).toThrow(/OIDC_ROLE_MAP/));

  it("CREDENTIALS_ENCRYPTION_KEY exige 32 bytes", () =>
    expect(() => load({ CREDENTIALS_ENCRYPTION_KEY: "AQID" })).toThrow(/32 bytes/));

  it("con simulador encendido exige HERMES_SIM_SERVICE_CLIENTS", () =>
    expect(() =>
      load({
        HERMES_SIMULATOR_ENABLED: "true",
        FHIR_GATEWAY: "handlers",
        HERMES_SIM_SERVICE_CLIENTS: undefined,
      }),
    ).toThrow(/HERMES_SIM_SERVICE_CLIENTS/));

  it("con simulador encendido parsea el comodin", () => {
    const config = load({ HERMES_SIMULATOR_ENABLED: "true", FHIR_GATEWAY: "handlers" });
    expect(config.simServiceClients.get("*")).toEqual({
      clientId: "service-{tenant}",
      clientSecret: "test-client-secret",
    });
  });

  it("defaults", () =>
    expect(load({ OIDC_LOGOUT_AUDIENCES: undefined }).oidc).toMatchObject({
      rolesClaim: ["roles"],
      clockToleranceSeconds: 30,
      logoutAudiences: [],
      maxTokenLifetimeSeconds: 300,
      httpTimeoutMs: 5000,
    }));

  it("OIDC_ISSUER se guarda tal cual, con o sin barra final", () => {
    expect(load({ OIDC_ISSUER: "https://idp.x/realms/r/" }).oidc.issuer).toBe(
      "https://idp.x/realms/r/",
    );
    expect(load({ OIDC_ISSUER: "https://idp.x/realms/r" }).oidc.issuer).toBe(
      "https://idp.x/realms/r",
    );
  });

  it("OIDC_MAX_TOKEN_LIFETIME_SECONDS=0 no arranca", () =>
    expect(() => load({ OIDC_MAX_TOKEN_LIFETIME_SECONDS: "0" })).toThrow(
      /OIDC_MAX_TOKEN_LIFETIME_SECONDS/,
    ));

  it("OIDC_CLOCK_TOLERANCE_SECONDS=0 sigue siendo valido", () =>
    expect(load({ OIDC_CLOCK_TOLERANCE_SECONDS: "0" }).oidc.clockToleranceSeconds).toBe(0));

  it("OIDC_HTTP_TIMEOUT_MS acepta un entero >= 1", () =>
    expect(load({ OIDC_HTTP_TIMEOUT_MS: "1500" }).oidc.httpTimeoutMs).toBe(1500));

  it.each(["0", "-1", "1.5", "x"])("OIDC_HTTP_TIMEOUT_MS=%s no arranca", (value) =>
    expect(() => load({ OIDC_HTTP_TIMEOUT_MS: value })).toThrow(/OIDC_HTTP_TIMEOUT_MS/),
  );
});
