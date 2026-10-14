import { describe, expect, it, vi } from "vitest";
import { createSyncMasters } from "@/modules/hermes-simulator/application/hermes-sync";
import type { SimCatalog } from "@/modules/hermes-simulator/domain/ports/catalog";
import type { FhirHttp, FhirHttpRequest } from "@/modules/hermes-simulator/domain/ports/fhir-http";

const START = new Date("2026-06-15T14:00:00.000Z");
const END = new Date("2026-06-15T14:30:00.000Z");

function catalog(): SimCatalog {
  return {
    practitioners: async () => [
      {
        id: "prac",
        tenantId: "t",
        identifierSystem: "urn:hermes:practitioner",
        identifierValue: "P-1",
        name: "Ana",
        active: true,
      },
    ],
    services: async () => [
      {
        id: "svc",
        tenantId: "t",
        identifierSystem: "urn:hermes:healthcare-service",
        identifierValue: "S-1",
        name: "Consulta",
        active: true,
      },
    ],
    patients: async () => [],
    schedules: async () => [
      {
        id: "sch",
        tenantId: "t",
        identifierSystem: "urn:hermes:schedule",
        identifierValue: "SCH-1",
        practitionerId: "prac",
        healthcareServiceId: "svc",
        active: true,
      },
    ],
    slots: async () => [
      {
        id: "slot",
        tenantId: "t",
        identifierSystem: "urn:hermes:slot",
        identifierValue: "SL-1",
        scheduleId: "sch",
        startAt: START,
        endAt: END,
        status: "free",
      },
    ],
  };
}

describe("hermes-simulador: sincronizacion de maestros", () => {
  it("un 409 de Slot se cuenta como reintento y la corrida sigue", async () => {
    const calls: FhirHttpRequest[] = [];
    const http: FhirHttp = {
      request: vi.fn(async (input: FhirHttpRequest) => {
        calls.push(input);
        if (input.path.startsWith("Slot?")) {
          return { status: 409, body: { resourceType: "OperationOutcome" } };
        }
        const type = input.path.split("?")[0];
        return { status: 201, body: { resourceType: type, id: `pub-${type}` } };
      }),
    };
    const report = await createSyncMasters({
      catalog: catalog(),
      http,
      tokens: { issue: async () => "token" },
    })("t");
    expect(report.retryLater).toBe(1);
    expect(report.written).toBe(3);
    expect(calls.some((call) => call.path.startsWith("Slot?"))).toBe(true);
    const schedule = calls.find((call) => call.path.startsWith("Schedule?"));
    expect(schedule?.body).toMatchObject({
      actor: [
        { reference: "Practitioner/pub-Practitioner" },
        { reference: "HealthcareService/pub-HealthcareService" },
      ],
    });
  });
});
