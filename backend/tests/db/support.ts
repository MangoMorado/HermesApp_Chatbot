import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@/modules/shared/infrastructure/prisma-client";

// Base dedicada a las suites. Por defecto, el Postgres local de desarrollo.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

export function testPrisma(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

/** Vacia todas las tablas de ambos schemas, sin tocar el historial de migraciones. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_tables
    WHERE schemaname IN ('public', 'hermes_sim') AND tablename <> '_prisma_migrations'`;
  if (rows.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((row) => row.name).join(", ")} CASCADE`);
  }
}

export async function insertTenant(prisma: PrismaClient, slug: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { id: `tenant-${slug}`, slug, name: `Tenant ${slug}` },
  });
  return tenant.id;
}
