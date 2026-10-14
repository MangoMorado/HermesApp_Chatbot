import { describe, expect, it } from "vitest";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import { parseHealthcareServiceBody } from "@/modules/fhir/domain/parsers/healthcare-service";
import { parsePatientBody } from "@/modules/fhir/domain/parsers/patient";
import { parsePractitionerBody } from "@/modules/fhir/domain/parsers/practitioner";
import { parseScheduleBody } from "@/modules/fhir/domain/parsers/schedule";
import { parseSlotBody } from "@/modules/fhir/domain/parsers/slot";

const patientQuery = { system: "urn:hermes:patient", value: "MR-1" };
const practitionerQuery = { system: "urn:hermes:practitioner", value: "P-1" };
const serviceQuery = { system: "urn:hermes:service", value: "SVC-1" };
const scheduleQuery = { system: "urn:hermes:schedule", value: "SCH-1" };
const slotQuery = { system: "urn:hermes:slot", value: "SL-1" };

describe("fhir-conformance: parsers de escritura", () => {
  it("acepta un Patient minimo y entrega el id del cuerpo", () => {
    const parsed = parsePatientBody(
      {
        resourceType: "Patient",
        id: "ignorar",
        identifier: [patientQuery, { system: "urn:ingenius:document:CC", value: "123" }],
        name: [{ family: "Perez", given: ["Ana", "Maria"] }],
        birthDate: "1990-01-02",
      },
      patientQuery,
    );

    expect(parsed).toEqual({
      bodyId: "ignorar",
      queryIdentifier: patientQuery,
      businessIdentifier: patientQuery,
      documentType: "CC",
      documentNumber: "123",
      givenNames: "Ana Maria",
      familyNames: "Perez",
      birthDate: "1990-01-02",
      phone: null,
      email: null,
    });
  });

  it("acepta telecom y active true en Patient", () => {
    const parsed = parsePatientBody(
      {
        resourceType: "Patient",
        identifier: [patientQuery, { system: "urn:ingenius:document:CE", value: "456" }],
        active: true,
        name: [{ family: "Lopez", given: ["Luz"] }],
        birthDate: "2000-12-31",
        telecom: [
          { system: "phone", value: "3001234567" },
          { system: "email", value: "luz@example.test" },
        ],
      },
      patientQuery,
    );

    expect(parsed.phone).toBe("3001234567");
    expect(parsed.email).toBe("luz@example.test");
  });

  it("rechaza el tag pre-registered como regla de negocio", () => {
    const base = {
      resourceType: "Patient",
      identifier: [patientQuery, { system: "urn:ingenius:document:CC", value: "123" }],
      name: [{ family: "Perez", given: ["Ana"] }],
      birthDate: "1990-01-02",
    };

    expect(() =>
      parsePatientBody(
        {
          ...base,
          meta: {
            tag: [{ system: "urn:ingenius:patient-tag", code: "pre-registered" }],
          },
        },
        patientQuery,
      ),
    ).toThrow(expect.objectContaining({ status: 422, code: "business-rule" }));
  });

  it("rechaza active false e identificadores Patient invalidos", () => {
    const base = {
      resourceType: "Patient",
      identifier: [patientQuery, { system: "urn:ingenius:document:CC", value: "123" }],
      name: [{ family: "Perez", given: ["Ana"] }],
      birthDate: "1990-01-02",
    };

    expect(() => parsePatientBody({ ...base, active: false }, patientQuery)).toThrow(FhirError);
    expect(() =>
      parsePatientBody(
        {
          ...base,
          identifier: [
            { system: "urn:ingenius:pre-registration", value: "PRE-1" },
            { system: "urn:ingenius:document:CC", value: "123" },
          ],
        },
        { system: "urn:ingenius:pre-registration", value: "PRE-1" },
      ),
    ).toThrow(FhirError);
  });

  it("acepta identifier de negocio con sufijo pre-registration distinto al de pre-registro", () => {
    const hermesBusiness = { system: "urn:other:pre-registration", value: "MR-HERMES" };
    const parsed = parsePatientBody(
      {
        resourceType: "Patient",
        identifier: [hermesBusiness, { system: "urn:ingenius:document:CC", value: "123" }],
        name: [{ family: "Perez", given: ["Ana"] }],
        birthDate: "1990-01-02",
      },
      hermesBusiness,
    );

    expect(parsed.businessIdentifier).toEqual(hermesBusiness);
    expect(parsed.documentType).toBe("CC");
  });

  it("exige identifier de la query en el cuerpo", () => {
    expect(() =>
      parsePatientBody(
        {
          resourceType: "Patient",
          identifier: [
            { system: "urn:hermes:patient", value: "OTRO" },
            { system: "urn:ingenius:document:CC", value: "123" },
          ],
          name: [{ family: "Perez", given: ["Ana"] }],
          birthDate: "1990-01-02",
        },
        patientQuery,
      ),
    ).toThrow(FhirError);
  });

  it("rechaza una birthDate que no existe como FhirError", () => {
    expect(() =>
      parsePatientBody(
        {
          resourceType: "Patient",
          identifier: [patientQuery, { system: "urn:ingenius:document:CC", value: "123" }],
          name: [{ family: "Perez", given: ["Ana"] }],
          birthDate: "1990-99-99",
        },
        patientQuery,
      ),
    ).toThrow(FhirError);
  });

  it("parsea Practitioner y HealthcareService", () => {
    expect(
      parsePractitionerBody(
        {
          resourceType: "Practitioner",
          id: "ignorar",
          identifier: [practitionerQuery],
          active: true,
          name: [{ text: "Dra. Ana Perez" }],
        },
        practitionerQuery,
      ),
    ).toEqual({
      bodyId: "ignorar",
      identifier: practitionerQuery,
      name: "Dra. Ana Perez",
      active: true,
    });
    expect(
      parseHealthcareServiceBody(
        {
          resourceType: "HealthcareService",
          identifier: [serviceQuery],
          active: false,
          name: "Cardiologia",
        },
        serviceQuery,
      ),
    ).toEqual({
      bodyId: null,
      identifier: serviceQuery,
      name: "Cardiologia",
      active: false,
    });
  });

  it("rechaza campos de mas y formas incompletas en maestros", () => {
    expect(() =>
      parsePractitionerBody(
        {
          resourceType: "Practitioner",
          identifier: [practitionerQuery],
          active: true,
          name: [{ text: "Dr" }],
          gender: "male",
        },
        practitionerQuery,
      ),
    ).toThrow(FhirError);
    expect(() =>
      parseHealthcareServiceBody(
        {
          resourceType: "HealthcareService",
          identifier: [serviceQuery],
          name: "",
          active: true,
        },
        serviceQuery,
      ),
    ).toThrow(FhirError);
  });

  it("parsea Schedule con sus dos actores", () => {
    expect(
      parseScheduleBody(
        {
          resourceType: "Schedule",
          identifier: [scheduleQuery],
          active: true,
          actor: [{ reference: "Practitioner/pr-1" }, { reference: "HealthcareService/svc-1" }],
        },
        scheduleQuery,
      ),
    ).toEqual({
      bodyId: null,
      identifier: scheduleQuery,
      active: true,
      practitionerId: "pr-1",
      healthcareServiceId: "svc-1",
    });
  });

  it("rechaza actores ausentes o duplicados en Schedule", () => {
    expect(() =>
      parseScheduleBody(
        {
          resourceType: "Schedule",
          identifier: [scheduleQuery],
          active: true,
          actor: [{ reference: "Practitioner/pr-1" }],
        },
        scheduleQuery,
      ),
    ).toThrow(FhirError);
    expect(() =>
      parseScheduleBody(
        {
          resourceType: "Schedule",
          identifier: [scheduleQuery],
          active: true,
          actor: [{ reference: "Practitioner/pr-1" }, { reference: "Practitioner/pr-2" }],
        },
        scheduleQuery,
      ),
    ).toThrow(FhirError);
  });

  it("parsea Slot y convierte su estado y fechas", () => {
    const parsed = parseSlotBody(
      {
        resourceType: "Slot",
        id: "ignorar",
        identifier: [slotQuery],
        schedule: { reference: "Schedule/sch-1" },
        status: "busy-unavailable",
        start: "2026-06-15T13:00:00-05:00",
        end: "2026-06-15T14:00:00-05:00",
      },
      slotQuery,
    );

    expect(parsed.identifier).toEqual(slotQuery);
    expect(parsed.bodyId).toBe("ignorar");
    expect(parsed.scheduleId).toBe("sch-1");
    expect(parsed.status).toBe("busy_unavailable");
    expect(parsed.startAt.toISOString()).toBe("2026-06-15T18:00:00.000Z");
    expect(parsed.endAt.toISOString()).toBe("2026-06-15T19:00:00.000Z");
  });

  it("exige offset, fechas validas y start anterior a end en Slot", () => {
    const base = {
      resourceType: "Slot",
      identifier: [slotQuery],
      schedule: { reference: "Schedule/sch-1" },
      status: "free",
      start: "2026-06-15T14:00:00.000Z",
      end: "2026-06-15T15:00:00.000Z",
    };

    expect(() => parseSlotBody({ ...base, start: "2026-06-15T14:00:00" }, slotQuery)).toThrow(
      expect.objectContaining({ status: 422, code: "processing" }),
    );
    expect(() => parseSlotBody({ ...base, start: "fecha-invalida" }, slotQuery)).toThrow(
      expect.objectContaining({ status: 422, code: "processing" }),
    );
    expect(() => parseSlotBody({ ...base, end: "2026-06-15T13:00:00.000Z" }, slotQuery)).toThrow(
      expect.objectContaining({ status: 422, code: "processing" }),
    );
  });

  it("ignora metadatos y elementos no persistidos de tipos de dato", () => {
    const parsed = parsePatientBody(
      {
        resourceType: "Patient",
        meta: {
          versionId: "3",
          tag: [{ system: "urn:otro", code: "externo" }],
        },
        text: { status: "generated", div: "<div>Ana</div>" },
        extension: [{ url: "urn:x", valueString: "y" }],
        identifier: [
          {
            use: "official",
            type: { text: "Historia" },
            period: { start: "2020-01-01" },
            extension: [],
            ...patientQuery,
          },
          {
            system: "urn:ingenius:document:CC",
            value: "123",
            use: "official",
            type: { text: "CC" },
          },
        ],
        name: [
          {
            use: "official",
            text: "Ana Perez",
            family: "Perez",
            given: ["Ana"],
            prefix: ["Sra."],
            suffix: [],
            period: {},
            extension: [],
          },
        ],
        telecom: [
          {
            system: "phone",
            value: "300",
            use: "mobile",
            rank: 1,
            period: {},
            extension: [],
          },
        ],
        birthDate: "1990-01-02",
      },
      patientQuery,
    );

    expect(parsed.phone).toBe("300");
    expect(parsed.bodyId).toBeNull();
  });

  it("ignora metadatos en referencias y actores", () => {
    const parsed = parseScheduleBody(
      {
        resourceType: "Schedule",
        meta: {},
        text: {},
        extension: [],
        identifier: [{ ...scheduleQuery, use: "official" }],
        active: true,
        actor: [
          {
            reference: "Practitioner/pr-1",
            display: "Dra. Ana",
            type: "Practitioner",
            extension: [],
          },
          {
            reference: "HealthcareService/svc-1",
            display: "Cardiologia",
            type: "HealthcareService",
          },
        ],
      },
      scheduleQuery,
    );

    expect(parsed.practitionerId).toBe("pr-1");
    expect(parsed.healthcareServiceId).toBe("svc-1");
  });

  it("rechaza elementos no guardados y modifierExtension como estructura", () => {
    const base = {
      resourceType: "Practitioner",
      identifier: [practitionerQuery],
      active: true,
      name: [{ text: "Dr" }],
    };

    expect(() => parsePractitionerBody({ ...base, gender: "male" }, practitionerQuery)).toThrow(
      expect.objectContaining({ status: 422, code: "structure" }),
    );
    expect(() =>
      parsePractitionerBody(
        { ...base, name: [{ text: "Dr", modifierExtension: [{ url: "urn:x" }] }] },
        practitionerQuery,
      ),
    ).toThrow(expect.objectContaining({ status: 422, code: "structure" }));
  });

  it("clasifica valores y referencias invalidos como processing", () => {
    const slotBase = {
      resourceType: "Slot",
      identifier: [slotQuery],
      schedule: { reference: "Schedule/sch-1" },
      status: "free",
      start: "2026-06-15T14:00:00.000Z",
      end: "2026-06-15T15:00:00.000Z",
    };

    expect(() => parseSlotBody({ ...slotBase, status: "desconocido" }, slotQuery)).toThrow(
      expect.objectContaining({ status: 422, code: "processing" }),
    );
    expect(() =>
      parseSlotBody({ ...slotBase, schedule: { reference: "Practitioner/pr-1" } }, slotQuery),
    ).toThrow(expect.objectContaining({ status: 422, code: "processing" }));
  });
});
