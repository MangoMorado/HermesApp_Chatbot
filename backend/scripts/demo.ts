/**
 * Prepara una demo: siembra datos de prueba si faltan y imprime el tenant_id para pedir un token al proveedor.
 *
 * Uso (contenedor / prod):
 *   cd /app/tools && npm run demo
 *   /app/demo.sh
 *
 * Uso local:
 *   npm run demo -- --local
 *   npm run demo -- --local --tenant clinica-sur --anchor 2026-09-25
 */
import { existsSync } from "node:fs";
import { buildSeed, seedId } from "../prisma/seed/data";
import { todayIn } from "../prisma/seed/time";
import { writeChatbot } from "../prisma/seed/write-chatbot";
import { writeSimulator } from "../prisma/seed/write-simulator";
import { loadConfig } from "../src/config/env";
import { createPrismaClient } from "../src/modules/shared/infrastructure/prisma-client";

const DEMO_SLUGS = ["clinica-norte", "clinica-sur"] as const;
type DemoSlug = (typeof DEMO_SLUGS)[number];

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function parseAnchor(raw: string | undefined, timeZone: string): string {
  if (!raw) {
    return todayIn(timeZone, new Date());
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("--anchor debe tener formato YYYY-MM-DD");
  }
  const normalized = new Date(`${raw}T00:00:00.000Z`).toISOString().slice(0, 10);
  if (normalized !== raw) {
    throw new Error(`--anchor no es una fecha de calendario valida: ${raw}`);
  }
  return raw;
}

function parseSlug(raw: string | undefined): DemoSlug {
  const slug = (raw ?? "clinica-norte") as DemoSlug;
  if (!DEMO_SLUGS.includes(slug)) {
    throw new Error(`--tenant debe ser uno de: ${DEMO_SLUGS.join(", ")}`);
  }
  return slug;
}

function loadEnvIfNeeded(local: boolean): void {
  if (process.env.DATABASE_URL) {
    return;
  }
  if (!local) {
    throw new Error(
      "Falta DATABASE_URL. En el contenedor debe venir del entorno; en local usa --local.",
    );
  }
  if (!existsSync(".env")) {
    throw new Error("Modo --local: no hay backend/.env ni DATABASE_URL.");
  }
  process.loadEnvFile();
}

async function ensureSeed(input: {
  readonly databaseUrl: string;
  readonly anchor: string;
  readonly timeZone: string;
  readonly slug: DemoSlug;
}): Promise<{ readonly tenantId: string; readonly seeded: boolean }> {
  const tenantId = seedId(`tenant:${input.slug}`);
  const prisma = createPrismaClient(input.databaseUrl);
  try {
    const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (existing) {
      return { tenantId, seeded: false };
    }
    const tenants = buildSeed(input.anchor, input.timeZone);
    await writeChatbot(prisma, tenants);
    await writeSimulator(prisma, tenants);
    return { tenantId, seeded: true };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const local = hasFlag("local");
  loadEnvIfNeeded(local);

  const config = loadConfig();
  const slug = parseSlug(arg("tenant"));
  const anchor = parseAnchor(arg("anchor"), config.appTimezone);

  process.stdout.write("Demo — comprobando datos de prueba…\n");
  const { tenantId, seeded } = await ensureSeed({
    databaseUrl: config.databaseUrl,
    anchor,
    timeZone: config.appTimezone,
    slug,
  });

  if (seeded) {
    process.stdout.write(`Seed aplicado (ancla ${anchor}).\n`);
  } else {
    process.stdout.write(`Datos de seed ya presentes; no se resembro.\n`);
  }

  process.stdout.write("\n");
  process.stdout.write(`tenant_slug  ${slug}\n`);
  process.stdout.write(`tenant_id    ${tenantId}\n`);
  process.stdout.write("\n");
  process.stdout.write(
    "Obtén un token del laboratorio (`npm run idp:lab` imprime usuarios y clientes).\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
