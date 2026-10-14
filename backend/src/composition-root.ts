import type { PrismaClient } from "@prisma/client";
import { conversationWritePorts } from "./composition/conversation-wiring";
import {
  type FhirReads,
  type FhirWritePorts,
  fhirReads,
  fhirWritePorts,
} from "./composition/fhir-wiring";
import {
  type PreAgendaReads,
  preAgendaReads,
  preAgendaWritePorts,
} from "./composition/pre-agenda-wiring";
import { simReads } from "./composition/sim-wiring";
import { widgetReads, widgetWritePorts } from "./composition/widget-wiring";
import { type AppConfig, loadConfig } from "./config/env";
import { type Authenticate, createAuthenticate } from "./modules/auth/application/authenticate";
import { createJoseTokenIssuer } from "./modules/auth/infrastructure/jose-token-issuer";
import { createJoseTokenVerifier } from "./modules/auth/infrastructure/jose-token-verifier";
import {
  createAddAllowedOrigin,
  createRemoveAllowedOrigin,
} from "./modules/bot-config/application/allowed-origins";
import {
  createGetBotConfig,
  createUpdateBotConfig,
  type GetBotConfig,
} from "./modules/bot-config/application/bot-config";
import { createProvisionBotConfig } from "./modules/bot-config/application/provisioning";
import { createRotateWidgetKey } from "./modules/bot-config/application/widget-keys";
import type { OriginPolicy } from "./modules/bot-config/domain/allowed-origins";
import { cryptoWidgetKeyGenerator } from "./modules/bot-config/infrastructure/crypto-widget-key-generator";
import { createPrismaBotConfigRepository } from "./modules/bot-config/infrastructure/prisma-bot-config-repository";
import { createPrismaWidgetKeyRepository } from "./modules/bot-config/infrastructure/prisma-widget-key-repository";
import { type CheckHealth, createCheckHealth } from "./modules/health/application/check-health";
import { createGenerateSimSlots } from "./modules/hermes-simulator/application/generate-slots";
import type {
  SimHealthcareServiceStore,
  SimPatientStore,
  SimPractitionerStore,
  SimScheduleStore,
} from "./modules/hermes-simulator/domain/ports/stores";
import {
  createPrismaSimHealthcareServiceStore,
  createPrismaSimPatientStore,
  createPrismaSimPractitionerStore,
  createPrismaSimScheduleStore,
  createPrismaSimSlotGenerator,
} from "./modules/hermes-simulator/infrastructure/prisma-stores";
import {
  createCreateKnowledgeEntry,
  createDeleteKnowledgeEntry,
  createGetKnowledgeEntry,
  createListKnowledgeEntries,
  createSeedDefaultKnowledge,
  createUpdateKnowledgeEntry,
} from "./modules/knowledge/application/knowledge-entries";
import { createPrismaKnowledgeRepository } from "./modules/knowledge/infrastructure/prisma-knowledge-repository";
import { createFindMedicalRecord } from "./modules/patients/application/find-medical-record";
import { createGetMedicalRecord } from "./modules/patients/application/get-medical-record";
import { createListMedicalRecordAppointments } from "./modules/patients/application/list-medical-record-appointments";
import { createPrismaAppointmentHistory } from "./modules/patients/infrastructure/prisma-appointment-history";
import { createPrismaMedicalRecordRepository } from "./modules/patients/infrastructure/prisma-medical-record-repository";
import { createIssueToken, type IssueToken } from "./modules/platform/application/issue-token";
import { createListTenants, type ListTenants } from "./modules/platform/application/list-tenants";
import { createRegisterTenant } from "./modules/platform/application/register-tenant";
import type { TenantProvisioning } from "./modules/platform/domain/ports/provisioning";
import { createPrismaTenantRegistry } from "./modules/platform/infrastructure/prisma-tenant-registry";
import type { ExpireDueRequests } from "./modules/scheduling/application/appointment-request-queries";
import { createListAppointments } from "./modules/scheduling/application/list-appointments";
import { createListAvailability } from "./modules/scheduling/application/list-availability";
import { createListHealthcareServices } from "./modules/scheduling/application/list-healthcare-services";
import { createListPractitioners } from "./modules/scheduling/application/list-practitioners";
import { createListScheduleSlots } from "./modules/scheduling/application/list-schedule-slots";
import { createListSchedules } from "./modules/scheduling/application/list-schedules";
import { createPrismaAppointmentRepository } from "./modules/scheduling/infrastructure/prisma-appointment-repository";
import { createPrismaHealthcareServiceRepository } from "./modules/scheduling/infrastructure/prisma-healthcare-service-repository";
import { createPrismaPractitionerRepository } from "./modules/scheduling/infrastructure/prisma-practitioner-repository";
import { createPrismaScheduleRepository } from "./modules/scheduling/infrastructure/prisma-schedule-repository";
import { createPrismaSlotRepository } from "./modules/scheduling/infrastructure/prisma-slot-repository";
import type { AuditLog } from "./modules/shared/domain/ports/audit-log";
import type { Clock } from "./modules/shared/domain/ports/clock";
import type { IdGenerator } from "./modules/shared/domain/ports/id-generator";
import type {
  IdempotencyStore,
  PlatformIdempotencyStore,
} from "./modules/shared/domain/ports/idempotency-store";
import type { TenantId } from "./modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "./modules/shared/infrastructure/prisma-audit-log";
import {
  createPrismaClient,
  type PrismaExecutor,
} from "./modules/shared/infrastructure/prisma-client";
import { createPrismaIdempotencyStore } from "./modules/shared/infrastructure/prisma-idempotency-store";
import { createPrismaPlatformIdempotencyStore } from "./modules/shared/infrastructure/prisma-platform-idempotency-store";
import { systemClock } from "./modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "./modules/shared/infrastructure/uuid-v7-generator";
import {
  createGetTenantSettings,
  createUpdateTenantSettings,
} from "./modules/tenancy/application/tenant-settings";
import type { TenantSettingsRepository } from "./modules/tenancy/domain/ports/tenant-settings-repository";
import { createPrismaTenantSettingsRepository } from "./modules/tenancy/infrastructure/prisma-tenant-settings-repository";
import type { AdmitWidget } from "./modules/widget/application/admit-widget";
import type { SessionToken } from "./modules/widget/application/widget-sessions";
import type { WidgetSession } from "./modules/widget/domain/widget-session";

export type BaseWritePorts = {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLog: AuditLog;
  readonly idempotencyStore: IdempotencyStore;
  readonly platformIdempotencyStore: PlatformIdempotencyStore;
  readonly tenantSettings: TenantSettingsRepository;
  readonly updateTenantSettings: ReturnType<typeof createUpdateTenantSettings>;
  readonly simPractitioners: SimPractitionerStore;
  readonly simServices: SimHealthcareServiceStore;
  readonly simSchedules: SimScheduleStore;
  readonly simPatients: SimPatientStore;
  readonly generateSimSlots: ReturnType<typeof createGenerateSimSlots>;
  readonly appTimezone: string;
};

type BotConfigWritePorts = ReturnType<typeof botConfigWritePorts>;
type KnowledgeWritePorts = ReturnType<typeof knowledgeWritePorts>;
type PlatformWritePorts = ReturnType<typeof platformWritePorts>;
type WidgetWritePorts = ReturnType<typeof widgetWritePorts>;
type PreAgendaWritePorts = ReturnType<typeof preAgendaWritePorts>;
type ConversationWritePorts = ReturnType<typeof conversationWritePorts>;

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
  readonly authenticate: Authenticate;
  readonly idempotencyStore: IdempotencyStore;
  readonly platformIdempotencyStore: PlatformIdempotencyStore;
  readonly expireDueRequests: PreAgendaReads["expireDueRequests"];
  readonly listInbox: PreAgendaReads["listInbox"];
  readonly fhir: FhirReads["fhir"];
  readonly listPractitioners: ReturnType<typeof createListPractitioners>;
  readonly listHealthcareServices: ReturnType<typeof createListHealthcareServices>;
  readonly listSchedules: ReturnType<typeof createListSchedules>;
  readonly listAvailability: ReturnType<typeof createListAvailability>;
  readonly listScheduleSlots: ReturnType<typeof createListScheduleSlots>;
  readonly listAppointments: ReturnType<typeof createListAppointments>;
  readonly findMedicalRecord: ReturnType<typeof createFindMedicalRecord>;
  readonly getMedicalRecord: ReturnType<typeof createGetMedicalRecord>;
  readonly listMedicalRecordAppointments: ReturnType<typeof createListMedicalRecordAppointments>;
  readonly getTenantSettings: ReturnType<typeof createGetTenantSettings>;
  readonly hermesSimulatorEnabled: boolean;
  readonly listSimPractitioners: SimPractitionerStore["list"];
  readonly getSimPractitioner: SimPractitionerStore["get"];
  readonly listSimServices: SimHealthcareServiceStore["list"];
  readonly getSimService: SimHealthcareServiceStore["get"];
  readonly listSimSchedules: SimScheduleStore["list"];
  readonly getSimSchedule: SimScheduleStore["get"];
  readonly listSimPatients: SimPatientStore["list"];
  readonly getSimPatient: SimPatientStore["get"];
  readonly getBotConfig: GetBotConfig;
  readonly listKnowledgeEntries: ReturnType<typeof createListKnowledgeEntries>;
  readonly getKnowledgeEntry: ReturnType<typeof createGetKnowledgeEntry>;
  readonly issueToken: IssueToken;
  readonly listTenants: ListTenants;
  readonly admitWidget: AdmitWidget;
  readonly issueSessionToken: (session: WidgetSession) => Promise<SessionToken>;
  readonly getActiveWidgetSession: (
    tenantId: TenantId,
    sessionId: string,
  ) => Promise<WidgetSession>;
  readonly isWidgetOriginRegistered: (origin: string) => Promise<boolean>;
  readonly withWriteTransaction: <T>(fn: (ports: WritePorts) => Promise<T>) => Promise<T>;
};

let container: Container | undefined;
let prisma: PrismaClient | undefined;

function originPolicyOf(config: AppConfig): OriginPolicy {
  return { allowLocalhost: config.nodeEnv !== "production" };
}

function botConfigWritePorts(db: PrismaExecutor, config: AppConfig, auditLog: AuditLog) {
  const botConfigs = createPrismaBotConfigRepository(db);
  const widgetKeys = createPrismaWidgetKeyRepository(db);
  const deps = { configs: botConfigs, keys: widgetKeys, clock: systemClock };
  return {
    botConfigs,
    widgetKeys,
    updateBotConfig: createUpdateBotConfig({
      ...deps,
      audit: auditLog,
      originPolicy: originPolicyOf(config),
    }),
    addAllowedOrigin: createAddAllowedOrigin({
      ...deps,
      audit: auditLog,
      originPolicy: originPolicyOf(config),
    }),
    removeAllowedOrigin: createRemoveAllowedOrigin({
      ...deps,
      audit: auditLog,
      originPolicy: originPolicyOf(config),
    }),
    rotateWidgetKey: createRotateWidgetKey({
      ...deps,
      generator: cryptoWidgetKeyGenerator,
      ids: uuidV7Generator,
      audit: auditLog,
    }),
  };
}

function botConfigReads(prisma: PrismaClient) {
  return {
    getBotConfig: createGetBotConfig({
      configs: createPrismaBotConfigRepository(prisma),
      keys: createPrismaWidgetKeyRepository(prisma),
      clock: systemClock,
    }),
  };
}

function knowledgeWritePorts(db: PrismaExecutor, auditLog: AuditLog) {
  const knowledge = createPrismaKnowledgeRepository(db);
  const deps = { repo: knowledge, audit: auditLog, clock: systemClock };
  return {
    knowledge,
    createKnowledgeEntry: createCreateKnowledgeEntry({ ...deps, ids: uuidV7Generator }),
    updateKnowledgeEntry: createUpdateKnowledgeEntry(deps),
    deleteKnowledgeEntry: createDeleteKnowledgeEntry(deps),
  };
}

function knowledgeReads(prisma: PrismaClient) {
  const knowledge = createPrismaKnowledgeRepository(prisma);
  return {
    listKnowledgeEntries: createListKnowledgeEntries(knowledge),
    getKnowledgeEntry: createGetKnowledgeEntry(knowledge),
  };
}

function platformWritePorts(db: PrismaExecutor, config: AppConfig, auditLog: AuditLog) {
  const provisioning: TenantProvisioning = {
    provisionBotConfig: createProvisionBotConfig({
      configs: createPrismaBotConfigRepository(db),
      keys: createPrismaWidgetKeyRepository(db),
      generator: cryptoWidgetKeyGenerator,
      ids: uuidV7Generator,
      clock: systemClock,
      originPolicy: originPolicyOf(config),
    }),
    seedKnowledge: createSeedDefaultKnowledge({
      repo: createPrismaKnowledgeRepository(db),
      ids: uuidV7Generator,
    }),
  };
  return {
    registerTenant: createRegisterTenant({
      registry: createPrismaTenantRegistry(db),
      provisioning,
      ids: uuidV7Generator,
      audit: auditLog,
      clock: systemClock,
    }),
  };
}

function platformReads(prisma: PrismaClient, config: AppConfig) {
  const registry = createPrismaTenantRegistry(prisma);
  return {
    issueToken: createIssueToken({
      registry,
      issuer: createJoseTokenIssuer(config.jwt),
      audit: createPrismaAuditLog(prisma, uuidV7Generator),
      clock: systemClock,
    }),
    listTenants: createListTenants(registry),
  };
}

function schedulingReads(prisma: PrismaClient, expire: ExpireDueRequests) {
  const tenantSettings = createPrismaTenantSettingsRepository(prisma);
  const practitioners = createPrismaPractitionerRepository(prisma);
  const services = createPrismaHealthcareServiceRepository(prisma);
  const schedules = createPrismaScheduleRepository(prisma);
  const slots = createPrismaSlotRepository(prisma);
  const appointments = createPrismaAppointmentRepository(prisma);
  return {
    listPractitioners: createListPractitioners(practitioners),
    listHealthcareServices: createListHealthcareServices(services),
    listSchedules: createListSchedules(schedules),
    listAvailability: createListAvailability(slots, tenantSettings, expire),
    listScheduleSlots: createListScheduleSlots(schedules, slots, tenantSettings, expire),
    listAppointments: createListAppointments(schedules, appointments, tenantSettings),
    getTenantSettings: createGetTenantSettings(tenantSettings),
  };
}

function patientReads(prisma: PrismaClient) {
  const medicalRecords = createPrismaMedicalRecordRepository(prisma);
  const history = createPrismaAppointmentHistory(prisma);
  return {
    findMedicalRecord: createFindMedicalRecord(medicalRecords),
    getMedicalRecord: createGetMedicalRecord(medicalRecords),
    listMedicalRecordAppointments: createListMedicalRecordAppointments(medicalRecords, history),
  };
}

function buildWritePorts(db: PrismaExecutor, config: AppConfig): WritePorts {
  const tenantSettings = createPrismaTenantSettingsRepository(db);
  const auditLog = createPrismaAuditLog(db, uuidV7Generator);
  const idempotencyStore = createPrismaIdempotencyStore(db);
  const simSchedules = createPrismaSimScheduleStore(db);
  const preAgenda = preAgendaWritePorts(db, auditLog);
  return {
    clock: systemClock,
    ids: uuidV7Generator,
    auditLog,
    idempotencyStore,
    platformIdempotencyStore: createPrismaPlatformIdempotencyStore(db),
    tenantSettings,
    updateTenantSettings: createUpdateTenantSettings(tenantSettings, auditLog, systemClock),
    simPractitioners: createPrismaSimPractitionerStore(db),
    simServices: createPrismaSimHealthcareServiceStore(db),
    simSchedules,
    simPatients: createPrismaSimPatientStore(db),
    generateSimSlots: createGenerateSimSlots(
      simSchedules,
      createPrismaSimSlotGenerator(db, uuidV7Generator),
      auditLog,
      systemClock,
    ),
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
    const preAgenda = preAgendaReads(prisma);

    container = {
      config,
      checkHealth: createCheckHealth(systemClock),
      authenticate: createAuthenticate(createJoseTokenVerifier(config.jwt)),
      idempotencyStore: createPrismaIdempotencyStore(prisma),
      platformIdempotencyStore: createPrismaPlatformIdempotencyStore(prisma),
      hermesSimulatorEnabled: config.hermesSimulatorEnabled,
      ...preAgenda,
      ...schedulingReads(prisma, preAgenda.expireDueRequests),
      ...patientReads(prisma),
      ...simReads(prisma),
      ...botConfigReads(prisma),
      ...knowledgeReads(prisma),
      ...platformReads(prisma, config),
      ...widgetReads(prisma, config),
      ...fhirReads(prisma, config, preAgenda.expireDueRequests),
      withWriteTransaction: (fn) => {
        if (!prisma) {
          throw new Error("Prisma no inicializado");
        }
        return prisma.$transaction((tx) => fn(buildWritePorts(tx, config)));
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
