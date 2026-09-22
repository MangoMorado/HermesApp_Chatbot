import type { PrismaClient } from "@prisma/client";
import { type AppConfig, loadConfig } from "./config/env";
import { type Authenticate, createAuthenticate } from "./modules/auth/application/authenticate";
import { createJoseTokenVerifier } from "./modules/auth/infrastructure/jose-token-verifier";
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
import { createFindMedicalRecord } from "./modules/patients/application/find-medical-record";
import { createGetMedicalRecord } from "./modules/patients/application/get-medical-record";
import { createListMedicalRecordAppointments } from "./modules/patients/application/list-medical-record-appointments";
import { createPrismaAppointmentHistory } from "./modules/patients/infrastructure/prisma-appointment-history";
import { createPrismaMedicalRecordRepository } from "./modules/patients/infrastructure/prisma-medical-record-repository";
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
import type { IdempotencyStore } from "./modules/shared/domain/ports/idempotency-store";
import { createPrismaAuditLog } from "./modules/shared/infrastructure/prisma-audit-log";
import { createPrismaClient } from "./modules/shared/infrastructure/prisma-client";
import { createPrismaIdempotencyStore } from "./modules/shared/infrastructure/prisma-idempotency-store";
import { systemClock } from "./modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "./modules/shared/infrastructure/uuid-v7-generator";
import {
  createGetTenantSettings,
  createUpdateTenantSettings,
} from "./modules/tenancy/application/tenant-settings";
import type { TenantSettingsRepository } from "./modules/tenancy/domain/ports/tenant-settings-repository";
import { createPrismaTenantSettingsRepository } from "./modules/tenancy/infrastructure/prisma-tenant-settings-repository";

export type WritePorts = {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLog: AuditLog;
  readonly idempotencyStore: IdempotencyStore;
  readonly tenantSettings: TenantSettingsRepository;
  readonly updateTenantSettings: ReturnType<typeof createUpdateTenantSettings>;
  readonly simPractitioners: SimPractitionerStore;
  readonly simServices: SimHealthcareServiceStore;
  readonly simSchedules: SimScheduleStore;
  readonly simPatients: SimPatientStore;
  readonly generateSimSlots: ReturnType<typeof createGenerateSimSlots>;
  readonly appTimezone: string;
};

export type Container = {
  readonly config: AppConfig;
  readonly checkHealth: CheckHealth;
  readonly authenticate: Authenticate;
  readonly idempotencyStore: IdempotencyStore;
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
  readonly withWriteTransaction: <T>(fn: (ports: WritePorts) => Promise<T>) => Promise<T>;
};

let container: Container | undefined;
let prisma: PrismaClient | undefined;

function buildWritePorts(
  db: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  appTimezone: string,
): WritePorts {
  const tenantSettings = createPrismaTenantSettingsRepository(db);
  const auditLog = createPrismaAuditLog(db, uuidV7Generator);
  const idempotencyStore = createPrismaIdempotencyStore(db);
  const simSchedules = createPrismaSimScheduleStore(db);
  return {
    clock: systemClock,
    ids: uuidV7Generator,
    auditLog,
    idempotencyStore,
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
    appTimezone,
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
    const tenantSettings = createPrismaTenantSettingsRepository(prisma);
    const practitioners = createPrismaPractitionerRepository(prisma);
    const services = createPrismaHealthcareServiceRepository(prisma);
    const schedules = createPrismaScheduleRepository(prisma);
    const slots = createPrismaSlotRepository(prisma);
    const appointments = createPrismaAppointmentRepository(prisma);
    const medicalRecords = createPrismaMedicalRecordRepository(prisma);
    const history = createPrismaAppointmentHistory(prisma);
    const simPractitioners = createPrismaSimPractitionerStore(prisma);
    const simServices = createPrismaSimHealthcareServiceStore(prisma);
    const simSchedules = createPrismaSimScheduleStore(prisma);
    const simPatients = createPrismaSimPatientStore(prisma);

    container = {
      config,
      checkHealth: createCheckHealth(systemClock),
      authenticate: createAuthenticate(createJoseTokenVerifier(config.jwt)),
      idempotencyStore: createPrismaIdempotencyStore(prisma),
      listPractitioners: createListPractitioners(practitioners),
      listHealthcareServices: createListHealthcareServices(services),
      listSchedules: createListSchedules(schedules),
      listAvailability: createListAvailability(slots, tenantSettings),
      listScheduleSlots: createListScheduleSlots(schedules, slots, tenantSettings),
      listAppointments: createListAppointments(schedules, appointments, tenantSettings),
      findMedicalRecord: createFindMedicalRecord(medicalRecords),
      getMedicalRecord: createGetMedicalRecord(medicalRecords),
      listMedicalRecordAppointments: createListMedicalRecordAppointments(medicalRecords, history),
      getTenantSettings: createGetTenantSettings(tenantSettings),
      hermesSimulatorEnabled: config.hermesSimulatorEnabled,
      listSimPractitioners: (filter) => simPractitioners.list(filter),
      getSimPractitioner: (tenantId, id) => simPractitioners.get(tenantId, id),
      listSimServices: (filter) => simServices.list(filter),
      getSimService: (tenantId, id) => simServices.get(tenantId, id),
      listSimSchedules: (filter) => simSchedules.list(filter),
      getSimSchedule: (tenantId, id) => simSchedules.get(tenantId, id),
      listSimPatients: (filter) => simPatients.list(filter),
      getSimPatient: (tenantId, id) => simPatients.get(tenantId, id),
      withWriteTransaction: (fn) => {
        if (!prisma) {
          throw new Error("Prisma no inicializado");
        }
        return prisma.$transaction((tx) => fn(buildWritePorts(tx, config.appTimezone)));
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
