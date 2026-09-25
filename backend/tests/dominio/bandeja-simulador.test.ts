import { describe, expect, it, vi } from "vitest";
import { createApproveInboxRequest } from "@/modules/hermes-simulator/application/inbox";
import type { InboxRequest } from "@/modules/hermes-simulator/domain/inbox";
import type {
  ChatbotRequestsGateway,
  SimInboxStore,
} from "@/modules/hermes-simulator/domain/ports/inbox";
import { ConflictError } from "@/modules/shared/domain/conflict-error";

const ACTOR = { actorSubject: "admin", actorRole: "admin", requestId: "r" };
const ID = (value: string) => ({ system: "urn:test", value });
const WHEN = { startAt: new Date("2026-06-15T14:00:00Z"), endAt: new Date("2026-06-15T14:30:00Z") };

const request = (overrides: Partial<InboxRequest> = {}): InboxRequest => ({
  id: "req-1",
  kind: "book",
  status: "pending",
  createdAt: new Date("2026-06-15T08:00:00Z"),
  expiresAt: new Date("2026-06-15T12:00:00Z"),
  resolutionReason: null,
  patient: {
    identifier: ID("MR"),
    documentType: "CC",
    documentNumber: "1",
    givenNames: "A",
    familyNames: "B",
  },
  slot: { identifier: ID("SL"), ...WHEN },
  appointment: null,
  resultingAppointment: null,
  ...overrides,
});

function fakes(pending: InboxRequest, slotStatus: "free" | "busy" = "free") {
  const gateway: ChatbotRequestsGateway = {
    listPending: vi.fn(),
    get: vi.fn(async () => pending),
    resolve: vi.fn(async ({ resolution }) => ({
      ...pending,
      status: (resolution.outcome === "approved"
        ? "approved"
        : "rejected") as InboxRequest["status"],
    })),
  };
  const store: SimInboxStore = {
    findPatientId: vi.fn(async () => "sim-pat"),
    lockSlot: vi.fn(async () => ({
      id: "sim-slot",
      scheduleId: "sim-sched",
      status: slotStatus,
      ...WHEN,
    })),
    findAppointment: vi.fn(async () => ({ id: "sim-appt", slotId: "sim-old" })),
    setSlotStatus: vi.fn(async () => {}),
    cancelAppointment: vi.fn(async () => {}),
    createAppointment: vi.fn(async () => {}),
  };
  let n = 0;
  const approve = createApproveInboxRequest({ gateway, store, ids: { next: () => `id-${n++}` } });
  return { gateway, store, approve };
}

const command = { tenantId: "t", requestId: "req-1", actor: ACTOR };

describe("hermes-simulador: decision de la bandeja", () => {
  it("cupo libre: Hermes crea su cita y aprueba con su identificador", async () => {
    const { gateway, store, approve } = fakes(request());
    await approve(command);
    expect(store.setSlotStatus).toHaveBeenCalledWith("t", "sim-slot", "busy");
    expect(store.createAppointment).toHaveBeenCalledOnce();
    expect(gateway.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: {
          outcome: "approved",
          appointmentIdentifier: { system: "urn:hermes:appointment", value: "AP-id-0" },
        },
      }),
    );
  });

  it("cupo ocupado en Hermes: rechaza por slot_unavailable sin escribir nada", async () => {
    const { gateway, store, approve } = fakes(request(), "busy");
    await approve(command);
    expect(store.setSlotStatus).not.toHaveBeenCalled();
    expect(store.createAppointment).not.toHaveBeenCalled();
    expect(gateway.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: { outcome: "rejected", reason: "slot_unavailable" } }),
    );
  });

  it("paciente desconocido para Hermes: 409 antes de escribir", async () => {
    const { store, approve } = fakes(request());
    vi.mocked(store.findPatientId).mockResolvedValue(null);
    await expect(approve(command)).rejects.toMatchObject({
      details: { reason: "patient_not_in_hermes" },
    });
    expect(store.setSlotStatus).not.toHaveBeenCalled();
  });

  it("solicitud no pendiente: 409 request_not_pending", async () => {
    const { approve } = fakes(request({ status: "expired" }));
    await expect(approve(command)).rejects.toMatchObject({
      details: { reason: "request_not_pending", status: "expired" },
    });
  });

  it("reschedule: cancela la cita vieja de Hermes y reserva el cupo nuevo", async () => {
    const { store, approve } = fakes(
      request({ kind: "reschedule", appointment: { identifier: ID("AP"), ...WHEN } }),
    );
    await approve(command);
    expect(store.cancelAppointment).toHaveBeenCalledWith("t", "sim-appt");
    expect(store.setSlotStatus).toHaveBeenCalledWith("t", "sim-old", "free");
    expect(store.setSlotStatus).toHaveBeenCalledWith("t", "sim-slot", "busy");
  });

  it("cita desconocida para Hermes: 409 appointment_not_in_hermes", async () => {
    const { store, approve } = fakes(
      request({ kind: "cancel", slot: null, appointment: { identifier: ID("AP"), ...WHEN } }),
    );
    vi.mocked(store.findAppointment).mockResolvedValue(null);
    await expect(approve(command)).rejects.toBeInstanceOf(ConflictError);
  });

  it("si el chatbot rechaza la resolucion, el error se propaga (la transaccion revierte)", async () => {
    const { gateway, approve } = fakes(request());
    vi.mocked(gateway.resolve).mockRejectedValue(
      new ConflictError("vencida", { reason: "request_not_pending" }),
    );
    await expect(approve(command)).rejects.toMatchObject({
      details: { reason: "request_not_pending" },
    });
  });
});
