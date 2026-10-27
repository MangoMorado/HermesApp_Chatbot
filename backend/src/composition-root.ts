import type { PrismaClient } from "@prisma/client";
import { type AuthWiring, authWiring } from "./composition/auth-wiring";
import { botConfigReads, botConfigWritePorts } from "./composition/bot-config-wiring";
import { chatbotRequests } from "./composition/chatbot-requests";
import { conversationWritePorts } from "./composition/conversation-wiring";
import {
  type FhirReads,
  type FhirWritePorts,
  fhirReads,
  fhirWritePorts,
} from "./composition/fhir-wiring";
import { knowledgeReads, knowledgeWritePorts } from "./composition/knowledge-wiring";
import { patientReads } from "./composition/patient-wiring";
import { platformReads, platformWritePorts } from "./composition/platform-wiring";
import {
  type PreAgendaReads,
  preAgendaReads,
  preAgendaWritePorts,
} from "./composition/pre-agenda-wiring";
import { schedulingReads } from "./composition/scheduling-wiring";
import { simReads, simWritePorts } from "./composition/sim-wiring";
import { widgetReads, widgetWritePorts } from "./composition/widget-wiring";
import { type AppConfig, loadConfig } from "./config/env";
import { type CheckHealth, createCheckHealth } from "./modules/health/application/check-health";
import type { ChatbotRequests, HermesSession } from "./modules/hermes-simulator/domain/ports/inbox";
import { createPrismaHermesSession } from "./modules/hermes-simulator/infrastructure/prisma-hermes-session";
import type { AuditLog } from "./modules/shared/domain/ports/audit-log";
import type { Clock } from "./modules/shared/domain/ports/clock";
import type { IdGenerator } from "./modules/shared/domain/ports/id-generator";
import type {
  IdempotencyStore,
  PlatformIdempotencyStore,
} from "./modules/shared/domain/ports/idempotency-store";
import { createPrismaAuditLog } from "./modules/shared/infrastructure/prisma-audit-log";
import {
  createPrismaClient,
  type PrismaExecutor,
} from "./modules/shared/infrastructure/prisma-client";
import { createPrismaIdempotencyStore } from "./modules/shared/infrastructure/prisma-idempotency-store";
import { createPrismaPlatformIdempotencyStore } from "./modules/shared/infrastructure/prisma-platform-idempotency-store";
import { systemClock } from "./modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "./modules/shared/infrastructure/uuid-v7-generator";
import { createUpdateTenantSettings } from "./modules/tenancy/application/tenant-settings";
import type { TenantSettingsRepository } from "./modules/tenancy/domain/ports/tenant-settings-repository";
import { createPrismaTenantSettingsRepository } from "./modules/tenancy/infrastructure/prisma-tenant-settings-repository";

type SimWritePorts = ReturnType<typeof simWritePorts>;
type BotConfigWritePorts = ReturnType<typeof botConfigWritePorts>;
type KnowledgeWritePorts = ReturnType<typeof knowledgeWritePorts>;
type PlatformWritePorts = ReturnType<typeof platformWritePorts>;
type WidgetWritePorts = ReturnType<typeof widgetWritePorts>;
type PreAgendaWritePorts = ReturnType<typeof preAgendaWritePorts>;
type ConversationWritePorts = ReturnType<typeof conversationWritePorts>;

type SchedulingReads = ReturnType<typeof schedulingReads>;
type PatientReads = ReturnType<typeof patientReads>;
type SimReads = ReturnType<typeof simReads>;
type BotConfigReads = ReturnType<typeof botConfigReads>;
type KnowledgeReads = ReturnType<typeof knowledgeReads>;
type PlatformReads = ReturnType<typeof platformReads>;
type WidgetReads = ReturnType<typeof widgetReads>;

export type BaseWritePorts = {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLog: AuditLog;
  readonly idempotencyStore: IdempotencyStore;
  readonly platformIdempotencyStore: PlatformIdempotencyStore;
  readonly tenantSettings: TenantSettingsRepository;
  readonly updateTenantSettings: ReturnType<typeof createUpdateTenantSettings>;
  readonly appTimezone: string;
} & SimWritePorts;

export type WritePorts = BaseWritePorts &
  BotConfigWritePorts &
  KnowledgeWritePorts &
  PlatformWritePorts &
  WidgetWritePorts &
  PreAgendaWritePorts &
  ConversationWritePorts &
  FhirWritePorts;

export type Container = {
  readonly config: AppConfig;
  readonly checkHealth: CheckHealth;
  readonly idempotencyStore: IdempotencyStore;
  readonly platformIdempotencyStore: PlatformIdempotencyStore;
  readonly hermesSimulatorEnabled: boolean;
  readonly withWriteTransaction: <T>(fn: (ports: WritePorts) => Promise<T>) => Promise<T>;
} & AuthWiring &
  PreAgendaReads &
  SchedulingReads &
  PatientReads &
  SimReads &
  BotConfigReads &
  KnowledgeReads &
  PlatformReads &
  WidgetReads &
  FhirReads;

let container: Container | undefined;
let prisma: PrismaClient | undefined;

function buildWritePorts(
  db: PrismaExecutor,
  config: AppConfig,
  chatbot: ChatbotRequests,
  hermes: HermesSession,
): WritePorts {
  const tenantSettings = createPrismaTenantSettingsRepository(db);
  const auditLog = createPrismaAuditLog(db, uuidV7Generator);
  const preAgenda = preAgendaWritePorts(db, auditLog, chatbot, hermes);
  return {
    clock: systemClock,
    ids: uuidV7Generator,
    auditLog,
    idempotencyStore: createPrismaIdempotencyStore(db),
    platformIdempotencyStore: createPrismaPlatformIdempotencyStore(db),
    tenantSettings,
    updateTenantSettings: createUpdateTenantSettings(tenantSettings, auditLog, systemClock),
    ...simWritePorts(db, auditLog),
    appTimezone: config.appTimezone,
    ...botConfigWritePorts(db, config, auditLog),
    ...knowledgeWritePorts(db, auditLog),
    ...platformWritePorts(db, config, auditLog),
    ...widgetWritePorts(db),
    ...preAgenda,
    ...conversationWritePorts(db, config, auditLog, preAgenda.createAppointmentRequest),
    ...fhirWritePorts(db, auditLog, uuidV7Generator, systemClock),
  };
}

/**
 * Composition root unico: ensambla adaptadores concretos con los casos de uso.
 * Los adaptadores de entrada (route handlers) solo leen de aqui.
 */
export function getContainer(): Container {
  if (!container) {
    const config = loadConfig();
    prisma = createPrismaClient(config.databaseUrl);
    const auth = authWiring(prisma, config);
    const chatbot = chatbotRequests(config, auth.oidcDiscovery);
    const hermes = createPrismaHermesSession(prisma);
    const preAgenda = preAgendaReads(prisma, chatbot);

    container = {
      config,
      checkHealth: createCheckHealth(systemClock),
      ...auth,
      idempotencyStore: createPrismaIdempotencyStore(prisma),
      platformIdempotencyStore: createPrismaPlatformIdempotencyStore(prisma),
      hermesSimulatorEnabled: config.hermesSimulatorEnabled,
      ...preAgenda,
      ...schedulingReads(prisma, preAgenda.expireDueRequests),
      ...patientReads(prisma),
      ...simReads(prisma),
      ...botConfigReads(prisma),
      ...knowledgeReads(prisma),
      ...platformReads(prisma),
      ...widgetReads(prisma, config),
      ...fhirReads(prisma, config, preAgenda.expireDueRequests),
      withWriteTransaction: (fn) => {
        if (!prisma) {
          throw new Error("Prisma no inicializado");
        }
        return prisma.$transaction((tx) => fn(buildWritePorts(tx, config, chatbot, hermes)));
      },
    };
  }
  return container;
}

/** Solo para tests: fuerza un contenedor fresco. */
export function resetContainer(): void {
  container = undefined;
  if (prisma) {
    void prisma.$disconnect();
    prisma = undefined;
  }
}
