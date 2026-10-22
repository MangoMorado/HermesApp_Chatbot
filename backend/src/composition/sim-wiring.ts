import type { PrismaClient } from "@prisma/client";
import { createGenerateSimSlots } from "../modules/hermes-simulator/application/generate-slots";
import {
  createPrismaSimHealthcareServiceStore,
  createPrismaSimPatientStore,
  createPrismaSimPractitionerStore,
  createPrismaSimScheduleStore,
  createPrismaSimSlotGenerator,
} from "../modules/hermes-simulator/infrastructure/prisma-stores";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";

/** Lecturas del simulador para el contenedor. Aparte para no pasar de 400 lineas en el root. */
export function simReads(prisma: PrismaClient) {
  const simPractitioners = createPrismaSimPractitionerStore(prisma);
  const simServices = createPrismaSimHealthcareServiceStore(prisma);
  const simSchedules = createPrismaSimScheduleStore(prisma);
  const simPatients = createPrismaSimPatientStore(prisma);
  return {
    listSimPractitioners: simPractitioners.list,
    getSimPractitioner: simPractitioners.get,
    listSimServices: simServices.list,
    getSimService: simServices.get,
    listSimSchedules: simSchedules.list,
    getSimSchedule: simSchedules.get,
    listSimPatients: simPatients.list,
    getSimPatient: simPatients.get,
  };
}

/** Escrituras del simulador dentro de la transaccion de idempotencia. */
export function simWritePorts(db: PrismaExecutor, auditLog: AuditLog) {
  const simSchedules = createPrismaSimScheduleStore(db);
  return {
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
  };
}
