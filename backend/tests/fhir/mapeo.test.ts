import { describe, expect, it } from "vitest";
import { toAppointment } from "@/modules/fhir/domain/mappers/appointment";
import { toHealthcareService } from "@/modules/fhir/domain/mappers/healthcare-service";
import { toPatient } from "@/modules/fhir/domain/mappers/patient";
import { toPractitioner } from "@/modules/fhir/domain/mappers/practitioner";
import { toSchedule } from "@/modules/fhir/domain/mappers/schedule";
import { toSlot } from "@/modules/fhir/domain/mappers/slot";
import type { PatientRecord } from "@/modules/fhir/domain/ports/sources";
import {
  documentCodeOf,
  documentSystem,
  isResourceType,
  slotStatusKeyOf,
} from "@/modules/fhir/domain/profiles";

const IDENTIFIER = { system: "urn:hermes:x", value: "X-1" };

const patient: PatientRecord = {
  id: "mr-1",
  identifier: { system: "urn:hermes:patient", value: "MR-1" },
  documentType: "CC",
  documentNumber: "1000",
  givenNames: "Ana  Maria",
  familyNames: "Perez Gomez",
  birthDate: "1990-01-15",
  phone: "3001234567",
  email: null,
  status: "active",
};

describe("fhir-conformance: perfiles", () => {
  it("el system de documento va y vuelve", () => {
    expect(documentCodeOf(documentSystem("TI"))).toBe("TI");
    expect(documentCodeOf("urn:hermes:patient")).toBeNull();
    expect(documentCodeOf("urn:ingenius:document:XX")).toBeNull();
  });

  it("reconoce solo los seis tipos de recurso", () => {
    expect(isResourceType("Slot")).toBe(true);
    expect(isResourceType("Task")).toBe(false);
    expect(isResourceType("slot")).toBe(false);
  });

  it("traduce el estado FHIR de un cupo a su clave interna", () => {
    expect(slotStatusKeyOf("busy-tentative")).toBe("busy_tentative");
    expect(slotStatusKeyOf("busy_tentative")).toBeNull();
  });
});

describe("fhir-conformance: Patient", () => {
  it("lleva el identificador Hermes y el documento", () => {
    expect(toPatient(patient)).toEqual({
      resourceType: "Patient",
      id: "mr-1",
      identifier: [
        { system: "urn:hermes:patient", value: "MR-1" },
        { system: "urn:ingenius:document:CC", value: "1000" },
      ],
      active: true,
      name: [{ family: "Perez Gomez", given: ["Ana", "Maria"] }],
      birthDate: "1990-01-15",
      telecom: [{ system: "phone", value: "3001234567" }],
    });
  });

  it("sin telefono ni correo no lleva telecom", () => {
    expect(toPatient({ ...patient, phone: null })).not.toHaveProperty("telecom");
  });

  it("un pre-registro lleva el tag pre-registered", () => {
    expect(toPatient({ ...patient, status: "pre_registered" }).meta).toEqual({
      tag: [{ system: "urn:ingenius:patient-tag", code: "pre-registered" }],
    });
    expect(toPatient(patient)).not.toHaveProperty("meta");
  });

  it("no filtra campos internos del registro", () => {
    const withTenant = { ...patient, tenantId: "tenant-a" };
    expect(JSON.stringify(toPatient(withTenant))).not.toContain("tenant-a");
  });
});

describe("fhir-conformance: maestros", () => {
  it("Practitioner", () => {
    expect(
      toPractitioner({ id: "p-1", identifier: IDENTIFIER, name: "Dra. Ruiz", active: true }),
    ).toEqual({
      resourceType: "Practitioner",
      id: "p-1",
      identifier: [IDENTIFIER],
      active: true,
      name: [{ text: "Dra. Ruiz" }],
    });
  });

  it("HealthcareService", () => {
    expect(
      toHealthcareService({
        id: "s-1",
        identifier: IDENTIFIER,
        name: "Odontologia",
        active: false,
      }),
    ).toEqual({
      resourceType: "HealthcareService",
      id: "s-1",
      identifier: [IDENTIFIER],
      active: false,
      name: "Odontologia",
    });
  });

  it("Schedule referencia al profesional y al servicio", () => {
    expect(
      toSchedule({
        id: "sch-1",
        identifier: IDENTIFIER,
        practitionerId: "p-1",
        healthcareServiceId: "s-1",
        active: true,
      }),
    ).toEqual({
      resourceType: "Schedule",
      id: "sch-1",
      identifier: [IDENTIFIER],
      active: true,
      actor: [{ reference: "Practitioner/p-1" }, { reference: "HealthcareService/s-1" }],
    });
  });
});

describe("fhir-conformance: Slot y Appointment", () => {
  const startAt = new Date("2026-06-15T14:00:00.000Z");
  const endAt = new Date("2026-06-15T14:30:00.000Z");

  it("Slot traduce el estado al value set de R4", () => {
    expect(
      toSlot({
        id: "sl-1",
        identifier: IDENTIFIER,
        scheduleId: "sch-1",
        startAt,
        endAt,
        status: "busy_tentative",
      }),
    ).toEqual({
      resourceType: "Slot",
      id: "sl-1",
      identifier: [IDENTIFIER],
      schedule: { reference: "Schedule/sch-1" },
      status: "busy-tentative",
      start: "2026-06-15T14:00:00.000Z",
      end: "2026-06-15T14:30:00.000Z",
    });
  });

  it("Appointment lleva cupo y los tres participantes", () => {
    expect(
      toAppointment({
        id: "ap-1",
        identifier: IDENTIFIER,
        medicalRecordId: "mr-1",
        slotId: "sl-1",
        practitionerId: "p-1",
        healthcareServiceId: "s-1",
        startAt,
        endAt,
        status: "booked",
      }),
    ).toEqual({
      resourceType: "Appointment",
      id: "ap-1",
      identifier: [IDENTIFIER],
      status: "booked",
      start: "2026-06-15T14:00:00.000Z",
      end: "2026-06-15T14:30:00.000Z",
      slot: [{ reference: "Slot/sl-1" }],
      participant: [
        { actor: { reference: "Patient/mr-1" }, status: "accepted" },
        { actor: { reference: "Practitioner/p-1" }, status: "accepted" },
        { actor: { reference: "HealthcareService/s-1" }, status: "accepted" },
      ],
    });
  });
});
