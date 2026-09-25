import type { PrismaClient } from "@prisma/client";
import {
  type CreateAppointmentRequestCommand,
  createCreateAppointmentRequest,
} from "@/modules/scheduling/application/create-appointment-request";
import {
  createResolveAppointmentRequest,
  type ResolveAppointmentRequestInput,
} from "@/modules/scheduling/application/resolve-appointment-request";
import type { PreAgendaPolicyValues } from "@/modules/scheduling/domain/ports/pre-agenda";
import { createPrismaPreAgendaStore } from "@/modules/scheduling/infrastructure/prisma-pre-agenda-store";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import { uuidV7Generator } from "@/modules/shared/infrastructure/uuid-v7-generator";
import { authedRequest } from "../helpers/token";
import { HERMES_SYSTEM, insertTenant } from "./support";

export const HOUR_MS = 3_600_000;

export type World = {
  readonly slug: string;
  readonly tenantId: TenantId;
  readonly start: Date;
  readonly scheduleId: string;
  /** Cupos libres a start, start+1h, start+2h... (identificador `SL-<slug>-<i>`). */
  readonly freeSlotIds: readonly string[];
  /** Cupo ocupado por la cita en firme (identificador `SL-<slug>-booked`). */
  readonly bookedSlotId: string;
  /** Cita en firme (identificador `AP-<slug>`). */
  readonly appointmentId: string;
  /** Historia clinica (identificador `MR-<slug>`). */
  readonly medicalRecordId: string;
};

function at(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * HOUR_MS);
}

function slotTimes(start: Date, index: number) {
  return { startAt: at(start, index), endAt: at(start, index + 0.5) };
}

async function seedChatbot(prisma: PrismaClient, world: World, freeSlots: number): Promise<void> {
  const { tenantId, slug, start } = world;
  await prisma.practitioner.create({
    data: {
      id: `${tenantId}-prac`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.practitioner,
      identifierValue: `P-${slug}`,
      name: `Prof ${slug}`,
    },
  });
  await prisma.healthcareService.create({
    data: {
      id: `${tenantId}-svc`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.service,
      identifierValue: `S-${slug}`,
      name: `Serv ${slug}`,
    },
  });
  await prisma.schedule.create({
    data: {
      id: world.scheduleId,
      tenantId,
      identifierSystem: HERMES_SYSTEM.schedule,
      identifierValue: `SCH-${slug}`,
      practitionerId: `${tenantId}-prac`,
      healthcareServiceId: `${tenantId}-svc`,
    },
  });
  for (let i = 0; i < freeSlots; i++) {
    await prisma.slot.create({
      data: {
        id: `${tenantId}-slot-${i}`,
        tenantId,
        identifierSystem: HERMES_SYSTEM.slot,
        identifierValue: `SL-${slug}-${i}`,
        scheduleId: world.scheduleId,
        status: "free",
        ...slotTimes(start, i),
      },
    });
  }
  await prisma.slot.create({
    data: {
      id: world.bookedSlotId,
      tenantId,
      identifierSystem: HERMES_SYSTEM.slot,
      identifierValue: `SL-${slug}-booked`,
      scheduleId: world.scheduleId,
      status: "busy",
      ...slotTimes(start, freeSlots),
    },
  });
  await prisma.medicalRecord.create({
    data: {
      id: world.medicalRecordId,
      tenantId,
      identifierSystem: HERMES_SYSTEM.patient,
      identifierValue: `MR-${slug}`,
      documentType: "CC",
      documentNumber: `1000${slug}`,
      givenNames: `Nombre ${slug}`,
      familyNames: `Apellido ${slug}`,
      birthDate: new Date("1990-01-15"),
      status: "active",
    },
  });
  await prisma.appointment.create({
    data: {
      id: world.appointmentId,
      tenantId,
      identifierSystem: HERMES_SYSTEM.appointment,
      identifierValue: `AP-${slug}`,
      medicalRecordId: world.medicalRecordId,
      scheduleId: world.scheduleId,
      slotId: world.bookedSlotId,
      status: "booked",
      ...slotTimes(start, freeSlots),
    },
  });
}

async function seedSimulator(prisma: PrismaClient, world: World, freeSlots: number): Promise<void> {
  const { tenantId, slug, start } = world;
  const sim = `sim-${tenantId}`;
  await prisma.simPractitioner.create({
    data: {
      id: `${sim}-prac`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.practitioner,
      identifierValue: `P-${slug}`,
      name: `Prof ${slug}`,
    },
  });
  await prisma.simHealthcareService.create({
    data: {
      id: `${sim}-svc`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.service,
      identifierValue: `S-${slug}`,
      name: `Serv ${slug}`,
    },
  });
  await prisma.simSchedule.create({
    data: {
      id: `${sim}-sched`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.schedule,
      identifierValue: `SCH-${slug}`,
      practitionerId: `${sim}-prac`,
      healthcareServiceId: `${sim}-svc`,
    },
  });
  for (let i = 0; i < freeSlots; i++) {
    await prisma.simSlot.create({
      data: {
        id: `${sim}-slot-${i}`,
        tenantId,
        identifierSystem: HERMES_SYSTEM.slot,
        identifierValue: `SL-${slug}-${i}`,
        scheduleId: `${sim}-sched`,
        status: "free",
        ...slotTimes(start, i),
      },
    });
  }
  await prisma.simSlot.create({
    data: {
      id: `${sim}-slot-booked`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.slot,
      identifierValue: `SL-${slug}-booked`,
      scheduleId: `${sim}-sched`,
      status: "busy",
      ...slotTimes(start, freeSlots),
    },
  });
  await prisma.simPatient.create({
    data: {
      id: `${sim}-pat`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.patient,
      identifierValue: `MR-${slug}`,
      documentType: "CC",
      documentNumber: `1000${slug}`,
      givenNames: `Nombre ${slug}`,
      familyNames: `Apellido ${slug}`,
      birthDate: new Date("1990-01-15"),
      status: "active",
    },
  });
  await prisma.simAppointment.create({
    data: {
      id: `${sim}-appt`,
      tenantId,
      identifierSystem: HERMES_SYSTEM.appointment,
      identifierValue: `AP-${slug}`,
      patientId: `${sim}-pat`,
      scheduleId: `${sim}-sched`,
      slotId: `${sim}-slot-booked`,
      status: "booked",
      ...slotTimes(start, freeSlots),
    },
  });
}

/** Mundo coherente: los mismos maestros en public y en hermes_sim, con los mismos identificadores. */
export async function seedWorld(
  prisma: PrismaClient,
  slug: string,
  start: Date,
  options: { freeSlots?: number } = {},
): Promise<World> {
  const freeSlots = options.freeSlots ?? 3;
  const tenantId = toTenantId(await insertTenant(prisma, slug));
  const world: World = {
    slug,
    tenantId,
    start,
    scheduleId: `${tenantId}-sched`,
    freeSlotIds: Array.from({ length: freeSlots }, (_, i) => `${tenantId}-slot-${i}`),
    bookedSlotId: `${tenantId}-slot-booked`,
    appointmentId: `${tenantId}-appt`,
    medicalRecordId: `${tenantId}-mr`,
  };
  await seedChatbot(prisma, world, freeSlots);
  await seedSimulator(prisma, world, freeSlots);
  return world;
}

/** Id del cupo libre i-esimo; falla si el mundo no tiene tantos. */
export function slotAt(world: World, index: number): string {
  const id = world.freeSlotIds[index];
  if (id === undefined) {
    throw new Error(`El mundo ${world.slug} no tiene cupo libre ${index}`);
  }
  return id;
}

/** Historias clinicas adicionales (solo en public) para pruebas de concurrencia. */
export async function extraPatients(
  prisma: PrismaClient,
  world: World,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${world.tenantId}-mr-x${i}`;
    await prisma.medicalRecord.create({
      data: {
        id,
        tenantId: world.tenantId,
        identifierSystem: HERMES_SYSTEM.patient,
        identifierValue: `MR-${world.slug}-x${i}`,
        documentType: "CC",
        documentNumber: `2000${i}${world.slug}`,
        givenNames: `Extra ${i}`,
        familyNames: "Prueba",
        birthDate: new Date("1991-02-01"),
        status: "active",
      },
    });
    ids.push(id);
  }
  return ids;
}

export const DEFAULT_POLICY: PreAgendaPolicyValues = { holdMinutes: 240, maxPendingHolds: 2 };
export const ACTOR = { actorSubject: "chat-prueba", actorRole: "widget", requestId: "req-prueba" };
/** Holgura para transacciones concurrentes en las pruebas de carrera. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 };

export type MutableClock = Clock & { set(at: Date): void };

export function clockAt(at: Date): MutableClock {
  let current = at;
  return {
    now: () => current,
    set: (next) => {
      current = next;
    },
  };
}

export function preAgendaDeps(db: PrismaExecutor, clock: Clock) {
  return {
    store: createPrismaPreAgendaStore(db),
    ids: uuidV7Generator,
    clock,
    audit: createPrismaAuditLog(db, uuidV7Generator),
  };
}

export function createRequest(
  prisma: PrismaClient,
  clock: Clock,
  command: CreateAppointmentRequestCommand,
  policy: PreAgendaPolicyValues = DEFAULT_POLICY,
) {
  return prisma.$transaction(
    (tx) =>
      createCreateAppointmentRequest({
        ...preAgendaDeps(tx, clock),
        policy: { read: async () => policy },
      })(command),
    TX_OPTIONS,
  );
}

export function resolveRequest(
  prisma: PrismaClient,
  clock: Clock,
  input: ResolveAppointmentRequestInput,
) {
  return prisma.$transaction(
    (tx) => createResolveAppointmentRequest(preAgendaDeps(tx, clock))(input),
    TX_OPTIONS,
  );
}

let inboxKeyCounter = 0;

/** POST a la bandeja con una `Idempotency-Key` nueva salvo que se pase una. */
export function inboxPost(path: string, token: string, key = `inbox-${inboxKeyCounter++}`) {
  return authedRequest(`http://localhost/api/sim/v1/inbox/${path}`, token, {
    method: "POST",
    headers: { "Idempotency-Key": key },
  });
}
