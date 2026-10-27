import { describe, expect, it } from "vitest";
import { assertTaskEcho } from "@/modules/fhir/domain/echo-agenda";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import { parseTaskResolution } from "@/modules/fhir/domain/parsers/task-resolution";
import type { TaskRecord } from "@/modules/fhir/domain/ports/sources";

const ID = { system: "urn:ingenius:appointment-request", value: "task-1" };

const completedBody = {
  resourceType: "Task",
  id: "task-1",
  status: "completed",
  intent: "proposal",
  focus: { reference: "Appointment/appt-1" },
  for: { reference: "Patient/mr-1" },
  identifier: [ID],
};

const record = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "task-1",
  identifier: ID,
  status: "requested",
  medicalRecordId: "mr-1",
  focusAppointmentId: "appt-1",
  statusReason: null,
  ...overrides,
});

describe("fhir-conformance: parser Task resolution", () => {
  it("acepta completed sin statusReason", () => {
    const parsed = parseTaskResolution(completedBody);
    expect(parsed).toEqual({
      bodyId: "task-1",
      status: "completed",
      identifier: ID,
      reason: null,
      focusAppointmentId: "appt-1",
      patientId: "mr-1",
    });
  });

  it("acepta rejected con motivo y sin focus/for", () => {
    const parsed = parseTaskResolution({
      resourceType: "Task",
      status: "rejected",
      statusReason: { coding: [{ code: "slot_unavailable" }] },
    });
    expect(parsed.status).toBe("rejected");
    expect(parsed.reason).toBe("slot_unavailable");
    expect(parsed.focusAppointmentId).toBeNull();
    expect(parsed.patientId).toBeNull();
  });

  it("rechaza completed con statusReason", () => {
    expect(() =>
      parseTaskResolution({
        ...completedBody,
        statusReason: { coding: [{ code: "declined" }] },
      }),
    ).toThrow(expect.objectContaining({ code: "structure" }));
  });

  it("rechaza status o intent invalidos", () => {
    expect(() => parseTaskResolution({ resourceType: "Task", status: "requested" })).toThrow(
      FhirError,
    );
    expect(() => parseTaskResolution({ ...completedBody, intent: "order" })).toThrow(FhirError);
  });

  it("rechaza identifier multiple o motivo invalido", () => {
    expect(() =>
      parseTaskResolution({
        ...completedBody,
        identifier: [ID, { system: "urn:x", value: "2" }],
      }),
    ).toThrow(FhirError);
    expect(() =>
      parseTaskResolution({
        resourceType: "Task",
        status: "rejected",
        statusReason: { coding: [] },
      }),
    ).toThrow(FhirError);
    expect(() =>
      parseTaskResolution({
        resourceType: "Task",
        status: "rejected",
        statusReason: { coding: [{ code: "otro" }] },
      }),
    ).toThrow(FhirError);
  });
});

describe("fhir-conformance: eco Task", () => {
  it("acepta omisiones y rechaza desajustes", () => {
    expect(() =>
      assertTaskEcho(parseTaskResolution({ resourceType: "Task", status: "completed" }), record()),
    ).not.toThrow();
    expect(() =>
      assertTaskEcho(parseTaskResolution(completedBody), record({ focusAppointmentId: "otro" })),
    ).toThrow(FhirError);
    expect(() =>
      assertTaskEcho(
        parseTaskResolution({ ...completedBody, identifier: [{ system: "urn:x", value: "y" }] }),
        record(),
      ),
    ).toThrow(FhirError);
  });
});
