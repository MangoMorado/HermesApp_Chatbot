import { describe, expect, it, vi } from "vitest";
import { createResolveAppointmentRequest } from "@/modules/scheduling/application/resolve-appointment-request";
import { createResolveFromFhir } from "@/modules/scheduling/application/resolve-from-fhir";
import type { AppointmentRequest } from "@/modules/scheduling/domain/appointment-request";
import type { Appointment, Slot } from "@/modules/scheduling/domain/entities";
import type { PreAgendaStore } from "@/modules/scheduling/domain/ports/pre-agenda";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");
const ACTOR = { actorSubject: "hermes", actorRole: "service" as const, requestId: "r1" };
const BUSINESS = { system: "urn:hermes:appointment", value: "APT-1" };
const ID = { system: "urn:hermes:slot", value: "S1" };

const request = (overrides: Partial<AppointmentRequest> = {}): AppointmentRequest => ({
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

const slot = (): Slot => ({
  id: "slot-1",
  tenantId: "t1",
  identifier: ID,
  scheduleId: "sched-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "busy_tentative",
});

const appointment = (): Appointment => ({
  id: "appt-1",
  tenantId: "t1",
  identifier: BUSINESS,
  medicalRecordId: "mr-1",
  scheduleId: "sched-1",
  slotId: "slot-old",
  startAt: new Date("2026-06-16T14:00:00.000Z"),
  endAt: new Date("2026-06-16T14:30:00.000Z"),
  status: "booked",
});

function store(overrides: Partial<PreAgendaStore> = {}): PreAgendaStore {
  return {
    expireDue: vi.fn(async () => undefined),
    lockMedicalRecord: vi.fn(async () => true),
    getSlot: vi.fn(async () => slot()),
    getSchedule: vi.fn(async () => null),
    getAppointment: vi.fn(async () => appointment()),
    countLiveHolds: vi.fn(async () => 0),
    findLiveHoldBySlot: vi.fn(async () => null),
    holdSlot: vi.fn(async () => true),
    insertRequest: vi.fn(async () => request()),
    getRequestForUpdate: vi.fn(async () => request()),
    setSlotStatus: vi.fn(async () => undefined),
    insertAppointment: vi.fn(async () => undefined),
    setAppointmentStatus: vi.fn(async () => undefined),
    markResolved: vi.fn(async (_t, id, patch) =>
      request({ id, status: patch.status, resultingAppointmentId: patch.resultingAppointmentId }),
    ),
    ...overrides,
  };
}

const audit = { record: vi.fn(async () => undefined) };
const ids = { next: () => "new-id" };
const clock = { now: () => NOW };

describe("pre-agenda: resolver solicitud", () => {
  it("aprueba book creando la cita con el id de la solicitud", async () => {
    const ports = store();
    const resolve = createResolveAppointmentRequest({ store: ports, ids, clock, audit });
    const resolved = await resolve({
      tenantId: TENANT,
      requestId: "req-1",
      actor: ACTOR,
      resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
    });
    expect(ports.setSlotStatus).toHaveBeenCalledWith(TENANT, "slot-1", "busy");
    expect(ports.insertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "req-1", slotId: "slot-1", identifier: BUSINESS }),
    );
    expect(resolved.status).toBe("approved");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "appointment_request.approved" }),
    );
  });

  it("rechaza liberando el cupo", async () => {
    const ports = store();
    const resolve = createResolveAppointmentRequest({ store: ports, ids, clock, audit });
    await resolve({
      tenantId: TENANT,
      requestId: "req-1",
      actor: ACTOR,
      resolution: { outcome: "rejected", reason: "declined" },
    });
    expect(ports.setSlotStatus).toHaveBeenCalledWith(TENANT, "slot-1", "free");
    expect(ports.insertAppointment).not.toHaveBeenCalled();
    expect(ports.markResolved).toHaveBeenCalledWith(
      TENANT,
      "req-1",
      expect.objectContaining({ status: "rejected", resolutionReason: "declined" }),
    );
  });

  it("aprueba cancel liberando el cupo de la cita", async () => {
    const ports = store({
      getRequestForUpdate: vi.fn(async () =>
        request({ kind: "cancel", slotId: null, appointmentId: "appt-1" }),
      ),
    });
    const resolve = createResolveAppointmentRequest({ store: ports, ids, clock, audit });
    await resolve({
      tenantId: TENANT,
      requestId: "req-1",
      actor: ACTOR,
      resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
    });
    expect(ports.setSlotStatus).toHaveBeenCalledWith(TENANT, "slot-old", "free");
    expect(ports.setAppointmentStatus).toHaveBeenCalledWith(TENANT, "appt-1", "cancelled");
    expect(ports.insertAppointment).not.toHaveBeenCalled();
  });

  it("falla si no existe, no esta pendiente o el cupo desaparecio", async () => {
    const missing = createResolveAppointmentRequest({
      store: store({ getRequestForUpdate: vi.fn(async () => null) }),
      ids,
      clock,
      audit,
    });
    await expect(
      missing({
        tenantId: TENANT,
        requestId: "x",
        actor: ACTOR,
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const expired = createResolveAppointmentRequest({
      store: store({
        getRequestForUpdate: vi.fn(async () =>
          request({ expiresAt: new Date("2026-06-15T07:00:00.000Z") }),
        ),
      }),
      ids,
      clock,
      audit,
    });
    await expect(
      expired({
        tenantId: TENANT,
        requestId: "req-1",
        actor: ACTOR,
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const noSlot = createResolveAppointmentRequest({
      store: store({ getSlot: vi.fn(async () => null) }),
      ids,
      clock,
      audit,
    });
    await expect(
      noSlot({
        tenantId: TENANT,
        requestId: "req-1",
        actor: ACTOR,
        resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("pre-agenda: resolver desde FHIR", () => {
  it("delega agenda y audita appointment.written_by_hermes", async () => {
    const ports = store();
    const resolve = vi.fn(async () => request({ status: "approved" }));
    const fromFhir = createResolveFromFhir({
      store: ports,
      expirer: ports,
      resolve,
      audit,
      clock,
    });
    await fromFhir({
      tenantId: TENANT,
      requestId: "req-1",
      actor: ACTOR,
      kind: "agenda",
      resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
    });
    expect(ports.expireDue).toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "appointment.written_by_hermes" }),
    );
  });

  it("en cancel aprobada usa el identifier de la cita en firme", async () => {
    const ports = store({
      getRequestForUpdate: vi.fn(async () =>
        request({ kind: "cancel", slotId: null, appointmentId: "appt-1" }),
      ),
    });
    const resolve = vi.fn(async () => request({ status: "approved", kind: "cancel" }));
    const fromFhir = createResolveFromFhir({
      store: ports,
      expirer: ports,
      resolve,
      audit,
      clock,
    });
    await fromFhir({
      tenantId: TENANT,
      requestId: "req-1",
      actor: ACTOR,
      kind: "cancel",
      resolution: {
        outcome: "approved",
        appointmentIdentifier: { system: "urn:ingenius:appointment-request", value: "req-1" },
      },
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.written_by_hermes", resourceType: "task" }),
    );
  });

  it("falla si el kind no coincide o la solicitud no esta viva", async () => {
    const ports = store();
    const fromFhir = createResolveFromFhir({
      store: ports,
      expirer: ports,
      resolve: vi.fn(),
      audit,
      clock,
    });
    await expect(
      fromFhir({
        tenantId: TENANT,
        requestId: "req-1",
        actor: ACTOR,
        kind: "cancel",
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const expiredStore = store({
      getRequestForUpdate: vi.fn(async () =>
        request({ expiresAt: new Date("2026-06-15T07:00:00.000Z") }),
      ),
    });
    const expired = createResolveFromFhir({
      store: expiredStore,
      expirer: expiredStore,
      resolve: vi.fn(),
      audit,
      clock,
    });
    await expect(
      expired({
        tenantId: TENANT,
        requestId: "req-1",
        actor: ACTOR,
        kind: "agenda",
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("falla si cancel aprobada no tiene cita", async () => {
    const ports = store({
      getRequestForUpdate: vi.fn(async () =>
        request({ kind: "cancel", slotId: null, appointmentId: null }),
      ),
    });
    const fromFhir = createResolveFromFhir({
      store: ports,
      expirer: ports,
      resolve: vi.fn(),
      audit,
      clock,
    });
    await expect(
      fromFhir({
        tenantId: TENANT,
        requestId: "req-1",
        actor: ACTOR,
        kind: "cancel",
        resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
