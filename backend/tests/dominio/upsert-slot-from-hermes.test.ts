import { describe, expect, it, vi } from "vitest";
import { createUpsertSlotFromHermes } from "@/modules/scheduling/application/upsert-slot-from-hermes";
import type { AppointmentRequest } from "@/modules/scheduling/domain/appointment-request";
import type { Schedule, Slot, SlotStatus } from "@/modules/scheduling/domain/entities";
import { ConflictError } from "@/modules/shared/domain/conflict-error";

const now = new Date("2026-10-14T12:00:00.000Z");
const actor = { actorSubject: "hermes", actorRole: "service", requestId: "r1" };

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: "slot-1",
    tenantId: "t1",
    identifier: { system: "urn:hermes:slot", value: "SL-1" },
    scheduleId: "schedule-1",
    startAt: new Date("2026-10-15T09:00:00.000Z"),
    endAt: new Date("2026-10-15T09:30:00.000Z"),
    status: "busy_tentative",
    ...overrides,
  };
}

function liveHold(): AppointmentRequest {
  return {
    id: "request-1",
    tenantId: "t1",
    kind: "book",
    status: "pending",
    medicalRecordId: "record-1",
    slotId: "slot-1",
    appointmentId: null,
    expiresAt: new Date("2026-10-14T12:10:00.000Z"),
    resolutionReason: null,
    resultingAppointmentId: null,
    createdAt: new Date("2026-10-14T11:59:00.000Z"),
    resolvedAt: null,
  };
}

function dependencies(status: SlotStatus = "busy_tentative") {
  const existing = slot({ status });
  const schedule: Schedule = {
    id: "schedule-1",
    tenantId: "t1",
    identifier: { system: "urn:hermes:schedule", value: "S-1" },
    practitionerId: "practitioner-1",
    healthcareServiceId: "service-1",
    active: true,
  };
  const store = {
    findSlotByIdentifier: vi.fn(async () => existing as Slot | null),
    getSchedule: vi.fn(async () => schedule as Schedule | null),
    saveSlot: vi.fn(async () => {}),
  };
  const preAgenda = {
    expireDue: vi.fn(async () => {}),
    findLiveHoldBySlot: vi.fn(async () => liveHold() as AppointmentRequest | null),
    markResolved: vi.fn(async (_tenantId, _id, patch) => ({ ...liveHold(), ...patch })),
    setSlotStatus: vi.fn(async () => {}),
  };
  return {
    store,
    preAgenda,
    audit: { record: vi.fn(async () => {}) },
    ids: { next: () => "new-id" },
    clock: { now: () => now },
  };
}

function input(
  overrides: Partial<Parameters<ReturnType<typeof createUpsertSlotFromHermes>>[0]> = {},
) {
  return {
    tenantId: "t1" as never,
    actor,
    identifier: { system: "urn:hermes:slot", value: "SL-1" },
    scheduleId: "schedule-1",
    startAt: new Date("2026-10-15T09:00:00.000Z"),
    endAt: new Date("2026-10-15T09:30:00.000Z"),
    status: "busy" as SlotStatus,
    ...overrides,
  };
}

describe("dominio: upsert Slot desde Hermes", () => {
  it("ocupa un cupo apartado y rechaza la solicitud sin liberarlo", async () => {
    const deps = dependencies();

    const result = await createUpsertSlotFromHermes(deps)(input());

    expect(result).toEqual({
      outcome: "updated",
      record: slot({ status: "busy" }),
    });
    expect(deps.preAgenda.expireDue).toHaveBeenCalledWith("t1", now);
    expect(deps.preAgenda.expireDue).toHaveBeenCalledBefore(deps.preAgenda.findLiveHoldBySlot);
    expect(deps.store.saveSlot).toHaveBeenCalledWith(result.record, "update");
    expect(deps.preAgenda.markResolved).toHaveBeenCalledWith("t1", "request-1", {
      status: "rejected",
      resolutionReason: "slot_unavailable",
      resultingAppointmentId: null,
      resolvedAt: now,
    });
    expect(deps.preAgenda.setSlotStatus).not.toHaveBeenCalled();
    expect(deps.audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "slot.written_by_hermes",
        resourceType: "slot",
        resourceId: "slot-1",
      }),
    );
    expect(deps.audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "appointment_request.rejected",
        resourceType: "appointment_request",
        resourceId: "request-1",
      }),
    );
  });

  it("rechaza un PUT free sobre cupo apartado", async () => {
    const deps = dependencies();

    await expect(createUpsertSlotFromHermes(deps)(input({ status: "free" }))).rejects.toEqual(
      expect.objectContaining<Partial<ConflictError>>({
        name: "ConflictError",
        message: "El cupo esta apartado",
      }),
    );

    expect(deps.store.saveSlot).not.toHaveBeenCalled();
    expect(deps.preAgenda.markResolved).not.toHaveBeenCalled();
    expect(deps.preAgenda.setSlotStatus).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it("rechaza cambiar start de un cupo apartado", async () => {
    const deps = dependencies();

    await expect(
      createUpsertSlotFromHermes(deps)(input({ startAt: new Date("2026-10-15T09:15:00.000Z") })),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(deps.store.saveSlot).not.toHaveBeenCalled();
    expect(deps.preAgenda.markResolved).not.toHaveBeenCalled();
    expect(deps.preAgenda.setSlotStatus).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });
});
