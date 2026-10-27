/**
 * Unico punto del backend autorizado a leer `process.env`.
 * Cualquier otra capa recibe la configuracion ya validada por inyeccion.
 */

type Environment = "development" | "test" | "production";

/** Ruta de un claim: segmentos y como elegir el valor final. */
export type ClaimPath = {
  readonly segments: readonly string[];
  readonly pick: "value" | "single-element" | "single-key";
};

/** Roles del producto; la tarea 3 lo sustituye por `Role` del dominio. */
const PRODUCT_ROLES = ["widget", "operator", "admin", "service", "platform"] as const;
type ProductRole = (typeof PRODUCT_ROLES)[number];

export type OidcConfig = {
  readonly issuer: string;
  readonly audience: string;
  readonly tenantClaim: ClaimPath;
  readonly rolesClaim: readonly string[];
  readonly roleMap: ReadonlyMap<string, ProductRole>;
  readonly clockToleranceSeconds: number;
  readonly logoutAudiences: readonly string[];
  readonly maxTokenLifetimeSeconds: number;
};

export type SimServiceClient = { readonly clientId: string; readonly clientSecret: string };

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
  readonly oidc: OidcConfig;
  /** Clave AES de 32 bytes para sellar secretos en reposo. */
  readonly credentialsEncryptionKey: Uint8Array;
  /** Clientes maquina del simulador por tenant; `"*"` es el comodin. Vacio si esta apagado. */
  readonly simServiceClients: ReadonlyMap<string, SimServiceClient>;
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

function parseClaimPath(name: string, raw: string): ClaimPath {
  let text = raw.trim();
  let pick: ClaimPath["pick"] = "value";
  if (text.endsWith("[]")) {
    pick = "single-element";
    text = text.slice(0, -2);
  } else if (text.endsWith("{}")) {
    pick = "single-key";
    text = text.slice(0, -2);
  }
  const segments = text.split(".");
  if (segments.some((segment) => segment === "" || /[[\]{}]/.test(segment))) {
    throw new Error(`${name} invalido: ${raw}`);
  }
  return { segments, pick };
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function isProductRole(value: string): value is ProductRole {
  return (PRODUCT_ROLES as readonly string[]).includes(value);
}

function parseRoleMap(raw: string): ReadonlyMap<string, ProductRole> {
  const map = new Map<string, ProductRole>();
  for (const pair of csv(raw)) {
    const [external, product, ...rest] = pair.split("=").map((part) => part.trim());
    if (!external || !product || rest.length > 0 || !isProductRole(product)) {
      throw new Error(`OIDC_ROLE_MAP invalido: ${pair}`);
    }
    map.set(external, product);
  }
  return map;
}

function positiveInt(name: string, fallback: string): number {
  const value = Number(optional(name, fallback));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un entero no negativo`);
  }
  return value;
}

function oidcConfig(): OidcConfig {
  return {
    issuer: required("OIDC_ISSUER").replace(/\/+$/, ""),
    audience: required("OIDC_AUDIENCE"),
    tenantClaim: parseClaimPath("OIDC_TENANT_CLAIM", optional("OIDC_TENANT_CLAIM", "tenant_id")),
    rolesClaim: parseClaimPath("OIDC_ROLES_CLAIM", optional("OIDC_ROLES_CLAIM", "roles")).segments,
    roleMap: parseRoleMap(optional("OIDC_ROLE_MAP", "")),
    clockToleranceSeconds: positiveInt("OIDC_CLOCK_TOLERANCE_SECONDS", "30"),
    logoutAudiences: csv(optional("OIDC_LOGOUT_AUDIENCES", "")),
    maxTokenLifetimeSeconds: positiveInt("OIDC_MAX_TOKEN_LIFETIME_SECONDS", "300"),
  };
}

const ENCRYPTION_KEY_BYTES = 32;

function credentialsEncryptionKey(): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(required("CREDENTIALS_ENCRYPTION_KEY"), "base64"));
  if (bytes.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY debe tener ${ENCRYPTION_KEY_BYTES} bytes en base64`,
    );
  }
  return bytes;
}

function parseSimClientEntry(tenant: string, entry: unknown): SimServiceClient {
  const record = (entry ?? {}) as Record<string, unknown>;
  const { client_id: clientId, client_secret: clientSecret } = record;
  if (
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    !clientId ||
    !clientSecret
  ) {
    throw new Error(`HERMES_SIM_SERVICE_CLIENTS invalido para ${tenant}`);
  }
  return { clientId, clientSecret };
}

function simServiceClients(enabled: boolean): ReadonlyMap<string, SimServiceClient> {
  if (!enabled) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(required("HERMES_SIM_SERVICE_CLIENTS"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("HERMES_SIM_SERVICE_CLIENTS debe ser JSON valido");
    }
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("HERMES_SIM_SERVICE_CLIENTS debe ser un objeto JSON");
  }
  return new Map(
    Object.entries(parsed).map(([tenant, entry]) => [tenant, parseSimClientEntry(tenant, entry)]),
  );
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
    oidc: oidcConfig(),
    credentialsEncryptionKey: credentialsEncryptionKey(),
    simServiceClients: simServiceClients(optional("HERMES_SIMULATOR_ENABLED", "false") === "true"),
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
