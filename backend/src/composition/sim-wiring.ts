import type { PrismaClient } from "@prisma/client";
import {
  createPrismaSimHealthcareServiceStore,
  createPrismaSimPatientStore,
  createPrismaSimPractitionerStore,
  createPrismaSimScheduleStore,
} from "../modules/hermes-simulator/infrastructure/prisma-stores";

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
