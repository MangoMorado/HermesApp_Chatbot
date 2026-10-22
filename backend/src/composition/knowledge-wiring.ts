import type { PrismaClient } from "@prisma/client";
import {
  createCreateKnowledgeEntry,
  createDeleteKnowledgeEntry,
  createGetKnowledgeEntry,
  createListKnowledgeEntries,
  createUpdateKnowledgeEntry,
} from "../modules/knowledge/application/knowledge-entries";
import { createPrismaKnowledgeRepository } from "../modules/knowledge/infrastructure/prisma-knowledge-repository";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";

/** Cableado de la base de conocimiento. Aparte para no pasar de 400 lineas en el root. */

export function knowledgeWritePorts(db: PrismaExecutor, auditLog: AuditLog) {
  const knowledge = createPrismaKnowledgeRepository(db);
  const deps = { repo: knowledge, audit: auditLog, clock: systemClock };
  return {
    knowledge,
    createKnowledgeEntry: createCreateKnowledgeEntry({ ...deps, ids: uuidV7Generator }),
    updateKnowledgeEntry: createUpdateKnowledgeEntry(deps),
    deleteKnowledgeEntry: createDeleteKnowledgeEntry(deps),
  };
}

export function knowledgeReads(prisma: PrismaClient) {
  const knowledge = createPrismaKnowledgeRepository(prisma);
  return {
    listKnowledgeEntries: createListKnowledgeEntries(knowledge),
    getKnowledgeEntry: createGetKnowledgeEntry(knowledge),
  };
}
