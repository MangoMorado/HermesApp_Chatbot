import { describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";

/** Corre `run` con FHIR_BASE_URL fijada y restaura el entorno despues. */
function withFhirBaseUrl<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.FHIR_BASE_URL;
  const required = {
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x",
    JWT_SECRET: process.env.JWT_SECRET ?? "secreto-de-prueba-con-longitud-suficiente",
  };
  const saved = { DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET };
  try {
    Object.assign(process.env, required);
    if (value === undefined) {
      delete process.env.FHIR_BASE_URL;
    } else {
      process.env.FHIR_BASE_URL = value;
    }
    return run();
  } finally {
    for (const [name, original] of Object.entries(saved)) {
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
    if (previous === undefined) {
      delete process.env.FHIR_BASE_URL;
    } else {
      process.env.FHIR_BASE_URL = previous;
    }
  }
}

describe("fhir-conformance: FHIR_BASE_URL", () => {
  it("sin definir o vacia es null: se usa el origen de la peticion", () => {
    expect(withFhirBaseUrl(undefined, () => loadConfig().fhirBaseUrl)).toBeNull();
    expect(withFhirBaseUrl("", () => loadConfig().fhirBaseUrl)).toBeNull();
  });

  it("una URL absoluta se acepta y pierde la barra final", () => {
    expect(withFhirBaseUrl("https://api.clinica.test/fhir/", () => loadConfig().fhirBaseUrl)).toBe(
      "https://api.clinica.test/fhir",
    );
  });

  it("un valor relativo, sin esquema o con otro protocolo impide arrancar", () => {
    for (const value of ["api.clinica.test/fhir", "ftp://x/fhir", "/fhir"]) {
      expect(() => withFhirBaseUrl(value, () => loadConfig()), value).toThrow(/FHIR_BASE_URL/);
    }
  });

  it("con el simulador en fetch, FHIR_BASE_URL es obligatoria", () => {
    const saved = {
      enabled: process.env.HERMES_SIMULATOR_ENABLED,
      gateway: process.env.FHIR_GATEWAY,
    };
    try {
      process.env.HERMES_SIMULATOR_ENABLED = "true";
      process.env.FHIR_GATEWAY = "fetch";
      expect(() => withFhirBaseUrl(undefined, () => loadConfig())).toThrow(/FHIR_BASE_URL/);
      process.env.FHIR_GATEWAY = "handlers";
      expect(withFhirBaseUrl(undefined, () => loadConfig()).fhirGateway).toBe("handlers");
    } finally {
      process.env.HERMES_SIMULATOR_ENABLED = saved.enabled;
      if (saved.gateway === undefined) {
        delete process.env.FHIR_GATEWAY;
      } else {
        process.env.FHIR_GATEWAY = saved.gateway;
      }
    }
  });
});
