import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

/**
 * Esta suite hace DROP SCHEMA contra `url`. Si alguien apunta TEST_DATABASE_URL a una base
 * de desarrollo (p. ej. chatbot_dev) para depurar una consulta y luego corre `npm test`,
 * la pierde. Regla: el nombre de la base debe terminar en `_test`.
 */
function assertTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL apunta a la base "${databaseName}", que no termina en "_test". ` +
        "Esta suite borra y recrea el schema de esa base: usa una base dedicada como " +
        "chatbot_test, nunca una de desarrollo.",
    );
  }
}

/** Deja la base de pruebas vacia y con todas las migraciones aplicadas. */
export default async function setup(): Promise<void> {
  assertTestDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    "DROP SCHEMA IF EXISTS hermes_sim CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  await client.end();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
