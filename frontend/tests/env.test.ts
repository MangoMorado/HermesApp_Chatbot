import { afterEach, describe, expect, it, vi } from "vitest";
import { backendUrl, oidcConfig, publicBackendUrl } from "@/config/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuración del frontend", () => {
  it("por defecto apunta al backend local", () => {
    vi.stubEnv("PUBLIC_BACKEND_URL", undefined);
    expect(publicBackendUrl()).toBe("http://localhost:3001");
  });

  it("una variable vacía cae al valor por defecto", () => {
    vi.stubEnv("PUBLIC_BACKEND_URL", "");
    expect(publicBackendUrl()).toBe("http://localhost:3001");
  });

  it("usa PUBLIC_BACKEND_URL y le quita la barra final", () => {
    vi.stubEnv("PUBLIC_BACKEND_URL", "https://api.clinica.co/");
    expect(publicBackendUrl()).toBe("https://api.clinica.co");
  });

  it("backendUrl lee BACKEND_URL o cae al local", () => {
    vi.stubEnv("BACKEND_URL", undefined);
    expect(backendUrl()).toBe("http://localhost:3001");
    vi.stubEnv("BACKEND_URL", "http://backend:3001");
    expect(backendUrl()).toBe("http://backend:3001");
  });

  it("oidcConfig lee issuer y client id en cada llamada", () => {
    vi.stubEnv("PUBLIC_OIDC_ISSUER", "https://idp.x/realms/r/");
    vi.stubEnv("PUBLIC_OIDC_CLIENT_ID", "ui");
    expect(oidcConfig()).toEqual({ issuer: "https://idp.x/realms/r", clientId: "ui" });
    vi.stubEnv("PUBLIC_OIDC_ISSUER", "https://otro.x/realms/r");
    expect(oidcConfig()).toEqual({ issuer: "https://otro.x/realms/r", clientId: "ui" });
  });

  it("oidcConfig es null si falta issuer o client id", () => {
    vi.stubEnv("PUBLIC_OIDC_ISSUER", "https://idp.x/realms/r");
    vi.stubEnv("PUBLIC_OIDC_CLIENT_ID", "");
    expect(oidcConfig()).toBeNull();
    vi.stubEnv("PUBLIC_OIDC_ISSUER", undefined);
    vi.stubEnv("PUBLIC_OIDC_CLIENT_ID", "ui");
    expect(oidcConfig()).toBeNull();
  });
});
