import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bookedAppointment,
  cancelledAppointment,
  completedTask,
  patientBody,
  practitionerBody,
  rejectedTask,
  scheduleBody,
  serviceBody,
  slotBody,
} from "@/modules/hermes-simulator/application/fhir-bodies";
import type { SimPatient } from "@/modules/hermes-simulator/domain/entities";
import { createFetchFhirHttp } from "@/modules/hermes-simulator/infrastructure/fetch-fhir-http";

const WHEN = {
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
};

const patient = (overrides: Partial<SimPatient> = {}): SimPatient => ({
  id: "p1",
  tenantId: "t1",
  identifierSystem: "urn:hermes:patient",
  identifierValue: "MR-1",
  documentType: "CC",
  documentNumber: "1",
  givenNames: "Ana Maria",
  familyNames: "Perez",
  birthDate: "1990-01-01",
  phone: null,
  email: null,
  status: "active",
  ...overrides,
});

describe("hermes-simulador: cuerpos FHIR", () => {
  it("arma appointment/task/named resources", () => {
    const id = { system: "urn:hermes:appointment", value: "A1" };
    expect(bookedAppointment(id)).toMatchObject({ status: "booked" });
    expect(cancelledAppointment("declined")).toMatchObject({ status: "cancelled" });
    expect(completedTask()).toEqual({ resourceType: "Task", status: "completed" });
    expect(rejectedTask("slot_unavailable")).toMatchObject({ status: "rejected" });
    expect(
      practitionerBody({
        id: "pr",
        tenantId: "t",
        identifierSystem: "urn:h:p",
        identifierValue: "1",
        name: "Dr",
        active: true,
      }),
    ).toMatchObject({ resourceType: "Practitioner", name: [{ text: "Dr" }] });
    expect(
      serviceBody({
        identifierSystem: "urn:h:s",
        identifierValue: "1",
        name: "Consulta",
        active: true,
      }),
    ).toMatchObject({ resourceType: "HealthcareService", name: "Consulta" });
    expect(
      scheduleBody(
        {
          id: "sch",
          tenantId: "t",
          identifierSystem: "urn:h:sch",
          identifierValue: "1",
          practitionerId: "pr",
          healthcareServiceId: "hs",
          active: true,
        },
        "pr",
        "hs",
      ),
    ).toMatchObject({ resourceType: "Schedule" });
    expect(
      slotBody(
        {
          id: "sl",
          tenantId: "t",
          identifierSystem: "urn:h:sl",
          identifierValue: "1",
          scheduleId: "sch",
          status: "free",
          ...WHEN,
        },
        "sch",
      ),
    ).toMatchObject({ resourceType: "Slot", status: "free" });
  });

  it("patientBody incluye telecom opcional y rechaza nombre vacio", () => {
    expect(patientBody(patient())).not.toHaveProperty("telecom");
    expect(patientBody(patient({ phone: "300", email: "a@b.co" }))).toMatchObject({
      telecom: [
        { system: "phone", value: "300" },
        { system: "email", value: "a@b.co" },
      ],
    });
    expect(() => patientBody(patient({ givenNames: "   " }))).toThrow(
      "El paciente no tiene nombre",
    );
  });
});

describe("hermes-simulador: fetch FHIR HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET sin cuerpo y PUT con Idempotency-Key", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        Response.json({ resourceType: "Patient", id: "1" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const http = createFetchFhirHttp("https://fhir.example");

    await expect(http.request({ method: "GET", path: "Patient/1", token: "tok" })).resolves.toEqual(
      {
        status: 200,
        body: { resourceType: "Patient", id: "1" },
      },
    );
    const getCall = fetchMock.mock.calls[0];
    expect(getCall?.[0]).toBe("https://fhir.example/Patient/1");
    expect(getCall?.[1]?.body).toBeUndefined();
    expect(new Headers(getCall?.[1]?.headers).get("Content-Type")).toBeNull();

    await http.request({
      method: "PUT",
      path: "Patient/1",
      token: "tok",
      body: { resourceType: "Patient" },
      idempotencyKey: "idem-1",
    });
    const putCall = fetchMock.mock.calls[1];
    const headers = new Headers(putCall?.[1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/fhir+json");
    expect(headers.get("Idempotency-Key")).toBe("idem-1");
    expect(putCall?.[1]?.body).toBe('{"resourceType":"Patient"}');
  });
});
