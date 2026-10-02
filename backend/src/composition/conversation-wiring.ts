import type { AppConfig } from "../config/env";
import { createReadBotParams } from "../modules/bot-config/application/widget-access";
import { EMPTY_OVERRIDES, effectiveConfig } from "../modules/bot-config/domain/bot-config";
import type { BotConfigRepository } from "../modules/bot-config/domain/ports/repositories";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import {
  type ConversationDeps,
  createGetConversation,
  createHandleMessage,
} from "../modules/conversation/application/conversation";
import type { ConversationConfigReader } from "../modules/conversation/domain/ports";
import type { ConversationReads } from "../modules/conversation/domain/reads";
import { STEPS } from "../modules/conversation/domain/steps";
import {
  createPrismaConversationReads,
  type PrismaConversationReads,
} from "../modules/conversation/infrastructure/prisma-conversation-reads";
import { createPrismaConversationRepository } from "../modules/conversation/infrastructure/prisma-conversation-repository";
import { createPrismaMessageRepository } from "../modules/conversation/infrastructure/prisma-message-repository";
import { createCreateHandoffTicket } from "../modules/handoff/application/create-handoff-ticket";
import { createPrismaHandoffRepository } from "../modules/handoff/infrastructure/prisma-handoff-repository";
import { searchEntries } from "../modules/knowledge/domain/search";
import { createPreRegisterPatient } from "../modules/patients/application/pre-register-patient";
import { createPrismaMedicalRecordRepository } from "../modules/patients/infrastructure/prisma-medical-record-repository";
import { createExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import type { CreateAppointmentRequest } from "../modules/scheduling/application/create-appointment-request";
import { createPrismaRequestExpirer } from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import { toTenantId } from "../modules/shared/domain/tenant-id";
import { cryptoRandom } from "../modules/shared/infrastructure/crypto-random";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";
import {
  createOpenChallenge,
  createReadChallenge,
  createRecordVerificationAttempt,
} from "../modules/verification/application/verification";
import { createPrismaChallengeRepository } from "../modules/verification/infrastructure/prisma-challenge-repository";
import { createEffectRunner } from "./conversation-effects";

/** Cableado del chat (3.3). Aparte para no empujar composition-root.ts por encima de 400 lineas. */
function configReader(
  configs: BotConfigRepository,
  clinicName: (tenantId: string) => Promise<string>,
): ConversationConfigReader {
  return async (tenantId) => {
    const effective = effectiveConfig((await configs.get(toTenantId(tenantId))) ?? EMPTY_OVERRIDES);
    const texts = Object.fromEntries(
      Object.entries(effective.texts).map(([key, text]) => [key, text.value]),
    );
    return {
      texts,
      clinicName: await clinicName(tenantId),
      params: { kbMaxResults: effective.params.kb_max_results },
    };
  };
}

function readsFor(db: PrismaExecutor, prismaReads: PrismaConversationReads): ConversationReads {
  const readChallenge = createReadChallenge({
    repo: createPrismaChallengeRepository(db),
    clock: systemClock,
  });
  const expire = createExpireDueRequests({
    expirer: createPrismaRequestExpirer(db),
    clock: systemClock,
  });
  return {
    ...prismaReads,
    challenge: (tenantId, id) => readChallenge(toTenantId(tenantId), id),
    async searchKnowledge(tenantId, query, max) {
      const entries = await prismaReads.listActiveKnowledge(tenantId);
      return searchEntries(entries, query, max).map(({ id, question, answer, detail }) => ({
        id,
        question,
        answer,
        detail,
      }));
    },
    async listAvailableSlots(tenantId, filter) {
      await expire(toTenantId(tenantId));
      return prismaReads.listAvailableSlots(tenantId, filter);
    },
  };
}

export function conversationWritePorts(
  db: PrismaExecutor,
  config: AppConfig,
  auditLog: AuditLog,
  createAppointmentRequest: CreateAppointmentRequest,
) {
  const botConfigs = createPrismaBotConfigRepository(db);
  const readParams = createReadBotParams(botConfigs);
  const prismaReads = createPrismaConversationReads(db);
  const challenges = createPrismaChallengeRepository(db);
  const base = { ids: uuidV7Generator, clock: systemClock, audit: auditLog };
  const runEffect = createEffectRunner(db, {
    createAppointmentRequest,
    preRegisterPatient: createPreRegisterPatient({
      ...base,
      repo: createPrismaMedicalRecordRepository(db),
    }),
    createHandoffTicket: createCreateHandoffTicket({
      ...base,
      repo: createPrismaHandoffRepository(db),
    }),
    openChallenge: createOpenChallenge({
      repo: challenges,
      ids: uuidV7Generator,
      clock: systemClock,
    }),
    recordVerificationAttempt: createRecordVerificationAttempt({
      repo: challenges,
      clock: systemClock,
      random: cryptoRandom,
      audit: auditLog,
      policy: async (tenantId) => {
        const params = await readParams(tenantId);
        return {
          maxAttempts: params.verification_max_attempts,
          lockMinutes: params.verification_lock_minutes,
        };
      },
      records: (tenantId, id) => prismaReads.getPatient(tenantId, id),
    }),
  });
  const deps: ConversationDeps = {
    conversations: createPrismaConversationRepository(db),
    messages: createPrismaMessageRepository(db, uuidV7Generator),
    config: configReader(botConfigs, prismaReads.clinicName),
    reads: readsFor(db, prismaReads),
    runEffect,
    clock: systemClock,
    ids: uuidV7Generator,
    random: cryptoRandom,
    timeZone: config.appTimezone,
    steps: STEPS,
  };
  return {
    getConversation: createGetConversation(deps),
    handleConversationMessage: createHandleMessage(deps),
  };
}
