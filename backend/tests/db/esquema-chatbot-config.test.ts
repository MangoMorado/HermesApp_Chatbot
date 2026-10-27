import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const KEY_A = `wk_${"a".repeat(43)}`;
const KEY_B = `wk_${"b".repeat(43)}`;

describe("alta-chatbot: esquema de configuracion del chatbot", () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantId = await insertTenant(prisma, "a");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("crea las cinco tablas nuevas en public", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename IN ('bot_configs','widget_keys','knowledge_entries','widget_sessions','platform_idempotency_keys')
      ORDER BY tablename`;
    expect(rows.map((row) => row.tablename)).toEqual([
      "bot_configs",
      "knowledge_entries",
      "platform_idempotency_keys",
      "widget_keys",
      "widget_sessions",
    ]);
  });

  it("un tenant no puede tener dos claves vigentes", async () => {
    const now = new Date("2026-09-22T12:00:00Z");
    await prisma.widgetKey.create({ data: { id: "k1", tenantId, key: KEY_A, createdAt: now } });
    await expect(
      prisma.widgetKey.create({ data: { id: "k2", tenantId, key: KEY_B, createdAt: now } }),
    ).rejects.toThrow();

    await prisma.widgetKey.update({
      where: { id: "k1" },
      data: { retiredAt: now, graceUntil: new Date("2026-09-23T12:00:00Z") },
    });
    await prisma.widgetKey.create({ data: { id: "k2", tenantId, key: KEY_B, createdAt: now } });
    expect(await prisma.widgetKey.count()).toBe(2);
  });

  it("una clave no puede tener gracia sin estar retirada", async () => {
    await expect(
      prisma.widgetKey.create({
        data: {
          id: "k1",
          tenantId,
          key: KEY_A,
          createdAt: new Date(),
          graceUntil: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("la sesion del widget no guarda la IP", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'widget_sessions' ORDER BY column_name`;
    expect(rows.map((row) => row.column_name)).toEqual([
      "created_at",
      "expires_at",
      "id",
      "last_seen_at",
      "origin",
      "secret_hash",
      "tenant_id",
    ]);
  });

  it("la posicion de una entrada de la KB no es negativa", async () => {
    await expect(
      prisma.knowledgeEntry.create({
        data: {
          id: "e1",
          tenantId,
          category: "General",
          question: "¿Horario?",
          answer: "De 8 a 5",
          position: -1,
        },
      }),
    ).rejects.toThrow();
  });
});
