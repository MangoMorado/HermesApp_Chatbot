import { describe, expect, it, vi } from "vitest";
import { createResolveById } from "@/modules/fhir/application/resolve-by-id";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import type { AgendaResolver } from "@/modules/fhir/domain/ports/agenda";
import type { AppointmentRecord, TaskRecord } from "@/modules/fhir/domain/ports/sources";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const TENANT = toTenantId("tenant-a");
const ACTOR = { actorSubject: "hermes", actorRole: "service" as const, requestId: "r1" };
const BUSINESS = { system: "urn:hermes:appointment", value: "APT-1" };
const REQUEST_ID = { system: "urn:ingenius:appointment-request", value: "req-1" };

const appointment = (overrides: Partial<AppointmentRecord> = {}): AppointmentRecord => ({
  id: "req-1",
  identifier: REQUEST_ID,
  medicalRecordId: "mr-1",
  slotId: "slot-1",
  practitionerId: "pr-1",
  healthcareServiceId: "hs-1",
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
  status: "proposed",
  replacesAppointmentId: null,
  ...overrides,
});

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "task-1",
  identifier: REQUEST_ID,
  status: "requested",
  medicalRecordId: "mr-1",
  focusAppointmentId: "appt-1",
  statusReason: null,
  ...overrides,
});

function resolver(overrides: Partial<AgendaResolver> = {}): AgendaResolver {
  return {
    expire: vi.fn(async () => undefined),
    readAppointment: vi.fn(async () => appointment()),
    readTask: vi.fn(async () => task()),
    resolve: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("fhir-conformance: resolve by id", () => {
  it("aprueba Appointment proposed y devuelve el recurso booked", async () => {
    const booked = appointment({ status: "booked", identifier: BUSINESS });
    const ports = resolver({
      readAppointment: vi
        .fn()
        .mockResolvedValueOnce(appointment())
        .mockResolvedValueOnce(booked),
    });
    const resolve = createResolveById(ports);
    const resource = await resolve({
      tenantId: TENANT,
      actor: ACTOR,
      type: "Appointment",
      id: "req-1",
      body: {
        resourceType: "Appointment",
        id: "req-1",
        status: "booked",
        identifier: [BUSINESS],
      },
    });
    expect(resource.resourceType).toBe("Appointment");
    expect(resource.status).toBe("booked");
    expect(ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "agenda",
        resolution: { outcome: "approved", appointmentIdentifier: BUSINESS },
      }),
    );
  });

  it("rechaza Appointment con cancelled y motivo por defecto declined", async () => {
    const cancelled = appointment({ status: "cancelled" });
    const ports = resolver({
      readAppointment: vi
        .fn()
        .mockResolvedValueOnce(appointment())
        .mockResolvedValueOnce(cancelled),
    });
    const resolve = createResolveById(ports);
    await resolve({
      tenantId: TENANT,
      actor: ACTOR,
      type: "Appointment",
      id: "req-1",
      body: { resourceType: "Appointment", status: "cancelled" },
    });
    expect(ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    );
  });

  it("falla si Appointment no existe o ya no esta proposed", async () => {
    const missing = createResolveById(resolver({ readAppointment: vi.fn(async () => null) }));
    await expect(
      missing({
        tenantId: TENANT,
        actor: ACTOR,
        type: "Appointment",
        id: "req-1",
        body: { resourceType: "Appointment", status: "booked", identifier: [BUSINESS] },
      }),
    ).rejects.toMatchObject({ status: 404 });

    const conflict = createResolveById(
      resolver({ readAppointment: vi.fn(async () => appointment({ status: "booked" })) }),
    );
    await expect(
      conflict({
        tenantId: TENANT,
        actor: ACTOR,
        type: "Appointment",
        id: "req-1",
        body: { resourceType: "Appointment", status: "booked", identifier: [BUSINESS] },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("falla si el id del cuerpo no coincide", async () => {
    const resolve = createResolveById(resolver());
    await expect(
      resolve({
        tenantId: TENANT,
        actor: ACTOR,
        type: "Appointment",
        id: "req-1",
        body: {
          resourceType: "Appointment",
          id: "otro",
          status: "booked",
          identifier: [BUSINESS],
        },
      }),
    ).rejects.toBeInstanceOf(FhirError);
  });

  it("completa Task requested y usa el id como identifier al aprobar", async () => {
    const ports = resolver({
      readTask: vi
        .fn()
        .mockResolvedValueOnce(task())
        .mockResolvedValueOnce(task({ status: "completed" })),
    });
    const resolve = createResolveById(ports);
    const resource = await resolve({
      tenantId: TENANT,
      actor: ACTOR,
      type: "Task",
      id: "task-1",
      body: { resourceType: "Task", status: "completed" },
    });
    expect(resource.resourceType).toBe("Task");
    expect(ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cancel",
        resolution: {
          outcome: "approved",
          appointmentIdentifier: {
            system: "urn:ingenius:appointment-request",
            value: "task-1",
          },
        },
      }),
    );
  });

  it("rechaza Task con motivo y falla si desaparece al releer", async () => {
    const ports = resolver({
      readTask: vi.fn().mockResolvedValueOnce(task()).mockResolvedValueOnce(null),
    });
    const resolve = createResolveById(ports);
    await expect(
      resolve({
        tenantId: TENANT,
        actor: ACTOR,
        type: "Task",
        id: "task-1",
        body: {
          resourceType: "Task",
          status: "rejected",
          statusReason: { coding: [{ code: "declined" }] },
        },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    );
  });

  it("falla si Task no esta requested", async () => {
    const resolve = createResolveById(
      resolver({ readTask: vi.fn(async () => task({ status: "completed" })) }),
    );
    await expect(
      resolve({
        tenantId: TENANT,
        actor: ACTOR,
        type: "Task",
        id: "task-1",
        body: { resourceType: "Task", status: "completed" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
