import { describe, expect, it, vi } from "vitest";
import { createFhirChatbotClient } from "@/modules/hermes-simulator/application/fhir-client";
import type { FhirHttp, FhirHttpRequest } from "@/modules/hermes-simulator/domain/ports/fhir-http";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { encodeCursor } from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const TOKEN = "service-token";
const WHEN = "2026-06-15T14:00:00.000Z";
const END = "2026-06-15T14:30:00.000Z";

function patient() {
  return {
    resourceType: "Patient",
    id: "pat-1",
    identifier: [
      { system: "urn:hermes:patient", value: "MR-a" },
      { system: "urn:ingenius:document:CC", value: "1000a" },
    ],
    name: [{ family: "Apellido", given: ["Nombre"] }],
  };
}

function slot() {
  return {
    resourceType: "Slot",
    id: "slot-1",
    identifier: [{ system: "urn:hermes:slot", value: "SL-a-0" }],
    start: WHEN,
    end: END,
  };
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    resourceType: "Appointment",
    id: "req-1",
    status: "proposed",
    identifier: [{ system: "urn:ingenius:appointment-request", value: "req-1" }],
    start: WHEN,
    end: END,
    slot: [{ reference: "Slot/slot-1" }],
    participant: [
      { actor: { reference: "Patient/pat-1" }, status: "accepted" },
      { actor: { reference: "Practitioner/p" }, status: "needs-action" },
      { actor: { reference: "HealthcareService/s" }, status: "needs-action" },
    ],
    ...overrides,
  };
}

function bundle(resources: readonly unknown[]) {
  return {
    resourceType: "Bundle",
    total: resources.length,
    entry: resources.map((resource) => ({ resource })),
  };
}

type FhirReply = { status: number; body: unknown };

function ok(body: unknown): FhirReply {
  return { status: 200, body };
}

function notFound(): FhirReply {
  return { status: 404, body: {} };
}

function replyForPath(path: string, routes: Record<string, FhirReply>): FhirReply {
  return routes[path] ?? notFound();
}

function patientAndSlotRoutes(): Record<string, FhirReply> {
  return {
    "Patient/pat-1": ok(patient()),
    "Slot/slot-1": ok(slot()),
  };
}

function taskStatusFromBody(input: FhirHttpRequest): string {
  if (!input.body || typeof input.body !== "object" || !("status" in input.body)) {
    return "completed";
  }
  return String((input.body as { status: string }).status);
}

function getRequestHandler(task: unknown, firm: unknown) {
  return (input: FhirHttpRequest): FhirReply =>
    replyForPath(input.path, {
      "Appointment/req-1": ok(appointment()),
      "Appointment/missing": notFound(),
      "Task/missing": notFound(),
      "Task/task-1": ok(task),
      "Appointment/firm-1": ok(firm),
      ...patientAndSlotRoutes(),
    });
}

function resolveRequestHandler(cancelled: unknown, task: Record<string, unknown>, firm: unknown) {
  return (input: FhirHttpRequest): FhirReply => {
    if (input.method === "PUT") {
      return putResolveReply(input, cancelled, task);
    }
    if (input.path.startsWith("Appointment?") || input.path.startsWith("Task?")) {
      return { status: 500, body: {} };
    }
    return replyForPath(input.path, {
      "Appointment/req-1": ok(appointment()),
      "Appointment/req-busy": ok(appointment({ status: "booked" })),
      "Task/task-1": ok(task),
      "Task/gone": notFound(),
      "Appointment/gone": notFound(),
      "Appointment/firm-1": ok(firm),
      ...patientAndSlotRoutes(),
    });
  };
}

function putResolveReply(
  input: FhirHttpRequest,
  cancelled: unknown,
  task: Record<string, unknown>,
): FhirReply {
  if (input.path === "Appointment/req-1") {
    return ok(cancelled);
  }
  if (input.path === "Task/task-1") {
    return ok({ ...task, status: taskStatusFromBody(input) });
  }
  return notFound();
}

function httpOf(handler: (input: FhirHttpRequest) => FhirReply): {
  http: FhirHttp;
  calls: FhirHttpRequest[];
} {
  const calls: FhirHttpRequest[] = [];
  const http: FhirHttp = {
    request: vi.fn(async (input: FhirHttpRequest) => {
      calls.push(input);
      return handler(input);
    }),
  };
  return { http, calls };
}

const tokens = { issue: async () => TOKEN };

describe("hermes-simulador: cliente FHIR", () => {
  it("proposed sin replaces es book y el cursor avanza por desplazamiento", async () => {
    const { http } = httpOf((input) => {
      if (input.path.startsWith("Appointment?")) {
        return { status: 200, body: bundle([appointment()]) };
      }
      if (input.path.startsWith("Task?")) {
        return { status: 200, body: bundle([]) };
      }
      if (input.path === "Patient/pat-1") {
        return { status: 200, body: patient() };
      }
      if (input.path === "Slot/slot-1") {
        return { status: 200, body: slot() };
      }
      return { status: 404, body: {} };
    });
    const chatbot = createFhirChatbotClient({ http, tokens });
    const page = await chatbot.listPending({ tenantId: "t", cursor: null, limit: 50 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      id: "req-1",
      kind: "book",
      status: "pending",
      patient: { documentNumber: "1000a", identifier: { value: "MR-a" } },
      slot: { identifier: { value: "SL-a-0" } },
    });
    expect(page.nextCursor).toBeNull();
  });

  it("la extension replaces marca un reschedule", async () => {
    const replaced = appointment({
      id: "firm-1",
      status: "booked",
      identifier: [{ system: "urn:hermes:appointment", value: "AP-a" }],
    });
    const { http } = httpOf((input) => {
      if (input.path.startsWith("Appointment?")) {
        return {
          status: 200,
          body: bundle([
            appointment({
              extension: [
                {
                  url: "http://hl7.org/fhir/5.0/StructureDefinition/extension-Appointment.replaces",
                  valueReference: { reference: "Appointment/firm-1" },
                },
              ],
            }),
          ]),
        };
      }
      if (input.path.startsWith("Task?")) {
        return { status: 200, body: bundle([]) };
      }
      if (input.path === "Appointment/firm-1") {
        return { status: 200, body: replaced };
      }
      if (input.path === "Patient/pat-1") {
        return { status: 200, body: patient() };
      }
      if (input.path === "Slot/slot-1") {
        return { status: 200, body: slot() };
      }
      return { status: 404, body: {} };
    });
    const chatbot = createFhirChatbotClient({ http, tokens });
    const page = await chatbot.listPending({ tenantId: "t", cursor: null, limit: 50 });
    expect(page.data[0]).toMatchObject({
      kind: "reschedule",
      appointment: { identifier: { value: "AP-a" } },
    });
  });

  it("aprobar un book envia PUT booked con el identificador determinista", async () => {
    const booked = appointment({
      status: "booked",
      identifier: [{ system: "urn:hermes:appointment", value: "AP-req-1" }],
    });
    const { http, calls } = httpOf((input) => {
      if (input.method === "PUT") {
        return { status: 200, body: booked };
      }
      if (input.path === "Appointment/req-1") {
        return { status: 200, body: appointment() };
      }
      if (input.path === "Patient/pat-1") {
        return { status: 200, body: patient() };
      }
      if (input.path === "Slot/slot-1") {
        return { status: 200, body: slot() };
      }
      return { status: 404, body: {} };
    });
    const chatbot = createFhirChatbotClient({ http, tokens });
    const resolved = await chatbot.resolve({
      tenantId: "t",
      requestId: "req-1",
      actor: { actorSubject: "admin", actorRole: "admin", requestId: "r" },
      resolution: {
        outcome: "approved",
        appointmentIdentifier: { system: "urn:hermes:appointment", value: "AP-req-1" },
      },
    });
    const put = calls.find((call) => call.method === "PUT");
    expect(put).toMatchObject({
      path: "Appointment/req-1",
      idempotencyKey: "resolve:req-1:approved",
      body: {
        resourceType: "Appointment",
        status: "booked",
        identifier: [{ system: "urn:hermes:appointment", value: "AP-req-1" }],
      },
    });
    expect(resolved.status).toBe("approved");
    expect(resolved.resultingAppointment?.identifier.value).toBe("AP-req-1");
  });

  it("pagina con cursor offset y rechaza cursor invalido", async () => {
    const second = appointment({ id: "req-2", start: "2026-06-16T14:00:00.000Z", end: END });
    const { http } = httpOf((input) => {
      if (input.path.startsWith("Appointment?")) {
        return { status: 200, body: bundle([appointment(), second]) };
      }
      if (input.path.startsWith("Task?")) {
        return { status: 200, body: bundle([]) };
      }
      if (input.path === "Patient/pat-1") {
        return { status: 200, body: patient() };
      }
      if (input.path === "Slot/slot-1") {
        return { status: 200, body: slot() };
      }
      return { status: 404, body: {} };
    });
    const chatbot = createFhirChatbotClient({ http, tokens });
    const first = await chatbot.listPending({ tenantId: "t", cursor: null, limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const next = await chatbot.listPending({
      tenantId: "t",
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(next.data[0]?.id).toBe("req-2");
    await expect(
      chatbot.listPending({
        tenantId: "t",
        cursor: encodeCursor({ key: "1", id: "no-offset" }),
        limit: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("get lee Appointment o Task y falla si no existe", async () => {
    const task = {
      resourceType: "Task",
      id: "task-1",
      status: "requested",
      focus: { reference: "Appointment/firm-1" },
      for: { reference: "Patient/pat-1" },
    };
    const firm = appointment({
      id: "firm-1",
      status: "booked",
      identifier: [{ system: "urn:hermes:appointment", value: "AP-a" }],
    });
    const { http } = httpOf(getRequestHandler(task, firm));
    const chatbot = createFhirChatbotClient({ http, tokens });
    await expect(chatbot.get("t", "req-1")).resolves.toMatchObject({ kind: "book", id: "req-1" });
    await expect(chatbot.get("t", "task-1")).resolves.toMatchObject({ kind: "cancel" });
    await expect(chatbot.get("t", "missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reject de Appointment y approve/reject de Task cubren cuerpos y conflictos", async () => {
    const cancelled = appointment({ status: "cancelled" });
    const task = {
      resourceType: "Task",
      id: "task-1",
      status: "requested",
      focus: { reference: "Appointment/firm-1" },
      for: { reference: "Patient/pat-1" },
    };
    const firm = appointment({
      id: "firm-1",
      status: "booked",
      identifier: [{ system: "urn:hermes:appointment", value: "AP-a" }],
    });
    const { http, calls } = httpOf(resolveRequestHandler(cancelled, task, firm));
    const chatbot = createFhirChatbotClient({ http, tokens });
    const actor = { actorSubject: "admin", actorRole: "admin" as const, requestId: "r" };
    await expect(
      chatbot.resolve({
        tenantId: "t",
        requestId: "req-1",
        actor,
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    ).resolves.toMatchObject({ status: "rejected", resolutionReason: "declined" });
    expect(calls.some((c) => c.idempotencyKey === "resolve:req-1:rejected:declined")).toBe(true);

    await expect(
      chatbot.resolve({
        tenantId: "t",
        requestId: "req-busy",
        actor,
        resolution: {
          outcome: "approved",
          appointmentIdentifier: { system: "urn:hermes:appointment", value: "AP" },
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      chatbot.resolve({
        tenantId: "t",
        requestId: "task-1",
        actor,
        resolution: {
          outcome: "approved",
          appointmentIdentifier: { system: "urn:hermes:appointment", value: "AP-a" },
        },
      }),
    ).resolves.toMatchObject({ status: "approved", kind: "cancel" });

    await expect(
      chatbot.resolve({
        tenantId: "t",
        requestId: "task-1",
        actor,
        resolution: { outcome: "rejected", reason: "slot_unavailable" },
      }),
    ).resolves.toMatchObject({ status: "rejected" });

    await expect(
      chatbot.resolve({
        tenantId: "t",
        requestId: "gone",
        actor,
        resolution: { outcome: "rejected", reason: "declined" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(chatbot.listPending({ tenantId: "t", cursor: null, limit: 10 })).rejects.toThrow(
      /respondio 500/,
    );
  });
});
