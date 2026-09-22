import { describe, expect, it } from "vitest";
import {
  createGenerateSimSlots,
  enumerateSlotStarts,
} from "@/modules/hermes-simulator/application/generate-slots";
import type { SimSchedule } from "@/modules/hermes-simulator/domain/entities";
import type {
  SimScheduleStore,
  SimSlotGenerator,
} from "@/modules/hermes-simulator/domain/ports/stores";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const tenant = toTenantId("tenant-a");

const schedule: SimSchedule = {
  id: "sch-1",
  tenantId: tenant,
  identifierSystem: "urn:hermes:schedule",
  identifierValue: "SCH-1",
  practitionerId: "p1",
  healthcareServiceId: "s1",
  active: true,
};

const clock: Clock = { now: () => new Date("2026-06-01T12:00:00Z") };
const audit: AuditLog = {
  record: async () => undefined,
};

function schedules(row: SimSchedule | null): SimScheduleStore {
  return {
    list: async () => ({ data: row ? [row] : [], nextCursor: null }),
    get: async (tenantId, id) => (row && row.tenantId === tenantId && row.id === id ? row : null),
    create: async (created) => created,
    update: async () => null,
    delete: async () => "missing",
  };
}

describe("dominio: generateSimSlots", () => {
  it("rechaza duration_minutes invalido y windows vacias", async () => {
    const generator: SimSlotGenerator = { generate: async () => 0 };
    const useCase = createGenerateSimSlots(schedules(schedule), generator, audit, clock);
    await expect(
      useCase({
        tenantId: tenant,
        tenantIdTyped: tenant,
        scheduleId: "sch-1",
        from: "2026-06-15",
        to: "2026-06-16",
        durationMinutes: 1,
        windows: [{ weekday: 1, startTime: "08:00", endTime: "09:00" }],
        timeZone: "America/Bogota",
        actorSubject: "admin",
        actorRole: "admin",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCase({
        tenantId: tenant,
        tenantIdTyped: tenant,
        scheduleId: "sch-1",
        from: "2026-06-15",
        to: "2026-06-16",
        durationMinutes: 30,
        windows: [],
        timeZone: "America/Bogota",
        actorSubject: "admin",
        actorRole: "admin",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("responde not_found si la agenda no existe en el tenant", async () => {
    const generator: SimSlotGenerator = { generate: async () => 0 };
    const useCase = createGenerateSimSlots(schedules(null), generator, audit, clock);
    await expect(
      useCase({
        tenantId: tenant,
        tenantIdTyped: tenant,
        scheduleId: "sch-1",
        from: "2026-06-15",
        to: "2026-06-16",
        durationMinutes: 30,
        windows: [{ weekday: 1, startTime: "08:00", endTime: "09:00" }],
        timeZone: "UTC",
        actorSubject: "admin",
        actorRole: "admin",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("delega en el generador y audita el hecho", async () => {
    const events: string[] = [];
    const auditing: AuditLog = {
      record: async (event) => {
        events.push(event.action);
      },
    };
    const generator: SimSlotGenerator = { generate: async () => 3 };
    const useCase = createGenerateSimSlots(schedules(schedule), generator, auditing, clock);
    const result = await useCase({
      tenantId: tenant,
      tenantIdTyped: tenant,
      scheduleId: "sch-1",
      from: "2026-06-15",
      to: "2026-06-16",
      durationMinutes: 30,
      windows: [{ weekday: 1, startTime: "08:00", endTime: "09:00" }],
      timeZone: "UTC",
      actorSubject: "admin",
      actorRole: "admin",
      requestId: "r1",
    });
    expect(result).toEqual({ created: 3 });
    expect(events).toEqual(["sim.slots.generated"]);
  });

  it("enumerateSlotStarts omite dias fuera de la franja", () => {
    // 2026-06-15 es lunes (weekday 1)
    const starts = enumerateSlotStarts(
      "2026-06-15",
      "2026-06-17",
      60,
      [{ weekday: 1, startTime: "08:00", endTime: "10:00" }],
      "UTC",
    );
    expect(starts).toHaveLength(2);
    expect(starts[0]?.toISOString()).toBe("2026-06-15T08:00:00.000Z");
    expect(starts[1]?.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });
});
