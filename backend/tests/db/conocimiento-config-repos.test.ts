import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaBotConfigRepository } from "@/modules/bot-config/infrastructure/prisma-bot-config-repository";
import { createPrismaWidgetKeyRepository } from "@/modules/bot-config/infrastructure/prisma-widget-key-repository";
import type { KnowledgeEntry } from "@/modules/knowledge/domain/knowledge-entry";
import { createPrismaKnowledgeRepository } from "@/modules/knowledge/infrastructure/prisma-knowledge-repository";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const configs = createPrismaBotConfigRepository(prisma);
const keys = createPrismaWidgetKeyRepository(prisma);
const knowledge = createPrismaKnowledgeRepository(prisma);
const NOW = new Date("2026-09-22T12:00:00.000Z");

function entry(tenantId: TenantId, id: string, category: string, position: number): KnowledgeEntry {
  return {
    id,
    tenantId,
    category,
    question: `Pregunta ${id}`,
    answer: `Respuesta ${id}`,
    detail: null,
    keywords: ["cita"],
    position,
    active: true,
  };
}

describe("conocimiento-config: repositorios Prisma", () => {
  let tenantA: TenantId;
  let tenantB: TenantId;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantA = toTenantId((await insertChatbotTenant(prisma, "a")).tenantId);
    tenantB = toTenantId((await insertChatbotTenant(prisma, "b")).tenantId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bot-config ida y vuelta, y un tenant inexistente devuelve null", async () => {
    const overrides = {
      texts: { welcome: "Hola" },
      params: { kb_max_results: 5 },
      allowedOrigins: ["https://a.test"],
    };
    expect(await configs.update(tenantA, overrides)).toBe(true);
    expect(await configs.get(tenantA)).toEqual(overrides);
    expect(await configs.get(tenantB)).toEqual({ texts: {}, params: {}, allowedOrigins: [] });
    expect(await configs.get(toTenantId("tenant-x"))).toBeNull();
    expect(await configs.update(toTenantId("tenant-x"), overrides)).toBe(false);
  });

  it("insertar una segunda clave vigente es un conflicto", async () => {
    await expect(
      keys.insert({
        id: "k-extra",
        tenantId: tenantA,
        key: `wk_${"z".repeat(43)}`,
        createdAt: NOW,
        retiredAt: null,
        graceUntil: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("listAccepted incluye la vigente y la que sigue en gracia, no la vencida", async () => {
    const [current] = await keys.listAccepted(tenantA, NOW);
    await keys.retire(tenantA, {
      id: current?.id ?? "",
      retiredAt: NOW,
      graceUntil: new Date(NOW.getTime() + 3_600_000),
    });
    await keys.insert({
      id: "k-new",
      tenantId: tenantA,
      key: `wk_${"n".repeat(43)}`,
      createdAt: NOW,
      retiredAt: null,
      graceUntil: null,
    });
    expect((await keys.listAccepted(tenantA, NOW)).map((k) => k.id).sort()).toEqual(
      ["k-new", current?.id].sort(),
    );
    const later = new Date(NOW.getTime() + 7_200_000);
    expect((await keys.listAccepted(tenantA, later)).map((k) => k.id)).toEqual(["k-new"]);
    expect((await keys.findByKey(`wk_${"n".repeat(43)}`))?.tenantId).toBe(tenantA);
  });

  it("la KB pagina por categoria, posicion e id, y aisla por tenant", async () => {
    await knowledge.create(entry(tenantA, "e3", "Citas", 1));
    await knowledge.create(entry(tenantA, "e1", "Citas", 0));
    await knowledge.create(entry(tenantA, "e2", "Ubicacion", 0));
    await knowledge.create(entry(tenantB, "eb", "Citas", 0));

    const first = await knowledge.list({ tenantId: tenantA, limit: 2 });
    expect(first.data.map((e) => e.id)).toEqual(["e1", "e3"]);
    const second = await knowledge.list({ tenantId: tenantA, limit: 2, cursor: first.nextCursor });
    expect(second.data.map((e) => e.id)).toEqual(["e2"]);
    expect(second.nextCursor).toBeNull();

    expect(await knowledge.get(tenantA, "eb")).toBeNull();
    expect(await knowledge.count(tenantA)).toBe(3);
    expect(await knowledge.delete(tenantA, "eb")).toBe(false);
    expect(await knowledge.update({ ...entry(tenantA, "eb", "X", 0) })).toBeNull();
  });

  it("la KB filtra por categoria y por activa", async () => {
    await knowledge.create(entry(tenantA, "e1", "Citas", 0));
    await knowledge.create({ ...entry(tenantA, "e2", "Citas", 1), active: false });
    await knowledge.create(entry(tenantA, "e3", "Ubicacion", 0));

    const citas = await knowledge.list({ tenantId: tenantA, category: "Citas", limit: 50 });
    expect(citas.data.map((e) => e.id)).toEqual(["e1", "e2"]);
    const activas = await knowledge.list({ tenantId: tenantA, active: true, limit: 50 });
    expect(activas.data.map((e) => e.id)).toEqual(["e1", "e3"]);
  });
});
