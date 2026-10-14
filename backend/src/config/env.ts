/**
 * Unico punto del backend autorizado a leer `process.env`.
 * Cualquier otra capa recibe la configuracion ya validada por inyeccion.
 */

type Environment = "development" | "test" | "production";

export type AppConfig = {
  readonly nodeEnv: Environment;
  readonly databaseUrl: string;
  readonly appTimezone: string;
  readonly hermesSimulatorEnabled: boolean;
  readonly jwt: {
    readonly secret: string;
    readonly issuer: string;
    readonly audience: string;
  };
  readonly platformSecret: string | null;
  readonly trustProxy: boolean;
  /** Base publica de `/fhir` para los enlaces del Bundle. `null`: el origen de la peticion. */
  readonly fhirBaseUrl: string | null;
  /** `handlers` solo lo usan las pruebas, que invocan `/fhir` sin abrir un puerto. */
  readonly fhirGateway: "fetch" | "handlers";
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseEnvironment(value: string): Environment {
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  throw new Error(`NODE_ENV invalido: ${value}`);
}

const MIN_PLATFORM_SECRET_LENGTH = 32;

/** Sin secreto, la superficie de plataforma queda apagada (404). */
function platformSecret(): string | null {
  const value = process.env.PLATFORM_SECRET;
  if (!value) {
    return null;
  }
  if (value.length < MIN_PLATFORM_SECRET_LENGTH) {
    throw new Error(`PLATFORM_SECRET debe tener al menos ${MIN_PLATFORM_SECRET_LENGTH} caracteres`);
  }
  return value;
}

function fhirBaseUrl(): string | null {
  const value = process.env.FHIR_BASE_URL?.trim();
  if (!value) {
    return null;
  }
  if (!isAbsoluteHttpUrl(value)) {
    throw new Error("FHIR_BASE_URL debe ser una URL absoluta http(s), p. ej. https://host/fhir");
  }
  return value.replace(/\/+$/, "");
}

function fhirGateway(): AppConfig["fhirGateway"] {
  const value = optional("FHIR_GATEWAY", "fetch");
  if (value === "fetch" || value === "handlers") {
    return value;
  }
  throw new Error("FHIR_GATEWAY debe ser fetch o handlers");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function loadConfig(): AppConfig {
  const config: AppConfig = {
    nodeEnv: parseEnvironment(optional("NODE_ENV", "development")),
    databaseUrl: required("DATABASE_URL"),
    appTimezone: optional("APP_TIMEZONE", "America/Bogota"),
    hermesSimulatorEnabled: optional("HERMES_SIMULATOR_ENABLED", "false") === "true",
    jwt: {
      secret: required("JWT_SECRET"),
      issuer: optional("JWT_ISSUER", "chatbot-ingenius-360"),
      audience: optional("JWT_AUDIENCE", "chatbot-ingenius-360"),
    },
    platformSecret: platformSecret(),
    trustProxy: optional("TRUST_PROXY", "false") === "true",
    fhirBaseUrl: fhirBaseUrl(),
    fhirGateway: fhirGateway(),
  };
  if (
    config.hermesSimulatorEnabled &&
    config.fhirGateway === "fetch" &&
    config.fhirBaseUrl === null
  ) {
    throw new Error("FHIR_BASE_URL es obligatoria cuando el simulador habla por HTTP");
  }
  return config;
}
