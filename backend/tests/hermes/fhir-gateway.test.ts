import { describe, expect, it, vi } from "vitest";
import { createFhirChatbotGateway } from "@/modules/hermes-simulator/application/fhir-gateway";
import type { FhirHttp, FhirHttpRequest } from "@/modules/hermes-simulator/domain/ports/fhir-http";

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

function httpOf(handler: (input: FhirHttpRequest) => { status: number; body: unknown }): {
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
    const gateway = createFhirChatbotGateway({ http, tokens });
    const page = await gateway.listPending({ tenantId: "t", cursor: null, limit: 50 });
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
    const gateway = createFhirChatbotGateway({ http, tokens });
    const page = await gateway.listPending({ tenantId: "t", cursor: null, limit: 50 });
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
    const gateway = createFhirChatbotGateway({ http, tokens });
    const resolved = await gateway.resolve({
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
});
