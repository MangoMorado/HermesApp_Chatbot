import { describe, expect, it, vi } from "vitest";
import {
  createHermesSync,
  createSyncMasters,
} from "@/modules/hermes-simulator/application/hermes-sync";
import type { InboxRequest } from "@/modules/hermes-simulator/domain/inbox";
import type { SimCatalog } from "@/modules/hermes-simulator/domain/ports/catalog";
import type { FhirHttp, FhirHttpRequest } from "@/modules/hermes-simulator/domain/ports/fhir-http";
import { encodeCursor } from "@/modules/shared/domain/pagination";

const START = new Date("2026-06-15T14:00:00.000Z");
const END = new Date("2026-06-15T14:30:00.000Z");
const WHEN = { startAt: START, endAt: END };

function catalog(overrides: Partial<SimCatalog> = {}): SimCatalog {
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
    patients: async () => [
      {
        id: "pat",
        tenantId: "t",
        identifierSystem: "urn:hermes:patient",
        identifierValue: "MR-1",
        documentType: "CC",
        documentNumber: "1000",
        givenNames: "Ana",
        familyNames: "Perez",
        birthDate: "1990-01-01",
        phone: "300",
        email: "a@b.co",
        status: "active",
      },
    ],
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
        ...WHEN,
        status: "free",
      },
    ],
    ...overrides,
  };
}

const pending: InboxRequest = {
  id: "req-1",
  kind: "book",
  status: "pending",
  createdAt: START,
  expiresAt: END,
  resolutionReason: null,
  patient: {
    identifier: { system: "urn:hermes:patient", value: "MR-1" },
    documentType: "CC",
    documentNumber: "1000",
    givenNames: "Ana",
    familyNames: "Perez",
  },
  slot: { identifier: { system: "urn:hermes:slot", value: "SL-1" }, ...WHEN },
  appointment: null,
  resultingAppointment: null,
};

describe("hermes-simulador: sync completo", () => {
  it("createHermesSync escribe maestros, cierra bandeja y confirma pre-registros", async () => {
    const calls: FhirHttpRequest[] = [];
    const http: FhirHttp = {
      request: vi.fn(async (input: FhirHttpRequest) => {
        calls.push(input);
        if (input.path.startsWith("Patient?_tag=")) {
          return {
            status: 200,
            body: {
              resourceType: "Bundle",
              total: 1,
              entry: [
                {
                  resource: {
                    resourceType: "Patient",
                    id: "pre-1",
                    identifier: [
                      { system: "urn:ingenius:pre-registration", value: "pre-1" },
                      { system: "urn:ingenius:document:CC", value: "1000" },
                    ],
                    name: [{ family: "Perez", given: ["Ana"] }],
                    birthDate: "1990-01-01",
                    telecom: [{ system: "phone", value: "300" }],
                  },
                },
              ],
            },
          };
        }
        const type = input.path.split("?")[0];
        return { status: 201, body: { resourceType: type, id: `pub-${type}` } };
      }),
    };
    const approve = vi.fn(async () => ({ ...pending, status: "approved" as const }));
    const chatbot = {
      listPending: vi.fn(async ({ cursor }: { cursor: string | null }) =>
        cursor
          ? { data: [], nextCursor: null }
          : { data: [pending], nextCursor: encodeCursor({ key: "1", id: "offset" }) },
      ),
      get: vi.fn(),
      resolve: vi.fn(),
    };
    const report = await createHermesSync({
      catalog: catalog(),
      http,
      tokens: { issue: async () => "token" },
      chatbot,
      approve,
    })("t");
    expect(report).toMatchObject({ written: 5, retryLater: 0, resolved: 1, confirmed: 1 });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t", requestId: "req-1" }),
    );
    expect(calls.some((c) => c.path.startsWith("Patient?_tag="))).toBe(true);
    expect(calls.some((c) => c.path.startsWith("Patient?identifier="))).toBe(true);
  });

  it("falla si PUT de maestro no es 2xx y si falta id publico", async () => {
    const httpFail: FhirHttp = {
      request: vi.fn(async () => ({ status: 500, body: {} })),
    };
    await expect(
      createSyncMasters({
        catalog: catalog(),
        http: httpFail,
        tokens: { issue: async () => "token" },
      })("t"),
    ).rejects.toThrow(/PUT .+ respondio 500/);

    const broken = catalog({
      schedules: async () => [
        {
          id: "sch",
          tenantId: "t",
          identifierSystem: "urn:hermes:schedule",
          identifierValue: "SCH-1",
          practitionerId: "missing-prac",
          healthcareServiceId: "svc",
          active: true,
        },
      ],
    });
    const httpOk: FhirHttp = {
      request: vi.fn(async (input) => {
        const type = input.path.split("?")[0];
        return { status: 201, body: { resourceType: type, id: `pub-${type}` } };
      }),
    };
    await expect(
      createSyncMasters({
        catalog: broken,
        http: httpOk,
        tokens: { issue: async () => "token" },
      })("t"),
    ).rejects.toThrow(/Falta el id publico/);
  });

  it("searchAll pagina hasta completar el Bundle.total", async () => {
    let offsetSeen = 0;
    const http: FhirHttp = {
      request: vi.fn(async (input) => {
        if (input.path.startsWith("Patient?_tag=")) {
          const offset = Number(
            new URLSearchParams(input.path.split("&").slice(1).join("&")).get("_offset") ?? "0",
          );
          offsetSeen = Math.max(offsetSeen, offset);
          const resource = {
            resourceType: "Patient",
            id: `pre-${offset}`,
            identifier: [{ system: "urn:ingenius:document:CC", value: `D${offset}` }],
            name: [{ family: "X", given: ["Y"] }],
            birthDate: "1990-01-01",
          };
          return {
            status: 200,
            body: {
              resourceType: "Bundle",
              total: 2,
              entry: offset >= 2 ? [] : [{ resource }],
            },
          };
        }
        const type = input.path.split("?")[0];
        return { status: 201, body: { resourceType: type, id: `pub-${type}` } };
      }),
    };
    const report = await createHermesSync({
      catalog: catalog({ patients: async () => [] }),
      http,
      tokens: { issue: async () => "token" },
      chatbot: {
        listPending: async () => ({ data: [], nextCursor: null }),
        get: vi.fn(),
        resolve: vi.fn(),
      },
      approve: vi.fn(),
    })("t");
    expect(report.confirmed).toBe(2);
    expect(offsetSeen).toBeGreaterThan(0);
  });
});
