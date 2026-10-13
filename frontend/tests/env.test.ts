import { afterEach, describe, expect, it, vi } from "vitest";
import { publicBackendUrl } from "@/config/env";

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
});
