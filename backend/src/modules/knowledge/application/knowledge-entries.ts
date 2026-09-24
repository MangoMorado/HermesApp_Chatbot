import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page, parseLimit } from "@/modules/shared/domain/pagination";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { DEFAULT_KNOWLEDGE_ENTRIES } from "../domain/default-entries";
import {
  KNOWLEDGE_LIMITS,
  type KnowledgeEntry,
  mergeEntryPatch,
  parseEntryDraft,
} from "../domain/knowledge-entry";
import type { KnowledgeRepository } from "../domain/ports/knowledge-repository";

type WriteDeps = {
  readonly repo: KnowledgeRepository;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

async function audit(
  deps: WriteDeps,
  input: AuditActor & { tenantId: TenantId },
  action: string,
  id: string,
) {
  await deps.audit.record({
    tenantId: input.tenantId,
    actorSubject: input.actorSubject,
    actorRole: input.actorRole,
    action: `knowledge_entry.${action}`,
    resourceType: "knowledge_entry",
    resourceId: id,
    requestId: input.requestId,
    occurredAt: deps.clock.now(),
  });
}

export type ListKnowledgeInput = {
  readonly tenantId: TenantId;
  readonly category?: string;
  readonly activeRaw?: string | null;
  readonly cursor?: string | null;
  readonly limitRaw?: string | null;
};

/** `null`/`undefined` = sin filtro; cualquier otro valor debe ser "true" o "false". */
function parseActiveFilter(raw: string | null | undefined): boolean | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (raw === "true" || raw === "false") {
    return raw === "true";
  }
  throw new ValidationError('active debe ser "true" o "false"', { field: "active" });
}

export function createListKnowledgeEntries(repo: KnowledgeRepository) {
  return async (input: ListKnowledgeInput): Promise<Page<KnowledgeEntry>> => {
    const limit = parseLimit(input.limitRaw);
    const active = parseActiveFilter(input.activeRaw);
    if (input.cursor) {
      decodeCursor(input.cursor);
    }
    return repo.list({
      tenantId: input.tenantId,
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(active !== undefined ? { active } : {}),
      cursor: input.cursor,
      limit,
    });
  };
}

export function createGetKnowledgeEntry(repo: KnowledgeRepository) {
  return async (tenantId: TenantId, id: string): Promise<KnowledgeEntry> => {
    const entry = await repo.get(tenantId, id);
    if (!entry) {
      throw new NotFoundError();
    }
    return entry;
  };
}

export function createCreateKnowledgeEntry(deps: WriteDeps & { readonly ids: IdGenerator }) {
  return async (
    input: AuditActor & { tenantId: TenantId; raw: unknown },
  ): Promise<KnowledgeEntry> => {
    const draft = parseEntryDraft(input.raw);
    if ((await deps.repo.count(input.tenantId)) >= KNOWLEDGE_LIMITS.entriesPerTenant) {
      throw new ValidationError(
        `La base de conocimiento admite como maximo ${KNOWLEDGE_LIMITS.entriesPerTenant} entradas`,
        { field: "knowledge_entries", max: KNOWLEDGE_LIMITS.entriesPerTenant },
      );
    }
    const created = await deps.repo.create({
      ...draft,
      id: deps.ids.next(),
      tenantId: input.tenantId,
    });
    await audit(deps, input, "created", created.id);
    return created;
  };
}

export function createUpdateKnowledgeEntry(deps: WriteDeps) {
  const getEntry = createGetKnowledgeEntry(deps.repo);
  return async (input: AuditActor & { tenantId: TenantId; id: string; raw: unknown }) => {
    const existing = await getEntry(input.tenantId, input.id);
    const updated = await deps.repo.update({
      ...existing,
      ...mergeEntryPatch(existing, input.raw),
    });
    if (!updated) {
      throw new NotFoundError();
    }
    await audit(deps, input, "updated", input.id);
    return updated;
  };
}

export function createDeleteKnowledgeEntry(deps: WriteDeps) {
  return async (input: AuditActor & { tenantId: TenantId; id: string }): Promise<void> => {
    if (!(await deps.repo.delete(input.tenantId, input.id))) {
      throw new NotFoundError();
    }
    await audit(deps, input, "deleted", input.id);
  };
}

/** Siembra las entradas de ejemplo de un tenant recien dado de alta. */
export function createSeedDefaultKnowledge(deps: { repo: KnowledgeRepository; ids: IdGenerator }) {
  return async (tenantId: TenantId): Promise<void> => {
    for (const draft of DEFAULT_KNOWLEDGE_ENTRIES) {
      await deps.repo.create({ ...draft, id: deps.ids.next(), tenantId });
    }
  };
}
