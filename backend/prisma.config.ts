import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Config de herramienta: la gobernanza permite leer el entorno aqui.
// El .env local solo se carga si nadie definio DATABASE_URL (p. ej. las pruebas).
if (!process.env.DATABASE_URL && existsSync(".env")) {
  process.loadEnvFile();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
