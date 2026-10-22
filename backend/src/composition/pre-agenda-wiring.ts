import type { PrismaClient } from "@prisma/client";
import { createReadBotParams } from "../modules/bot-config/application/widget-access";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import {
  createApproveInboxRequest,
  createListInbox,
  createRejectInboxRequest,
} from "../modules/hermes-simulator/application/inbox";
import type {
  ChatbotRequests,
  HermesSession,
} from "../modules/hermes-simulator/domain/ports/inbox";
import { createExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createCreateAppointmentRequest } from "../modules/scheduling/application/create-appointment-request";
import type { PreAgendaPolicy } from "../modules/scheduling/domain/ports/pre-agenda";
import {
  createPrismaPreAgendaStore,
  createPrismaRequestExpirer,
} from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";

/**
 * Cableado de la pre-agenda (3.2) y de la bandeja del simulador. Vive aparte para no
 * empujar `composition-root.ts` por encima del limite de lineas por archivo de logica.
 */

export function preAgendaPolicy(db: PrismaExecutor): PreAgendaPolicy {
  const readParams = createReadBotParams(createPrismaBotConfigRepository(db));
  return {
    async read(tenantId) {
      const params = await readParams(tenantId);
      return {
        holdMinutes: params.request_hold_minutes,
        maxPendingHolds: params.max_pending_requests_per_patient,
      };
    },
  };
}

export function preAgendaReads(prisma: PrismaClient, chatbot: ChatbotRequests) {
  return {
    expireDueRequests: createExpireDueRequests({
      expirer: createPrismaRequestExpirer(prisma),
      clock: systemClock,
    }),
    listInbox: createListInbox({ chatbot }),
  };
}

export type PreAgendaReads = ReturnType<typeof preAgendaReads>;

export function preAgendaWritePorts(
  db: PrismaExecutor,
  auditLog: AuditLog,
  chatbot: ChatbotRequests,
  hermes: HermesSession,
) {
  return {
    createAppointmentRequest: createCreateAppointmentRequest({
      store: createPrismaPreAgendaStore(db),
      policy: preAgendaPolicy(db),
      ids: uuidV7Generator,
      clock: systemClock,
      audit: auditLog,
    }),
    approveInboxRequest: createApproveInboxRequest({
      chatbot,
      session: hermes,
      ids: uuidV7Generator,
    }),
    rejectInboxRequest: createRejectInboxRequest({ chatbot }),
  };
}
