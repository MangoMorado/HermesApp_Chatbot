import { describe, expect, it } from "vitest";
import { assertAppointmentEcho } from "@/modules/fhir/domain/echo-agenda";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import { parseAppointmentResolution } from "@/modules/fhir/domain/parsers/appointment-resolution";
import type { AppointmentRecord } from "@/modules/fhir/domain/ports/sources";
import { REPLACES_APPOINTMENT } from "@/modules/fhir/domain/profiles";

const BUSINESS = { system: "urn:hermes:appointment", value: "APT-1" };
const REQUEST_ID = { system: "urn:ingenius:appointment-request", value: "req-1" };

const bookedBody = {
  resourceType: "Appointment",
  id: "req-1",
  status: "booked",
  identifier: [BUSINESS],
  start: "2026-06-15T14:00:00.000Z",
  end: "2026-06-15T14:30:00.000Z",
  slot: { reference: "Slot/slot-1" },
  participant: [
    { actor: { reference: "Patient/mr-1" }, status: "accepted" },
    { actor: { reference: "Practitioner/pr-1" }, status: "accepted" },
    { actor: { reference: "HealthcareService/hs-1" }, status: "accepted" },
  ],
};

const record = (overrides: Partial<AppointmentRecord> = {}): AppointmentRecord => ({
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

describe("fhir-conformance: parser Appointment resolution", () => {
  it("acepta booked con identifier de negocio y actores", () => {
    const parsed = parseAppointmentResolution(bookedBody);
    expect(parsed).toMatchObject({
      bodyId: "req-1",
      status: "booked",
      businessIdentifier: BUSINESS,
      identifier: BUSINESS,
      reason: null,
      slotId: "slot-1",
      patientId: "mr-1",
      practitionerId: "pr-1",
      serviceId: "hs-1",
      replacesAppointmentId: null,
    });
    expect(parsed.start?.toISOString()).toBe("2026-06-15T14:00:00.000Z");
  });

  it("acepta cancelled con motivo y sin identifier de negocio", () => {
    const parsed = parseAppointmentResolution({
      resourceType: "Appointment",
      status: "cancelled",
      cancelationReason: { coding: [{ code: "declined" }] },
    });
    expect(parsed.status).toBe("cancelled");
    expect(parsed.businessIdentifier).toBeNull();
    expect(parsed.reason).toBe("declined");
    expect(parsed.identifier).toBeNull();
  });

  it("lee extension replaces de un reschedule", () => {
    const parsed = parseAppointmentResolution({
      ...bookedBody,
      extension: [
        { url: "http://example.test/ignore", valueString: "x" },
        {
          url: REPLACES_APPOINTMENT,
          valueReference: { reference: "Appointment/old-1" },
        },
      ],
    });
    expect(parsed.replacesAppointmentId).toBe("old-1");
  });

  it("rechaza booked con cancelationReason", () => {
    expect(() =>
      parseAppointmentResolution({
        ...bookedBody,
        cancelationReason: { coding: [{ code: "declined" }] },
      }),
    ).toThrow(expect.objectContaining({ code: "structure" }));
  });

  it("rechaza status distinto de booked/cancelled", () => {
    expect(() =>
      parseAppointmentResolution({ resourceType: "Appointment", status: "proposed" }),
    ).toThrow(FhirError);
  });

  it("exige identifier de negocio hermes al aprobar", () => {
    expect(() =>
      parseAppointmentResolution({
        resourceType: "Appointment",
        status: "booked",
        identifier: [REQUEST_ID],
      }),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining("negocio") }));
  });

  it("rechaza identifier con mas de una entrada", () => {
    expect(() =>
      parseAppointmentResolution({
        ...bookedBody,
        identifier: [BUSINESS, { system: "urn:x", value: "2" }],
      }),
    ).toThrow(FhirError);
  });

  it("rechaza instants sin offset o invalidos", () => {
    expect(() =>
      parseAppointmentResolution({ ...bookedBody, start: "2026-06-15T14:00:00" }),
    ).toThrow(FhirError);
    expect(() => parseAppointmentResolution({ ...bookedBody, end: "no-es-fechaZ" })).toThrow(
      FhirError,
    );
  });

  it("rechaza motivo desconocido o coding vacio", () => {
    expect(() =>
      parseAppointmentResolution({
        resourceType: "Appointment",
        status: "cancelled",
        cancelationReason: { coding: [{ code: "otro" }] },
      }),
    ).toThrow(FhirError);
    expect(() =>
      parseAppointmentResolution({
        resourceType: "Appointment",
        status: "cancelled",
        cancelationReason: { coding: [] },
      }),
    ).toThrow(FhirError);
  });

  it("rechaza extension no lista, replaces repetido o participantes invalidos", () => {
    expect(() =>
      parseAppointmentResolution({ ...bookedBody, extension: { url: REPLACES_APPOINTMENT } }),
    ).toThrow(FhirError);
    expect(() =>
      parseAppointmentResolution({
        ...bookedBody,
        extension: [
          { url: REPLACES_APPOINTMENT, valueReference: { reference: "Appointment/a" } },
          { url: REPLACES_APPOINTMENT, valueReference: { reference: "Appointment/b" } },
        ],
      }),
    ).toThrow(FhirError);
    expect(() => parseAppointmentResolution({ ...bookedBody, participant: { actor: {} } })).toThrow(
      FhirError,
    );
    expect(() =>
      parseAppointmentResolution({
        ...bookedBody,
        participant: [
          { actor: { reference: "Patient/mr-1" } },
          { actor: { reference: "Patient/mr-2" } },
        ],
      }),
    ).toThrow(FhirError);
    expect(() =>
      parseAppointmentResolution({
        ...bookedBody,
        participant: [
          { actor: { reference: "Patient/mr-1" } },
          { actor: { reference: "Practitioner/pr-1" } },
        ],
      }),
    ).toThrow(FhirError);
    expect(() =>
      parseAppointmentResolution({
        ...bookedBody,
        participant: [{ actor: { reference: "Organization/org-1" } }],
      }),
    ).toThrow(FhirError);
  });
});

describe("fhir-conformance: eco Appointment", () => {
  it("acepta omisiones y coincidencias", () => {
    const parsed = parseAppointmentResolution({
      resourceType: "Appointment",
      status: "booked",
      identifier: [BUSINESS],
    });
    expect(() => assertAppointmentEcho(parsed, record())).not.toThrow();
  });

  it("rechaza campos que no coinciden con el recurso", () => {
    const parsed = parseAppointmentResolution(bookedBody);
    expect(() => assertAppointmentEcho(parsed, record({ slotId: "otro" }))).toThrow(
      expect.objectContaining({ code: "structure" }),
    );
    expect(() =>
      assertAppointmentEcho(
        parseAppointmentResolution({
          ...bookedBody,
          extension: [
            { url: REPLACES_APPOINTMENT, valueReference: { reference: "Appointment/old" } },
          ],
        }),
        record({ replacesAppointmentId: "otro" }),
      ),
    ).toThrow(FhirError);
  });

  it("en cancelled el identifier debe coincidir si viene", () => {
    const parsed = parseAppointmentResolution({
      resourceType: "Appointment",
      status: "cancelled",
      identifier: [REQUEST_ID],
    });
    expect(() => assertAppointmentEcho(parsed, record())).not.toThrow();
    expect(() => assertAppointmentEcho(parsed, record({ identifier: BUSINESS }))).toThrow(
      FhirError,
    );
  });
});
