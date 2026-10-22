import type { PrismaClient } from "@prisma/client";
import { createFindMedicalRecord } from "../modules/patients/application/find-medical-record";
import { createGetMedicalRecord } from "../modules/patients/application/get-medical-record";
import { createListMedicalRecordAppointments } from "../modules/patients/application/list-medical-record-appointments";
import { createPrismaAppointmentHistory } from "../modules/patients/infrastructure/prisma-appointment-history";
import { createPrismaMedicalRecordRepository } from "../modules/patients/infrastructure/prisma-medical-record-repository";

/** Lecturas de historia clinica para el contenedor. Aparte para no pasar de 400 lineas en el root. */

export function patientReads(prisma: PrismaClient) {
  const medicalRecords = createPrismaMedicalRecordRepository(prisma);
  const history = createPrismaAppointmentHistory(prisma);
  return {
    findMedicalRecord: createFindMedicalRecord(medicalRecords),
    getMedicalRecord: createGetMedicalRecord(medicalRecords),
    listMedicalRecordAppointments: createListMedicalRecordAppointments(medicalRecords, history),
  };
}
