import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config/env";
import { createPrismaClient } from "../../src/modules/shared/infrastructure/prisma-client";
import { buildSeed } from "./data";
import { todayIn } from "./time";
import { writeChatbot } from "./write-chatbot";
import { writeSimulator } from "./write-simulator";

// Script de herramienta (como prisma.config.ts): la gobernanza permite leer el entorno aqui.
// El .env local solo se carga si nadie definio DATABASE_URL (p. ej. un shell con las vars ya exportadas).
if (!process.env.DATABASE_URL && existsSync(".env")) {
  process.loadEnvFile();
}

function parseAnchor(args: readonly string[]): string | undefined {
  const index = args.indexOf("--anchor");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--anchor debe tener formato YYYY-MM-DD");
  }
  return value;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const anchor = parseAnchor(process.argv.slice(2)) ?? todayIn(config.appTimezone, new Date());
  const tenants = buildSeed(anchor, config.appTimezone);
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await writeChatbot(prisma, tenants);
    await writeSimulator(prisma, tenants);
    process.stdout.write(
      `Seed aplicado con ancla ${anchor}: ${tenants.map((t) => `${t.slug} (${t.id})`).join(", ")}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
