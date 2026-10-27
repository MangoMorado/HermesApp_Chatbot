import type { PrismaClient } from "@prisma/client";
import { createAesGcmSecretBox } from "@/modules/shared/infrastructure/aes-gcm-secret-box";
import { createPrismaClient } from "@/modules/shared/infrastructure/prisma-client";
import { TEST_CLIENT_SECRET } from "../helpers/idp";

// Base dedicada a las suites. Por defecto, el Postgres local de desarrollo.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

export const HERMES_SYSTEM = {
  practitioner: "urn:hermes:practitioner",
  service: "urn:hermes:healthcare-service",
  schedule: "urn:hermes:schedule",
  slot: "urn:hermes:slot",
  patient: "urn:hermes:patient",
  appointment: "urn:hermes:appointment",
} as const;

export function testPrisma(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

/** Vacia todas las tablas de ambos schemas, sin tocar el historial de migraciones. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_tables
    WHERE schemaname IN ('public', 'hermes_sim') AND tablename <> '_prisma_migrations'`;
  if (rows.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((row) => row.name).join(", ")} CASCADE`);
  }
}

export async function insertTenant(prisma: PrismaClient, slug: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { id: `tenant-${slug}`, slug, name: `Tenant ${slug}` },
  });
  return tenant.id;
}

export type TenantDomainSeed = {
  readonly tenantId: string;
  readonly practitionerId: string;
  readonly serviceId: string;
  readonly scheduleId: string;
  readonly freeSlotId: string;
  readonly busySlotId: string;
  readonly medicalRecordId: string;
  readonly appointmentId: string;
  readonly documentType: "CC";
  readonly documentNumber: string;
  readonly from: string;
  readonly to: string;
};

/**
 * Semilla mínima coherente por tenant para pruebas HTTP de aislamiento.
 * Fechas fijas en UTC para no depender del reloj.
 */
export async function seedTenantDomain(
  prisma: PrismaClient,
  slug: string,
): Promise<TenantDomainSeed> {
  const tenantId = await insertTenant(prisma, slug);
  const prefix = tenantId;
  const start = new Date("2026-06-15T14:00:00.000Z");
  const end = new Date("2026-06-15T14:30:00.000Z");
  const busyStart = new Date("2026-06-15T15:00:00.000Z");
  const busyEnd = new Date("2026-06-15T15:30:00.000Z");

  const practitioner = await prisma.practitioner.create({
    data: {
      id: `${prefix}-prac`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.practitioner,
      identifierValue: `P-${slug}`,
      name: `Prof ${slug}`,
    },
  });
  const service = await prisma.healthcareService.create({
    data: {
      id: `${prefix}-svc`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.service,
      identifierValue: `S-${slug}`,
      name: `Serv ${slug}`,
    },
  });
  const schedule = await prisma.schedule.create({
    data: {
      id: `${prefix}-sched`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.schedule,
      identifierValue: `SCH-${slug}`,
      practitionerId: practitioner.id,
      healthcareServiceId: service.id,
    },
  });
  const freeSlot = await prisma.slot.create({
    data: {
      id: `${prefix}-slot-free`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.slot,
      identifierValue: `SL-FREE-${slug}`,
      scheduleId: schedule.id,
      startAt: start,
      endAt: end,
      status: "free",
    },
  });
  const busySlot = await prisma.slot.create({
    data: {
      id: `${prefix}-slot-busy`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.slot,
      identifierValue: `SL-BUSY-${slug}`,
      scheduleId: schedule.id,
      startAt: busyStart,
      endAt: busyEnd,
      status: "busy",
    },
  });
  const documentNumber = `1000${slug}`;
  const record = await prisma.medicalRecord.create({
    data: {
      id: `${prefix}-mr`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.patient,
      identifierValue: `MR-${slug}`,
      documentType: "CC",
      documentNumber,
      givenNames: `Nombre ${slug}`,
      familyNames: `Apellido ${slug}`,
      birthDate: new Date("1990-01-15"),
      status: "active",
    },
  });
  const appointment = await prisma.appointment.create({
    data: {
      id: `${prefix}-appt`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.appointment,
      identifierValue: `AP-${slug}`,
      medicalRecordId: record.id,
      scheduleId: schedule.id,
      slotId: busySlot.id,
      startAt: busyStart,
      endAt: busyEnd,
      status: "booked",
    },
  });

  return {
    tenantId,
    practitionerId: practitioner.id,
    serviceId: service.id,
    scheduleId: schedule.id,
    freeSlotId: freeSlot.id,
    busySlotId: busySlot.id,
    medicalRecordId: record.id,
    appointmentId: appointment.id,
    documentType: "CC",
    documentNumber,
    from: "2026-06-15",
    to: "2026-06-16",
  };
}

export type ChatbotTenantSeed = { readonly tenantId: string; readonly widgetKey: string };

/**
 * Guarda la credencial del cliente widget del proveedor falso (`widget-<tenantId>`), sellada
 * con la misma clave que usa el contenedor en las suites.
 */
export async function insertWidgetCredential(
  prisma: PrismaClient,
  tenantId: string,
  clientId = `widget-${tenantId}`,
): Promise<void> {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? "", "base64");
  const now = new Date();
  await prisma.machineCredential.create({
    data: {
      tenantId,
      kind: "widget",
      clientId,
      secretSealed: createAesGcmSecretBox(key).seal(TEST_CLIENT_SECRET),
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * Tenant con bot-config vacio y una clave vigente, como lo deja el alta. Por defecto con
 * credenciales de widget; `widgetClient: false` simula una clinica sin configurar.
 */
export async function insertChatbotTenant(
  prisma: PrismaClient,
  slug: string,
  options: { allowedOrigins?: string[]; widgetClient?: boolean } = {},
): Promise<ChatbotTenantSeed> {
  const tenantId = await insertTenant(prisma, slug);
  const widgetKey = `wk_${slug.repeat(43).slice(0, 43)}`;
  await prisma.botConfig.create({
    data: { tenantId, allowedOrigins: options.allowedOrigins ?? [] },
  });
  await prisma.widgetKey.create({
    data: { id: `${tenantId}-key`, tenantId, key: widgetKey, createdAt: new Date() },
  });
  if (options.widgetClient !== false) {
    await insertWidgetCredential(prisma, tenantId);
  }
  return { tenantId, widgetKey };
}
