import { describe, expect, it, vi } from "vitest";
import {
  createCreateKnowledgeEntry,
  createDeleteKnowledgeEntry,
  createGetKnowledgeEntry,
  createListKnowledgeEntries,
  createSeedDefaultKnowledge,
  createUpdateKnowledgeEntry,
} from "@/modules/knowledge/application/knowledge-entries";
import { DEFAULT_KNOWLEDGE_ENTRIES } from "@/modules/knowledge/domain/default-entries";
import type { KnowledgeEntry } from "@/modules/knowledge/domain/knowledge-entry";
import { KNOWLEDGE_LIMITS } from "@/modules/knowledge/domain/knowledge-entry";
import type { KnowledgeRepository } from "@/modules/knowledge/domain/ports/knowledge-repository";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");
const ACTOR = { actorSubject: "admin", actorRole: "admin" as const, requestId: "r1" };

const entry = (overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  id: "ke-1",
  tenantId: TENANT,
  category: "Citas",
  question: "¿Cómo agendo?",
  answer: "Desde este chat.",
  detail: null,
  keywords: ["agendar", "cita"],
  position: 0,
  active: true,
  ...overrides,
});

function repo(overrides: Partial<KnowledgeRepository> = {}): KnowledgeRepository {
  return {
    list: vi.fn(async () => ({ data: [entry()], nextCursor: null })),
    get: vi.fn(async () => entry()),
    count: vi.fn(async () => 1),
    create: vi.fn(async (row) => entry({ id: row.id, ...row })),
    update: vi.fn(async (row) => row),
    delete: vi.fn(async () => true),
    ...overrides,
  };
}

const audit = { record: vi.fn(async () => undefined) };
const clock = { now: () => NOW };
const ids = { next: () => "ke-new" };

describe("conocimiento-config: casos de uso de entradas", () => {
  it("lista con filtros active/category y valida active", async () => {
    const ports = repo();
    const list = createListKnowledgeEntries(ports);
    await list({ tenantId: TENANT, activeRaw: "true", category: "Citas", limitRaw: "10" });
    expect(ports.list).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, category: "Citas", limit: 10 }),
    );
    await expect(list({ tenantId: TENANT, activeRaw: "si" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("get lanza NotFound si no existe", async () => {
    const get = createGetKnowledgeEntry(repo({ get: vi.fn(async () => null) }));
    await expect(get(TENANT, "x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("crea, audita y respeta el tope por tenant", async () => {
    const ports = repo();
    const create = createCreateKnowledgeEntry({ repo: ports, audit, clock, ids });
    const created = await create({
      tenantId: TENANT,
      ...ACTOR,
      raw: {
        category: "Citas",
        question: "¿Cómo agendo?",
        answer: "Desde este chat.",
        keywords: ["agendar"],
      },
    });
    expect(created.id).toBe("ke-new");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "knowledge_entry.created" }),
    );

    const capped = createCreateKnowledgeEntry({
      repo: repo({ count: vi.fn(async () => KNOWLEDGE_LIMITS.entriesPerTenant) }),
      audit,
      clock,
      ids,
    });
    await expect(
      capped({
        tenantId: TENANT,
        ...ACTOR,
        raw: {
          category: "Citas",
          question: "¿Cómo agendo?",
          answer: "Desde este chat.",
          keywords: ["agendar"],
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("actualiza y elimina con auditoria", async () => {
    const ports = repo();
    const update = createUpdateKnowledgeEntry({ repo: ports, audit, clock });
    await update({
      tenantId: TENANT,
      id: "ke-1",
      ...ACTOR,
      raw: { active: false },
    });
    expect(ports.update).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "knowledge_entry.updated" }),
    );

    const remove = createDeleteKnowledgeEntry({ repo: ports, audit, clock });
    await remove({ tenantId: TENANT, id: "ke-1", ...ACTOR });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "knowledge_entry.deleted" }),
    );
  });

  it("update/delete fallan si desaparece la fila", async () => {
    const update = createUpdateKnowledgeEntry({
      repo: repo({ update: vi.fn(async () => null) }),
      audit,
      clock,
    });
    await expect(
      update({ tenantId: TENANT, id: "ke-1", ...ACTOR, raw: { active: false } }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const remove = createDeleteKnowledgeEntry({
      repo: repo({ delete: vi.fn(async () => false) }),
      audit,
      clock,
    });
    await expect(remove({ tenantId: TENANT, id: "ke-1", ...ACTOR })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("siembra las entradas de ejemplo", async () => {
    let n = 0;
    const ports = repo({
      create: vi.fn(async (row) => entry({ id: row.id })),
    });
    const seed = createSeedDefaultKnowledge({
      repo: ports,
      ids: { next: () => `ke-${++n}` },
    });
    await seed(TENANT);
    expect(ports.create).toHaveBeenCalledTimes(DEFAULT_KNOWLEDGE_ENTRIES.length);
  });
});
