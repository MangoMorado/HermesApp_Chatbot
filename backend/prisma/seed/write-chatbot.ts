import type { Prisma, PrismaClient } from "@prisma/client";
import { type SeedTenant, IDENTIFIER_SYSTEMS as SYS } from "./data";

type Tx = Prisma.TransactionClient;

/**
 * Borra lo que ya exista de estos tenants antes de volver a insertar. Sin esto, sembrar
 * con un ancla distinta deja cupos y citas de la fecha anterior huerfanos (cupos "busy"
 * sin cita que los referencie). Orden de FK: citas -> cupos -> agendas -> servicios ->
 * profesionales -> historias clinicas. Los tenants no se borran, solo se refrescan.
 */
async function deleteExisting(tx: Tx, tenantIds: string[]): Promise<void> {
  await tx.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await tx.slot.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await tx.schedule.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await tx.healthcareService.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await tx.practitioner.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await tx.medicalRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
}

async function writeMasters(tx: Tx, t: SeedTenant): Promise<void> {
  for (const p of t.practitioners) {
    const data = {
      id: p.id,
      tenantId: t.id,
      identifierSystem: SYS.practitioner,
      identifierValue: p.identifierValue,
      name: p.name,
    };
    await tx.practitioner.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const s of t.services) {
    const data = {
      id: s.id,
      tenantId: t.id,
      identifierSystem: SYS.healthcareService,
      identifierValue: s.identifierValue,
      name: s.name,
    };
    await tx.healthcareService.upsert({ where: { id: s.id }, create: data, update: data });
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
    await tx.schedule.upsert({ where: { id: s.id }, create: data, update: data });
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
    await tx.slot.upsert({ where: { id: s.id }, create: data, update: data });
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
    await tx.medicalRecord.upsert({ where: { id: p.id }, create: data, update: data });
  }
  for (const a of t.appointments) {
    const data = {
      id: a.id,
      tenantId: t.id,
      identifierSystem: SYS.appointment,
      identifierValue: a.identifierValue,
      medicalRecordId: a.patientId,
      scheduleId: a.scheduleId,
      slotId: a.slotId,
      startAt: a.startAt,
      endAt: a.endAt,
      status: a.status,
    };
    await tx.appointment.upsert({ where: { id: a.id }, create: data, update: data });
  }
}

/** Siembra las tablas del chatbot (schema public). Idempotente por id. */
export async function writeChatbot(
  prisma: PrismaClient,
  tenants: readonly SeedTenant[],
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await deleteExisting(
        tx,
        tenants.map((t) => t.id),
      );
      for (const t of tenants) {
        const data = { id: t.id, slug: t.slug, name: t.name };
        await tx.tenant.upsert({ where: { id: t.id }, create: data, update: data });
        await writeMasters(tx, t);
        await writeAgenda(tx, t);
      }
    },
    { timeout: 120_000 },
  );
}
