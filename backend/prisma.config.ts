import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Config de herramienta: la gobernanza permite leer el entorno aqui.
// Node carga el .env local sin dependencias extra.
if (existsSync(".env")) {
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
