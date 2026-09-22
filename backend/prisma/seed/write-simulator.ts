import type { Prisma, PrismaClient } from "@prisma/client";
import { type SeedTenant, IDENTIFIER_SYSTEMS as SYS } from "./data";

type Tx = Prisma.TransactionClient;

async function writeMasters(tx: Tx, t: SeedTenant): Promise<void> {
  for (const p of t.practitioners) {
    const data = {
      id: p.id,
      tenantId: t.id,
      identifierSystem: SYS.practitioner,
      identifierValue: p.identifierValue,
      name: p.name,
    };
    await tx.simPractitioner.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const s of t.services) {
    const data = {
      id: s.id,
      tenantId: t.id,
      identifierSystem: SYS.healthcareService,
      identifierValue: s.identifierValue,
      name: s.name,
    };
    await tx.simHealthcareService.upsert({ where: { id: s.id }, create: data, update: data });
  }
  for (const s of t.schedules) {
    const data = {
      id: s.id,
      tenantId: t.id,
      identifierSystem: SYS.schedule,
      identifierValue: s.identifierValue,
      practitionerId: s.practitionerId,
      healthcareServiceId: s.healthcareServiceId,
    };
    await tx.simSchedule.upsert({ where: { id: s.id }, create: data, update: data });
  }
}

async function writeAgenda(tx: Tx, t: SeedTenant): Promise<void> {
  for (const s of t.slots) {
    const data = {
      id: s.id,
      tenantId: t.id,
      identifierSystem: SYS.slot,
      identifierValue: s.identifierValue,
      scheduleId: s.scheduleId,
      startAt: s.startAt,
      endAt: s.endAt,
      status: s.status,
    };
    await tx.simSlot.upsert({ where: { id: s.id }, create: data, update: data });
  }
  for (const p of t.patients) {
    const data = {
      id: p.id,
      tenantId: t.id,
      identifierSystem: SYS.patient,
      identifierValue: p.identifierValue,
      documentType: p.documentType,
      documentNumber: p.documentNumber,
      givenNames: p.givenNames,
      familyNames: p.familyNames,
      birthDate: new Date(`${p.birthDate}T00:00:00.000Z`),
      phone: p.phone,
      email: p.email,
      status: p.status,
    };
    await tx.simPatient.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const a of t.appointments) {
    const data = {
      id: a.id,
      tenantId: t.id,
      identifierSystem: SYS.appointment,
      identifierValue: a.identifierValue,
      patientId: a.patientId,
      scheduleId: a.scheduleId,
      slotId: a.slotId,
      startAt: a.startAt,
      endAt: a.endAt,
      status: a.status,
    };
    await tx.simAppointment.upsert({ where: { id: a.id }, create: data, update: data });
  }
}

/** Siembra el schema hermes_sim: los maestros "de Hermes" antes de cualquier sincronizacion. */
export async function writeSimulator(
  prisma: PrismaClient,
  tenants: readonly SeedTenant[],
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const t of tenants) {
        await writeMasters(tx, t);
        await writeAgenda(tx, t);
      }
    },
    { timeout: 120_000 },
  );
}
