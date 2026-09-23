import { decodeCursor, toPage } from "@/modules/shared/domain/pagination";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { KnowledgeEntry } from "../domain/knowledge-entry";
import type { KnowledgeRepository } from "../domain/ports/knowledge-repository";

type Row = Omit<KnowledgeEntry, "tenantId"> & {
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapEntry(row: Row): KnowledgeEntry {
  return {
    id: row.id,
    tenantId: toTenantId(row.tenantId),
    category: row.category,
    question: row.question,
    answer: row.answer,
    detail: row.detail,
    keywords: row.keywords,
    position: row.position,
    active: row.active,
  };
}

function toData(entry: KnowledgeEntry) {
  return {
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    detail: entry.detail,
    keywords: [...entry.keywords],
    position: entry.position,
    active: entry.active,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** La clave de orden del cursor es `[category, position]`. */
function parseSortKey(key: string): [string, number] {
  const parsed = safeJson(key);
  if (Array.isArray(parsed) && typeof parsed[0] === "string" && Number.isInteger(parsed[1])) {
    return [parsed[0], parsed[1] as number];
  }
  throw new ValidationError("cursor invalido", { field: "cursor" });
}

function afterCursor(cursor: string | null | undefined) {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  const [category, order] = parseSortKey(position.key);
  return {
    OR: [
      { category: { gt: category } },
      { category, position: { gt: order } },
      { category, position: order, id: { gt: position.id } },
    ],
  };
}

export function createPrismaKnowledgeRepository(db: PrismaExecutor): KnowledgeRepository {
  async function get(tenantId: string, id: string) {
    const row = await db.knowledgeEntry.findFirst({ where: { tenantId, id } });
    return row ? mapEntry(row) : null;
  }

  return {
    async list(filter) {
      const rows = await db.knowledgeEntry.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.category !== undefined ? { category: filter.category } : {}),
          ...(filter.active !== undefined ? { active: filter.active } : {}),
          ...afterCursor(filter.cursor),
        },
        orderBy: [{ category: "asc" }, { position: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return toPage(rows.map(mapEntry), filter.limit, (entry) => ({
        key: JSON.stringify([entry.category, entry.position]),
        id: entry.id,
      }));
    },
    get,
    count: (tenantId) => db.knowledgeEntry.count({ where: { tenantId } }),
    async create(entry) {
      const row = await db.knowledgeEntry.create({
        data: { id: entry.id, tenantId: entry.tenantId, ...toData(entry) },
      });
      return mapEntry(row);
    },
    async update(entry) {
      const result = await db.knowledgeEntry.updateMany({
        where: { tenantId: entry.tenantId, id: entry.id },
        data: toData(entry),
      });
      return result.count === 0 ? null : get(entry.tenantId, entry.id);
    },
    async delete(tenantId, id) {
      const result = await db.knowledgeEntry.deleteMany({ where: { tenantId, id } });
      return result.count > 0;
    },
  };
}
