/**
 * Unico punto del backend autorizado a leer `process.env`.
 * Cualquier otra capa recibe la configuracion ya validada por inyeccion.
 */

type Environment = "development" | "test" | "production";

export type AppConfig = {
  readonly nodeEnv: Environment;
  readonly databaseUrl: string;
  readonly appTimezone: string;
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

export function loadConfig(): AppConfig {
  return {
    nodeEnv: parseEnvironment(optional("NODE_ENV", "development")),
    databaseUrl: required("DATABASE_URL"),
    appTimezone: optional("APP_TIMEZONE", "America/Bogota"),
  };
}
