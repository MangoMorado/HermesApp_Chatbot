import type { PrismaClient } from "@prisma/client";
import { createReadBotParams } from "../modules/bot-config/application/widget-access";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import {
  createApproveInboxRequest,
  createListInbox,
  createRejectInboxRequest,
} from "../modules/hermes-simulator/application/inbox";
import type { InboxRequest } from "../modules/hermes-simulator/domain/inbox";
import type { ChatbotRequestsGateway } from "../modules/hermes-simulator/domain/ports/inbox";
import { createPrismaSimInboxStore } from "../modules/hermes-simulator/infrastructure/prisma-inbox-store";
import {
  createExpireDueRequests,
  createGetAppointmentRequest,
  createListAppointmentRequests,
} from "../modules/scheduling/application/appointment-request-queries";
import { createCreateAppointmentRequest } from "../modules/scheduling/application/create-appointment-request";
import {
  createResolveAppointmentRequest,
  type ResolveAppointmentRequest,
} from "../modules/scheduling/application/resolve-appointment-request";
import type {
  AppointmentRequestView,
  PreAgendaPolicy,
} from "../modules/scheduling/domain/ports/pre-agenda";
import { createPrismaAppointmentRequestReader } from "../modules/scheduling/infrastructure/prisma-appointment-request-reader";
import {
  createPrismaPreAgendaStore,
  createPrismaRequestExpirer,
} from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import { toTenantId } from "../modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "../modules/shared/infrastructure/prisma-audit-log";
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

function toInboxRequest(view: AppointmentRequestView): InboxRequest {
  return {
    id: view.id,
    kind: view.kind,
    status: view.status,
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    resolutionReason: view.resolutionReason,
    patient: view.patient,
    slot: view.slot,
    appointment: view.appointment,
    resultingAppointment: view.resultingAppointment,
  };
}

/** Adaptador en proceso del puerto del simulador. En la Fase 4 lo reemplaza un cliente FHIR. */
function chatbotRequestsGateway(
  db: PrismaExecutor,
  resolve: ResolveAppointmentRequest,
): ChatbotRequestsGateway {
  const reader = createPrismaAppointmentRequestReader(db);
  const expire = createExpireDueRequests({
    expirer: createPrismaRequestExpirer(db),
    clock: systemClock,
  });
  const list = createListAppointmentRequests({ reader, expire });
  const get = createGetAppointmentRequest({ reader, expire });
  return {
    async listPending(filter) {
      const tenantId = toTenantId(filter.tenantId);
      const page = await list({
        tenantId,
        status: "pending",
        cursor: filter.cursor,
        limit: filter.limit,
      });
      return { data: page.data.map(toInboxRequest), nextCursor: page.nextCursor };
    },
    async get(tenantId, id) {
      return toInboxRequest(await get(toTenantId(tenantId), id));
    },
    async resolve(input) {
      const tenantId = toTenantId(input.tenantId);
      await resolve({
        tenantId,
        requestId: input.requestId,
        resolution: input.resolution,
        actor: input.actor,
      });
      return toInboxRequest(await get(tenantId, input.requestId));
    },
  };
}

function resolverFor(db: PrismaExecutor, audit: AuditLog): ResolveAppointmentRequest {
  return createResolveAppointmentRequest({
    store: createPrismaPreAgendaStore(db),
    ids: uuidV7Generator,
    clock: systemClock,
    audit,
  });
}

export function preAgendaReads(prisma: PrismaClient) {
  const resolve = resolverFor(prisma, createPrismaAuditLog(prisma, uuidV7Generator));
  return {
    expireDueRequests: createExpireDueRequests({
      expirer: createPrismaRequestExpirer(prisma),
      clock: systemClock,
    }),
    listInbox: createListInbox({ gateway: chatbotRequestsGateway(prisma, resolve) }),
  };
}

export type PreAgendaReads = ReturnType<typeof preAgendaReads>;

export function preAgendaWritePorts(db: PrismaExecutor, auditLog: AuditLog) {
  const resolveAppointmentRequest = resolverFor(db, auditLog);
  const gateway = chatbotRequestsGateway(db, resolveAppointmentRequest);
  return {
    createAppointmentRequest: createCreateAppointmentRequest({
      store: createPrismaPreAgendaStore(db),
      policy: preAgendaPolicy(db),
      ids: uuidV7Generator,
      clock: systemClock,
      audit: auditLog,
    }),
    resolveAppointmentRequest,
    approveInboxRequest: createApproveInboxRequest({
      gateway,
      store: createPrismaSimInboxStore(db),
      ids: uuidV7Generator,
    }),
    rejectInboxRequest: createRejectInboxRequest({ gateway }),
  };
}
