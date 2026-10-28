import { describe, expect, it, vi } from "vitest";
import { createCreateAppointmentRequest } from "@/modules/scheduling/application/create-appointment-request";
import type { AppointmentRequest } from "@/modules/scheduling/domain/appointment-request";
import type { Appointment, Schedule, Slot } from "@/modules/scheduling/domain/entities";
import type { PreAgendaPolicy, PreAgendaStore } from "@/modules/scheduling/domain/ports/pre-agenda";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");
const ACTOR = { actorSubject: "widget:s1", actorRole: "widget" as const, requestId: "r1" };
const ID = { system: "urn:hermes:slot", value: "S1" };

const slot = (overrides: Partial<Slot> = {}): Slot => ({
  id: "slot-1",
  tenantId: "t1",
  identifier: ID,
  scheduleId: "sched-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "free",
  ...overrides,
});

const schedule = (): Schedule => ({
  id: "sched-1",
  tenantId: "t1",
  identifier: ID,
  practitionerId: "p1",
  healthcareServiceId: "hs1",
  active: true,
});

const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: "appt-1",
  tenantId: "t1",
  identifier: ID,
  medicalRecordId: "mr-1",
  scheduleId: "sched-1",
  slotId: "slot-old",
  startAt: new Date("2026-06-16T14:00:00.000Z"),
  endAt: new Date("2026-06-16T14:30:00.000Z"),
  status: "booked",
  ...overrides,
});

const pending = (overrides: Partial<AppointmentRequest> = {}): AppointmentRequest => ({
  id: "req-1",
  tenantId: "t1",
  kind: "book",
  status: "pending",
  medicalRecordId: "mr-1",
  slotId: "slot-1",
  appointmentId: null,
  expiresAt: new Date("2026-06-15T12:00:00.000Z"),
  resolutionReason: null,
  resultingAppointmentId: null,
  createdAt: NOW,
  resolvedAt: null,
  ...overrides,
});

function store(overrides: Partial<PreAgendaStore> = {}): PreAgendaStore {
  return {
    expireDue: vi.fn(async () => undefined),
    lockMedicalRecord: vi.fn(async () => true),
    getSlot: vi.fn(async () => slot()),
    getSchedule: vi.fn(async () => schedule()),
    getAppointment: vi.fn(async () => appointment()),
    countLiveHolds: vi.fn(async () => 0),
    findLiveHoldBySlot: vi.fn(async () => null),
    holdSlot: vi.fn(async () => true),
    insertRequest: vi.fn(async (row) =>
      pending({
        id: row.id,
        kind: row.kind,
        slotId: row.slotId,
        appointmentId: row.appointmentId,
        expiresAt: row.expiresAt,
      }),
    ),
    getRequestForUpdate: vi.fn(async () => null),
    setSlotStatus: vi.fn(async () => undefined),
    insertAppointment: vi.fn(async () => undefined),
    setAppointmentStatus: vi.fn(async () => undefined),
    markResolved: vi.fn(async () => pending({ status: "approved" })),
    ...overrides,
  };
}

const policy: PreAgendaPolicy = {
  read: vi.fn(async () => ({ holdMinutes: 240, maxPendingHolds: 2 })),
};

const audit = { record: vi.fn(async () => undefined) };
const ids = { next: () => "req-new" };
const clock = { now: () => NOW };

describe("pre-agenda: crear solicitud", () => {
  it("crea book apartando el cupo y auditando", async () => {
    const ports = store();
    const create = createCreateAppointmentRequest({
      store: ports,
      policy,
      ids,
      clock,
      audit,
    });
    const result = await create({
      kind: "book",
      tenantId: TENANT,
      medicalRecordId: "mr-1",
      slotId: "slot-1",
      actor: ACTOR,
    });
    expect(result.id).toBe("req-new");
    expect(ports.holdSlot).toHaveBeenCalledWith(TENANT, "slot-1");
    expect(ports.insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "book", slotId: "slot-1", appointmentId: null }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "appointment_request.created" }),
    );
  });

  it("crea cancel sin apartar cupo", async () => {
    const ports = store();
    const create = createCreateAppointmentRequest({
      store: ports,
      policy,
      ids,
      clock,
      audit,
    });
    await create({
      kind: "cancel",
      tenantId: TENANT,
      medicalRecordId: "mr-1",
      appointmentId: "appt-1",
      actor: ACTOR,
    });
    expect(ports.holdSlot).not.toHaveBeenCalled();
    expect(ports.insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cancel", slotId: null, appointmentId: "appt-1" }),
    );
  });

  it("reschedule rechaza el mismo cupo", async () => {
    const ports = store({
      getAppointment: vi.fn(async () => appointment({ slotId: "slot-1" })),
    });
    const create = createCreateAppointmentRequest({
      store: ports,
      policy,
      ids,
      clock,
      audit,
    });
    await expect(
      create({
        kind: "reschedule",
        tenantId: TENANT,
        medicalRecordId: "mr-1",
        appointmentId: "appt-1",
        slotId: "slot-1",
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("falla si la historia no existe o el cupo ya no esta libre", async () => {
    const missingMr = createCreateAppointmentRequest({
      store: store({ lockMedicalRecord: vi.fn(async () => false) }),
      policy,
      ids,
      clock,
      audit,
    });
    await expect(
      missingMr({
        kind: "book",
        tenantId: TENANT,
        medicalRecordId: "mr-x",
        slotId: "slot-1",
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const taken = createCreateAppointmentRequest({
      store: store({ holdSlot: vi.fn(async () => false) }),
      policy,
      ids,
      clock,
      audit,
    });
    await expect(
      taken({
        kind: "book",
        tenantId: TENANT,
        medicalRecordId: "mr-1",
        slotId: "slot-1",
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("falla si el cupo o la agenda no existen", async () => {
    const noSlot = createCreateAppointmentRequest({
      store: store({ getSlot: vi.fn(async () => null) }),
      policy,
      ids,
      clock,
      audit,
    });
    await expect(
      noSlot({
        kind: "book",
        tenantId: TENANT,
        medicalRecordId: "mr-1",
        slotId: "slot-x",
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const noSchedule = createCreateAppointmentRequest({
      store: store({ getSchedule: vi.fn(async () => null) }),
      policy,
      ids,
      clock,
      audit,
    });
    await expect(
      noSchedule({
        kind: "book",
        tenantId: TENANT,
        medicalRecordId: "mr-1",
        slotId: "slot-1",
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
