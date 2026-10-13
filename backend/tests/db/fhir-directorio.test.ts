import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SchedulingDirectory } from "@/modules/scheduling/domain/ports/directory";
import { createPrismaSchedulingDirectory } from "@/modules/scheduling/infrastructure/prisma-scheduling-directory";
import { type TenantId, toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();
const WINDOW = { offset: 0, limit: 50 };

describe("fhir-conformance: lecturas por desplazamiento de scheduling", () => {
  let a: TenantDomainSeed;
  let b: TenantDomainSeed;
  let tenantA: TenantId;
  let directory: SchedulingDirectory;

  beforeEach(async () => {
    await truncateAll(prisma);
    a = await seedTenantDomain(prisma, "a");
    b = await seedTenantDomain(prisma, "b");
    tenantA = toTenantId(a.tenantId);
    directory = createPrismaSchedulingDirectory(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lee por id solo dentro del tenant", async () => {
    expect((await directory.getPractitioner(tenantA, a.practitionerId))?.id).toBe(a.practitionerId);
    expect(await directory.getPractitioner(tenantA, b.practitionerId)).toBeNull();
    expect(await directory.getHealthcareService(tenantA, b.serviceId)).toBeNull();
    expect(await directory.getSchedule(tenantA, b.scheduleId)).toBeNull();
    expect(await directory.getSlot(tenantA, b.freeSlotId)).toBeNull();
    expect(await directory.getAppointment(tenantA, b.appointmentId)).toBeNull();
  });

  it("busca maestros por identificador Hermes y por active", async () => {
    const all = await directory.searchPractitioners({
      tenantId: tenantA,
      identifier: null,
      active: null,
      ...WINDOW,
    });
    expect(all).toMatchObject({ total: 1, data: [{ id: a.practitionerId }] });

    const byIdentifier = await directory.searchHealthcareServices({
      tenantId: tenantA,
      identifier: { system: HERMES_SYSTEM.service, value: "S-a" },
      active: null,
      ...WINDOW,
    });
    expect(byIdentifier.data.map((row) => row.id)).toEqual([a.serviceId]);

    const foreign = await directory.searchHealthcareServices({
      tenantId: tenantA,
      identifier: { system: HERMES_SYSTEM.service, value: "S-b" },
      active: null,
      ...WINDOW,
    });
    expect(foreign).toEqual({ data: [], total: 0 });

    const inactive = await directory.searchPractitioners({
      tenantId: tenantA,
      identifier: null,
      active: false,
      ...WINDOW,
    });
    expect(inactive.total).toBe(0);
  });

  it("busca agendas por profesional y por servicio", async () => {
    const base = { tenantId: tenantA, identifier: null, active: null, ...WINDOW };
    const byPractitioner = await directory.searchSchedules({
      ...base,
      practitionerId: a.practitionerId,
      healthcareServiceId: null,
    });
    expect(byPractitioner.data.map((row) => row.id)).toEqual([a.scheduleId]);

    const byForeignService = await directory.searchSchedules({
      ...base,
      practitionerId: null,
      healthcareServiceId: b.serviceId,
    });
    expect(byForeignService.total).toBe(0);
  });

  it("pagina cupos por inicio y devuelve el total", async () => {
    const base = { tenantId: tenantA, identifier: null, scheduleId: null, status: null, start: [] };
    const first = await directory.searchSlots({ ...base, offset: 0, limit: 1 });
    expect(first.total).toBe(2);
    expect(first.data.map((row) => row.id)).toEqual([a.freeSlotId]);

    const second = await directory.searchSlots({ ...base, offset: 1, limit: 1 });
    expect(second.data.map((row) => row.id)).toEqual([a.busySlotId]);

    const beyond = await directory.searchSlots({ ...base, offset: 5, limit: 1 });
    expect(beyond).toEqual({ data: [], total: 2 });
  });

  it("filtra cupos por estado, agenda y cotas de inicio", async () => {
    const base = { tenantId: tenantA, identifier: null, ...WINDOW };
    const free = await directory.searchSlots({
      ...base,
      scheduleId: a.scheduleId,
      status: "free",
      start: [],
    });
    expect(free.data.map((row) => row.id)).toEqual([a.freeSlotId]);

    const from15 = await directory.searchSlots({
      ...base,
      scheduleId: null,
      status: null,
      start: [
        { op: "ge", at: new Date("2026-06-15T15:00:00.000Z") },
        { op: "lt", at: new Date("2026-06-15T16:00:00.000Z") },
      ],
    });
    expect(from15.data.map((row) => row.id)).toEqual([a.busySlotId]);

    const strictlyAfter = await directory.searchSlots({
      ...base,
      scheduleId: null,
      status: null,
      start: [{ op: "gt", at: new Date("2026-06-15T15:00:00.000Z") }],
    });
    expect(strictlyAfter.total).toBe(0);

    const upTo = await directory.searchSlots({
      ...base,
      scheduleId: null,
      status: null,
      start: [{ op: "le", at: new Date("2026-06-15T14:00:00.000Z") }],
    });
    expect(upTo.data.map((row) => row.id)).toEqual([a.freeSlotId]);
  });

  it("la cita trae el profesional y el servicio de su agenda", async () => {
    expect(await directory.getAppointment(tenantA, a.appointmentId)).toMatchObject({
      id: a.appointmentId,
      slotId: a.busySlotId,
      practitionerId: a.practitionerId,
      healthcareServiceId: a.serviceId,
      status: "booked",
    });
  });

  it("filtra citas por paciente, cupo, estado y fecha", async () => {
    const base = {
      tenantId: tenantA,
      identifier: null,
      medicalRecordId: null,
      slotId: null,
      status: null,
      start: [],
      ...WINDOW,
    };
    const byPatient = await directory.searchAppointments({
      ...base,
      medicalRecordId: a.medicalRecordId,
      slotId: a.busySlotId,
      status: "booked",
    });
    expect(byPatient).toMatchObject({ total: 1, data: [{ id: a.appointmentId }] });

    expect((await directory.searchAppointments({ ...base, status: "cancelled" })).total).toBe(0);
    expect(
      (await directory.searchAppointments({ ...base, medicalRecordId: b.medicalRecordId })).total,
    ).toBe(0);
    expect(
      (
        await directory.searchAppointments({
          ...base,
          start: [{ op: "lt", at: new Date("2026-06-15T15:00:00.000Z") }],
        })
      ).total,
    ).toBe(0);
  });
});
