import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createConditionalPut } from "../modules/fhir/application/conditional-put";
import { createGetCapabilityStatement } from "../modules/fhir/application/get-capability-statement";
import { createReadResource } from "../modules/fhir/application/read-resource";
import { createResolveById } from "../modules/fhir/application/resolve-by-id";
import { createResourceHandlers } from "../modules/fhir/application/resource-handlers";
import { createSearchResources } from "../modules/fhir/application/search-resources";
import type { AgendaResolver } from "../modules/fhir/domain/ports/agenda";
import type { FhirSources } from "../modules/fhir/domain/ports/sources";
import type { FhirWriters } from "../modules/fhir/domain/ports/writers";
import { APPOINTMENT_REQUEST_SYSTEM } from "../modules/fhir/domain/profiles";
import { createUpsertPatientFromHermes } from "../modules/patients/application/upsert-patient-from-hermes";
import { createPrismaMedicalRecordDirectory } from "../modules/patients/infrastructure/prisma-medical-record-directory";
import { createPrismaMedicalRecordRepository } from "../modules/patients/infrastructure/prisma-medical-record-repository";
import type { ExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createResolveAppointmentRequest } from "../modules/scheduling/application/resolve-appointment-request";
import { createResolveFromFhir } from "../modules/scheduling/application/resolve-from-fhir";
import { createUpsertHealthcareServiceFromHermes } from "../modules/scheduling/application/upsert-healthcare-service-from-hermes";
import { createUpsertPractitionerFromHermes } from "../modules/scheduling/application/upsert-practitioner-from-hermes";
import { createUpsertScheduleFromHermes } from "../modules/scheduling/application/upsert-schedule-from-hermes";
import { createUpsertSlotFromHermes } from "../modules/scheduling/application/upsert-slot-from-hermes";
import { createPrismaFhirAgenda } from "../modules/scheduling/infrastructure/prisma-fhir-agenda";
import { createPrismaHermesMasterStore } from "../modules/scheduling/infrastructure/prisma-hermes-masters";
import {
  createPrismaPreAgendaStore,
  createPrismaRequestExpirer,
} from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import { createPrismaSchedulingDirectory } from "../modules/scheduling/infrastructure/prisma-scheduling-directory";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import type { Clock } from "../modules/shared/domain/ports/clock";
import type { IdGenerator } from "../modules/shared/domain/ports/id-generator";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";

/**
 * Cumple los puertos de lectura de `fhir` con `scheduling` y `patients`, para que
 * `fhir` no importe ninguno de los dos. Los registros pasan tal cual: las entidades
 * ya tienen la forma que `fhir` declara.
 */
function fhirSources(prisma: PrismaClient, expire: ExpireDueRequests): FhirSources {
  const directory = createPrismaSchedulingDirectory(prisma);
  const agenda = createPrismaFhirAgenda(prisma, APPOINTMENT_REQUEST_SYSTEM);
  const records = createPrismaMedicalRecordRepository(prisma);
  const recordDirectory = createPrismaMedicalRecordDirectory(prisma);
  return {
    Patient: {
      read: (tenantId, id) => records.get(tenantId, id),
      search: (tenantId, query) => recordDirectory.search({ tenantId, ...query }),
    },
    Practitioner: {
      read: (tenantId, id) => directory.getPractitioner(tenantId, id),
      search: (tenantId, query) => directory.searchPractitioners({ tenantId, ...query }),
    },
    HealthcareService: {
      read: (tenantId, id) => directory.getHealthcareService(tenantId, id),
      search: (tenantId, query) => directory.searchHealthcareServices({ tenantId, ...query }),
    },
    Schedule: {
      read: (tenantId, id) => directory.getSchedule(tenantId, id),
      search: (tenantId, query) => directory.searchSchedules({ tenantId, ...query }),
    },
    // Vencimiento al leer: Hermes nunca ve un apartado vencido como vigente.
    Slot: {
      async read(tenantId, id) {
        await expire(tenantId);
        return directory.getSlot(tenantId, id);
      },
      async search(tenantId, query) {
        await expire(tenantId);
        return directory.searchSlots({ tenantId, ...query });
      },
    },
    Appointment: {
      async read(tenantId, id) {
        await expire(tenantId);
        return agenda.readAppointment(tenantId, id);
      },
      async search(tenantId, query) {
        await expire(tenantId);
        return agenda.searchAppointments({ tenantId, ...query });
      },
    },
    Task: {
      async read(tenantId, id) {
        await expire(tenantId);
        return agenda.readTask(tenantId, id);
      },
      async search(tenantId, query) {
        await expire(tenantId);
        return agenda.searchTasks({ tenantId, ...query });
      },
    },
  };
}

export function fhirReads(prisma: PrismaClient, config: AppConfig, expire: ExpireDueRequests) {
  const handlers = createResourceHandlers(fhirSources(prisma, expire));
  return {
    fhir: {
      readResource: createReadResource(handlers),
      searchResources: createSearchResources(handlers, config.appTimezone),
      getCapabilityStatement: createGetCapabilityStatement(),
      conditionalPut: createConditionalPut,
      resolveById: createResolveById,
    },
  };
}

export type FhirReads = ReturnType<typeof fhirReads>;

export function fhirWritePorts(
  db: PrismaExecutor,
  audit: AuditLog,
  ids: IdGenerator,
  clock: Clock,
) {
  const store = createPrismaHermesMasterStore(db);
  const deps = { store, audit, ids, clock };
  const upserts = {
    upsertPatientFromHermes: createUpsertPatientFromHermes({
      repo: createPrismaMedicalRecordRepository(db),
      audit,
      ids,
      clock,
    }),
    upsertPractitionerFromHermes: createUpsertPractitionerFromHermes(deps),
    upsertHealthcareServiceFromHermes: createUpsertHealthcareServiceFromHermes(deps),
    upsertScheduleFromHermes: createUpsertScheduleFromHermes(deps),
    upsertSlotFromHermes: createUpsertSlotFromHermes({
      ...deps,
      preAgenda: createPrismaPreAgendaStore(db),
    }),
  };
  const fhirWriters: FhirWriters = {
    Patient: upserts.upsertPatientFromHermes,
    Practitioner: upserts.upsertPractitionerFromHermes,
    HealthcareService: upserts.upsertHealthcareServiceFromHermes,
    Schedule: upserts.upsertScheduleFromHermes,
    Slot: upserts.upsertSlotFromHermes,
  };
  return { ...upserts, fhirWriters, fhirAgenda: fhirAgendaOf(db, audit, ids, clock) };
}

function fhirAgendaOf(
  db: PrismaExecutor,
  audit: AuditLog,
  ids: IdGenerator,
  clock: Clock,
): AgendaResolver {
  const agenda = createPrismaFhirAgenda(db, APPOINTMENT_REQUEST_SYSTEM);
  const store = createPrismaPreAgendaStore(db);
  const expirer = createPrismaRequestExpirer(db);
  return {
    expire: (tenantId) => expirer.expireDue(tenantId, clock.now()),
    readAppointment: (tenantId, id) => agenda.readAppointment(tenantId, id),
    readTask: (tenantId, id) => agenda.readTask(tenantId, id),
    resolve: createResolveFromFhir({
      store,
      expirer,
      resolve: createResolveAppointmentRequest({ store, ids, clock, audit }),
      audit,
      clock,
    }),
  };
}

export type FhirWritePorts = ReturnType<typeof fhirWritePorts>;
