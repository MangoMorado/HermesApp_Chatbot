import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createGetCapabilityStatement } from "../modules/fhir/application/get-capability-statement";
import { createReadResource } from "../modules/fhir/application/read-resource";
import { createResourceHandlers } from "../modules/fhir/application/resource-handlers";
import { createSearchResources } from "../modules/fhir/application/search-resources";
import type { FhirSources } from "../modules/fhir/domain/ports/sources";
import { createPrismaMedicalRecordDirectory } from "../modules/patients/infrastructure/prisma-medical-record-directory";
import { createPrismaMedicalRecordRepository } from "../modules/patients/infrastructure/prisma-medical-record-repository";
import type { ExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createPrismaSchedulingDirectory } from "../modules/scheduling/infrastructure/prisma-scheduling-directory";

/**
 * Cumple los puertos de lectura de `fhir` con `scheduling` y `patients`, para que
 * `fhir` no importe ninguno de los dos. Los registros pasan tal cual: las entidades
 * ya tienen la forma que `fhir` declara.
 */
function fhirSources(prisma: PrismaClient, expire: ExpireDueRequests): FhirSources {
  const directory = createPrismaSchedulingDirectory(prisma);
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
      read: (tenantId, id) => directory.getAppointment(tenantId, id),
      search: (tenantId, query) => directory.searchAppointments({ tenantId, ...query }),
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
    },
  };
}

export type FhirReads = ReturnType<typeof fhirReads>;
