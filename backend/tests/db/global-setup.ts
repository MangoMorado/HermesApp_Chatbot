import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

/** Deja la base de pruebas vacia y con todas las migraciones aplicadas. */
export default async function setup(): Promise<void> {
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
