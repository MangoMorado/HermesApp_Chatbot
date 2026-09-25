import { describe, expect, it } from "vitest";
import {
  assertAppointmentChangeable,
  assertBelowPendingCap,
  assertSlotBookable,
  computeExpiresAt,
  isLive,
  resolutionEffects,
} from "@/modules/scheduling/domain/appointment-request";
import type { Appointment, Schedule, Slot } from "@/modules/scheduling/domain/entities";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const ID = { system: "urn:hermes:slot", value: "S1" };

const slot = (overrides: Partial<Slot> = {}): Slot => ({
  id: "slot-1",
  tenantId: "t",
  identifier: ID,
  scheduleId: "sched-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "free",
  ...overrides,
});

const schedule = (active = true): Schedule => ({
  id: "sched-1",
  tenantId: "t",
  identifier: ID,
  practitionerId: "p",
  healthcareServiceId: "s",
  active,
});

const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: "appt-1",
  tenantId: "t",
  identifier: ID,
  medicalRecordId: "mr-1",
  scheduleId: "sched-1",
  slotId: "slot-old",
  startAt: new Date("2026-06-16T14:00:00.000Z"),
  endAt: new Date("2026-06-16T14:30:00.000Z"),
  status: "booked",
  ...overrides,
});

describe("dominio: pre-agenda", () => {
  it("el apartado dura el plazo del tenant", () => {
    expect(computeExpiresAt(NOW, 240, new Date("2026-06-16T00:00:00.000Z"))).toEqual(
      new Date("2026-06-15T12:00:00.000Z"),
    );
  });

  it("el apartado nunca sobrevive al inicio del cupo", () => {
    const start = new Date("2026-06-15T09:00:00.000Z");
    expect(computeExpiresAt(NOW, 240, start)).toEqual(start);
  });

  it("sin cupo (cancelacion) vence solo por plazo", () => {
    expect(computeExpiresAt(NOW, 15, null)).toEqual(new Date("2026-06-15T08:15:00.000Z"));
  });

  it("viva = pendiente y antes del vencimiento", () => {
    const expiresAt = new Date("2026-06-15T09:00:00.000Z");
    expect(isLive({ status: "pending", expiresAt }, NOW)).toBe(true);
    expect(isLive({ status: "pending", expiresAt }, expiresAt)).toBe(false);
    expect(isLive({ status: "approved", expiresAt }, NOW)).toBe(false);
  });

  it("cupo libre, futuro y de agenda activa es apartable", () => {
    expect(() => assertSlotBookable(slot(), schedule(), NOW)).not.toThrow();
  });

  it("cupo de agenda inactiva o ya empezado es 422", () => {
    expect(() => assertSlotBookable(slot(), schedule(false), NOW)).toThrow(ValidationError);
    expect(() => assertSlotBookable(slot({ startAt: NOW }), schedule(), NOW)).toThrow(
      ValidationError,
    );
  });

  it("cupo no libre es 409 slot_unavailable", () => {
    for (const status of ["busy", "busy_tentative", "busy_unavailable"] as const) {
      expect(() => assertSlotBookable(slot({ status }), schedule(), NOW)).toThrow(
        expect.objectContaining({ details: { reason: "slot_unavailable" } }),
      );
    }
  });

  it("cita en firme, futura y del paciente es modificable", () => {
    expect(() => assertAppointmentChangeable(appointment(), "mr-1", NOW)).not.toThrow();
  });

  it("cita de otro paciente es 404; cancelada o pasada es 422", () => {
    expect(() => assertAppointmentChangeable(appointment(), "mr-2", NOW)).toThrow(NotFoundError);
    expect(() =>
      assertAppointmentChangeable(appointment({ status: "cancelled" }), "mr-1", NOW),
    ).toThrow(ValidationError);
    expect(() => assertAppointmentChangeable(appointment({ startAt: NOW }), "mr-1", NOW)).toThrow(
      ValidationError,
    );
  });

  it("el tope de pendientes es 409 pending_limit_reached", () => {
    expect(() => assertBelowPendingCap(1, 2)).not.toThrow();
    expect(() => assertBelowPendingCap(2, 2)).toThrow(ConflictError);
    expect(() => assertBelowPendingCap(2, 2)).toThrow(
      expect.objectContaining({ details: { reason: "pending_limit_reached", max: 2 } }),
    );
  });

  it("efectos de book", () => {
    const book = { kind: "book", slotId: "new", appointmentId: null } as const;
    expect(resolutionEffects(book, null, "approved")).toEqual({
      slots: [{ slotId: "new", status: "busy" }],
      appointments: [],
      bookedSlotId: "new",
    });
    expect(resolutionEffects(book, null, "released")).toEqual({
      slots: [{ slotId: "new", status: "free" }],
      appointments: [],
      bookedSlotId: null,
    });
  });

  it("efectos de reschedule", () => {
    const reschedule = { kind: "reschedule", slotId: "new", appointmentId: "appt" } as const;
    expect(resolutionEffects(reschedule, "old", "approved")).toEqual({
      slots: [
        { slotId: "old", status: "free" },
        { slotId: "new", status: "busy" },
      ],
      appointments: [{ appointmentId: "appt", status: "cancelled" }],
      bookedSlotId: "new",
    });
    expect(resolutionEffects(reschedule, "old", "released")).toEqual({
      slots: [{ slotId: "new", status: "free" }],
      appointments: [],
      bookedSlotId: null,
    });
  });

  it("efectos de cancel", () => {
    const cancel = { kind: "cancel", slotId: null, appointmentId: "appt" } as const;
    expect(resolutionEffects(cancel, "old", "approved")).toEqual({
      slots: [{ slotId: "old", status: "free" }],
      appointments: [{ appointmentId: "appt", status: "cancelled" }],
      bookedSlotId: null,
    });
    expect(resolutionEffects(cancel, "old", "released")).toEqual({
      slots: [],
      appointments: [],
      bookedSlotId: null,
    });
  });
});
