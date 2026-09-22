import { describe, expect, it } from "vitest";
import { createListAppointments } from "@/modules/scheduling/application/list-appointments";
import { createListHealthcareServices } from "@/modules/scheduling/application/list-healthcare-services";
import { createListScheduleSlots } from "@/modules/scheduling/application/list-schedule-slots";
import { createListSchedules } from "@/modules/scheduling/application/list-schedules";
import type {
  Appointment,
  HealthcareService,
  Schedule,
  Slot,
} from "@/modules/scheduling/domain/entities";
import type {
  AppointmentRepository,
  HealthcareServiceRepository,
  ScheduleRepository,
  SlotRepository,
} from "@/modules/scheduling/domain/ports/repositories";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, toPage } from "@/modules/shared/domain/pagination";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { TenantSettingsRepository } from "@/modules/tenancy/domain/ports/tenant-settings-repository";

const tenant = toTenantId("tenant-a");

const schedule: Schedule = {
  id: "sch-1",
  tenantId: tenant,
  identifier: { system: "s", value: "1" },
  practitionerId: "p1",
  healthcareServiceId: "svc1",
  active: true,
};

const settings: TenantSettingsRepository = {
  get: async () => ({ maxQueryRangeDays: 14 }),
  update: async () => null,
};

function fakeServices(rows: HealthcareService[]): HealthcareServiceRepository {
  return {
    async list(filter) {
      let data = rows.filter((row) => row.tenantId === filter.tenantId);
      if (filter.active !== undefined) {
        data = data.filter((row) => row.active === filter.active);
      }
      data.sort((a, b) => a.id.localeCompare(b.id));
      if (filter.cursor) {
        const position = decodeCursor(filter.cursor);
        data = data.filter((row) => row.id > position.id);
      }
      return toPage(data.slice(0, filter.limit + 1), filter.limit, (row) => ({
        key: row.id,
        id: row.id,
      }));
    },
  };
}

function fakeSchedules(rows: Schedule[]): ScheduleRepository {
  return {
    async list(filter) {
      let data = rows.filter((row) => row.tenantId === filter.tenantId);
      if (filter.practitionerId) {
        data = data.filter((row) => row.practitionerId === filter.practitionerId);
      }
      if (filter.healthcareServiceId) {
        data = data.filter((row) => row.healthcareServiceId === filter.healthcareServiceId);
      }
      data.sort((a, b) => a.id.localeCompare(b.id));
      return toPage(data.slice(0, filter.limit + 1), filter.limit, (row) => ({
        key: row.id,
        id: row.id,
      }));
    },
    async get(tenantId, id) {
      return rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
    },
  };
}

describe("dominio: servicios y agendas", () => {
  it("listHealthcareServices filtra por active", async () => {
    const list = createListHealthcareServices(
      fakeServices([
        {
          id: "s1",
          tenantId: tenant,
          identifier: { system: "s", value: "1" },
          name: "Consulta",
          active: true,
        },
        {
          id: "s2",
          tenantId: tenant,
          identifier: { system: "s", value: "2" },
          name: "Inactivo",
          active: false,
        },
      ]),
    );
    const page = await list({ tenantId: tenant, active: true });
    expect(page.data.map((row) => row.id)).toEqual(["s1"]);
  });

  it("listSchedules filtra por practitioner_id", async () => {
    const list = createListSchedules(
      fakeSchedules([schedule, { ...schedule, id: "sch-2", practitionerId: "p2" }]),
    );
    const page = await list({ tenantId: tenant, practitionerId: "p1" });
    expect(page.data.map((row) => row.id)).toEqual(["sch-1"]);
  });
});

describe("dominio: cupos y citas por agenda", () => {
  it("listScheduleSlots exige agenda del tenant", async () => {
    const slots: SlotRepository = {
      listAvailability: async () => ({ data: [], nextCursor: null }),
      listBySchedule: async () => ({ data: [], nextCursor: null }),
    };
    const list = createListScheduleSlots(fakeSchedules([schedule]), slots, settings);
    await expect(
      list({
        tenantId: tenant,
        scheduleId: "ajena",
        fromRaw: "2026-06-01",
        toRaw: "2026-06-02",
        timeZone: "America/Bogota",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listScheduleSlots aplica el tope de rango", async () => {
    const slots: SlotRepository = {
      listAvailability: async () => ({ data: [], nextCursor: null }),
      listBySchedule: async () => ({ data: [], nextCursor: null }),
    };
    const list = createListScheduleSlots(fakeSchedules([schedule]), slots, settings);
    await expect(
      list({
        tenantId: tenant,
        scheduleId: "sch-1",
        fromRaw: "2026-06-01",
        toRaw: "2026-07-01",
        timeZone: "America/Bogota",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("listScheduleSlots devuelve cupos del rango", async () => {
    const slot: Slot = {
      id: "sl-1",
      tenantId: tenant,
      identifier: { system: "s", value: "1" },
      scheduleId: "sch-1",
      startAt: new Date("2026-06-15T14:00:00Z"),
      endAt: new Date("2026-06-15T14:30:00Z"),
      status: "busy",
    };
    const slots: SlotRepository = {
      listAvailability: async () => ({ data: [], nextCursor: null }),
      listBySchedule: async () => ({ data: [slot], nextCursor: null }),
    };
    const page = await createListScheduleSlots(
      fakeSchedules([schedule]),
      slots,
      settings,
    )({
      tenantId: tenant,
      scheduleId: "sch-1",
      fromRaw: "2026-06-15",
      toRaw: "2026-06-16",
      timeZone: "America/Bogota",
    });
    expect(page.data).toEqual([slot]);
  });

  it("listAppointments exige agenda propia y respeta el tope", async () => {
    const appointments: AppointmentRepository = {
      listBySchedule: async () => ({ data: [], nextCursor: null }),
    };
    const list = createListAppointments(fakeSchedules([schedule]), appointments, settings);
    await expect(
      list({
        tenantId: tenant,
        scheduleId: "ajena",
        fromRaw: "2026-06-01",
        toRaw: "2026-06-02",
        timeZone: "America/Bogota",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const appt: Appointment = {
      id: "ap-1",
      tenantId: tenant,
      identifier: { system: "s", value: "1" },
      medicalRecordId: "mr-1",
      scheduleId: "sch-1",
      slotId: "sl-1",
      startAt: new Date("2026-06-15T15:00:00Z"),
      endAt: new Date("2026-06-15T15:30:00Z"),
      status: "booked",
    };
    const withData: AppointmentRepository = {
      listBySchedule: async () => ({ data: [appt], nextCursor: null }),
    };
    const page = await createListAppointments(
      fakeSchedules([schedule]),
      withData,
      settings,
    )({
      tenantId: tenant,
      scheduleId: "sch-1",
      fromRaw: "2026-06-15",
      toRaw: "2026-06-16",
      timeZone: "America/Bogota",
    });
    expect(page.data[0]?.id).toBe("ap-1");
  });
});
