import { describe, expect, it } from "vitest";
import { fromAppointment, fromTask } from "@/modules/hermes-simulator/application/fhir-inbox-map";
import {
  asRecord,
  bundleEntries,
  bundleTotal,
  firstReferenceId,
  readIdentifiers,
  referenceId,
  requiredString,
} from "@/modules/hermes-simulator/application/fhir-json";
import { REPLACES_EXTENSION } from "@/modules/hermes-simulator/domain/fhir-contract";

const WHEN = "2026-06-15T14:00:00.000Z";
const END = "2026-06-15T14:30:00.000Z";

const patient = {
  resourceType: "Patient",
  id: "pat-1",
  identifier: [
    { system: "urn:hermes:patient", value: "MR-a" },
    { system: "urn:ingenius:document:CC", value: "1000a" },
  ],
  name: [{ family: "Apellido", given: ["Nombre"] }],
};

const slot = {
  resourceType: "Slot",
  id: "slot-1",
  identifier: [{ system: "urn:hermes:slot", value: "SL-1" }],
  start: WHEN,
  end: END,
};

const appointment = {
  resourceType: "Appointment",
  id: "req-1",
  status: "proposed",
  identifier: [{ system: "urn:ingenius:appointment-request", value: "req-1" }],
  start: WHEN,
  end: END,
  slot: [{ reference: "Slot/slot-1" }],
  participant: [{ actor: { reference: "Patient/pat-1" }, status: "accepted" }],
};

describe("hermes-simulador: fhir-json", () => {
  it("asRecord y requiredString rechazan formas invalidas", () => {
    expect(() => asRecord(null, "x")).toThrow("x no es un objeto");
    expect(() => asRecord([], "x")).toThrow("x no es un objeto");
    expect(() => requiredString({}, "id")).toThrow("id es obligatorio");
    expect(() => requiredString({ id: "" }, "id")).toThrow("id es obligatorio");
  });

  it("readIdentifiers exige una lista", () => {
    expect(() => readIdentifiers({ system: "a", value: "b" })).toThrow(TypeError);
    expect(() => readIdentifiers({ system: "a", value: "b" })).toThrow(
      "identifier debe ser una lista",
    );
    expect(readIdentifiers([])).toEqual([]);
  });

  it("referenceId y firstReferenceId validan el prefijo", () => {
    expect(referenceId({ reference: "Patient/p-1" }, "Patient")).toBe("p-1");
    expect(() => referenceId({ reference: "Slot/s-1" }, "Patient")).toThrow(
      "referencia Patient invalida",
    );
    expect(() => referenceId({ reference: "Patient/a/b" }, "Patient")).toThrow(
      "referencia Patient invalida",
    );
    expect(() => firstReferenceId(undefined, "Slot")).toThrow("Slot es obligatorio");
    expect(() => firstReferenceId([], "Slot")).toThrow("Slot es obligatorio");
  });

  it("bundleEntries y bundleTotal exigen formas FHIR", () => {
    expect(bundleEntries({ entry: undefined })).toEqual([]);
    expect(() => bundleEntries({ entry: { resource: {} } })).toThrow(TypeError);
    expect(() => bundleEntries({ entry: { resource: {} } })).toThrow("Bundle.entry invalido");
    expect(bundleTotal({ total: 2 })).toBe(2);
    expect(() => bundleTotal({ total: "2" })).toThrow(TypeError);
    expect(() => bundleTotal({ total: "2" })).toThrow("Bundle.total es obligatorio");
  });
});

describe("hermes-simulador: fhir-inbox-map", () => {
  const load = async (path: string) => {
    if (path === "Patient/pat-1") {
      return patient;
    }
    if (path === "Slot/slot-1") {
      return slot;
    }
    if (path === "Appointment/old-1") {
      return { ...appointment, id: "old-1", status: "booked" };
    }
    throw new Error(`no mock: ${path}`);
  };

  it("mapea un Appointment proposed a book", async () => {
    const mapped = await fromAppointment(load, appointment);
    expect(mapped).toMatchObject({
      id: "req-1",
      kind: "book",
      status: "pending",
      patient: { documentNumber: "1000a", identifier: { value: "MR-a" } },
      slot: { identifier: { value: "SL-1" } },
    });
  });

  it("rechaza start/end invalidos con TypeError", async () => {
    await expect(
      fromAppointment(load, { ...appointment, start: "no-es-fecha", end: END }),
    ).rejects.toThrow(TypeError);
    await expect(
      fromAppointment(load, { ...appointment, start: "no-es-fecha", end: END }),
    ).rejects.toThrow("start o end invalidos");
  });

  it("exige participant como lista", async () => {
    await expect(
      fromAppointment(load, { ...appointment, participant: { actor: {} } }),
    ).rejects.toThrow(TypeError);
    await expect(
      fromAppointment(load, { ...appointment, participant: { actor: {} } }),
    ).rejects.toThrow("participant es obligatorio");
  });

  it("exige extension como lista cuando viene", async () => {
    await expect(
      fromAppointment(load, { ...appointment, extension: { url: REPLACES_EXTENSION } }),
    ).rejects.toThrow(TypeError);
    await expect(
      fromAppointment(load, { ...appointment, extension: { url: REPLACES_EXTENSION } }),
    ).rejects.toThrow("extension invalida");
  });

  it("extension replaces sin coincidencia deja appointment null", async () => {
    const mapped = await fromAppointment(load, {
      ...appointment,
      extension: [
        { url: "http://example.test/other", valueReference: { reference: "Appointment/x" } },
      ],
    });
    expect(mapped.kind).toBe("book");
    expect(mapped.appointment).toBeNull();
  });

  it("mapea Task de cancelacion", async () => {
    const mapped = await fromTask(load, {
      resourceType: "Task",
      id: "task-1",
      status: "requested",
      focus: { reference: "Appointment/old-1" },
      for: { reference: "Patient/pat-1" },
    });
    expect(mapped).toMatchObject({
      id: "task-1",
      kind: "cancel",
      status: "pending",
      appointment: { identifier: { value: "req-1" } },
      slot: null,
    });
  });

  it("rechaza Patient incompleto y participante faltante", async () => {
    await expect(
      fromAppointment(
        async (path) =>
          path.startsWith("Patient/")
            ? { ...patient, identifier: [{ system: "urn:ingenius:document:CC", value: "1" }] }
            : load(path),
        appointment,
      ),
    ).rejects.toThrow("Patient sin identificador");

    await expect(
      fromAppointment(load, {
        ...appointment,
        participant: [{ actor: { reference: "Practitioner/p-1" }, status: "accepted" }],
      }),
    ).rejects.toThrow("falta el participante Patient");
  });
});
