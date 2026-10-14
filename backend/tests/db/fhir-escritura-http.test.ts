import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirPut, serviceToken } from "../helpers/fhir";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();
const identifier = (system: string, value: string) => ({ system, value });
const query = (system: string, value: string) =>
  `identifier=${encodeURIComponent(`${system}|${value}`)}`;

function practitioner(value: string, overrides: Record<string, unknown> = {}) {
  return {
    resourceType: "Practitioner",
    identifier: [identifier(HERMES_SYSTEM.practitioner, value)],
    active: true,
    name: [{ text: `Profesional ${value}` }],
    ...overrides,
  };
}

function patient(
  businessValue: string,
  documentNumber: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    resourceType: "Patient",
    identifier: [
      identifier(HERMES_SYSTEM.patient, businessValue),
      identifier("urn:ingenius:document:CC", documentNumber),
    ],
    active: true,
    name: [{ given: ["Ana"], family: "Perez" }],
    birthDate: "1990-01-15",
    ...overrides,
  };
}

function schedule(
  value: string,
  practitionerId: string,
  healthcareServiceId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    resourceType: "Schedule",
    identifier: [identifier(HERMES_SYSTEM.schedule, value)],
    active: true,
    actor: [
      { reference: `Practitioner/${practitionerId}` },
      { reference: `HealthcareService/${healthcareServiceId}` },
    ],
    ...overrides,
  };
}

function slot(
  value: string,
  scheduleId: string,
  status: "free" | "busy",
  overrides: Record<string, unknown> = {},
) {
  return {
    resourceType: "Slot",
    identifier: [identifier(HERMES_SYSTEM.slot, value)],
    schedule: { reference: `Schedule/${scheduleId}` },
    status,
    start: "2026-06-15T14:00:00.000Z",
    end: "2026-06-15T14:30:00.000Z",
    ...overrides,
  };
}

describe("fhir-escritura: PUT condicional por HTTP", () => {
  let seed: TenantDomainSeed;
  let token: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await seedTenantDomain(prisma, "a");
    token = await serviceToken(seed.tenantId);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("1. crea Practitioner con 201, Location, fila y auditoria", async () => {
    const value = "P-NUEVO";
    const { response, body } = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, value)}`,
      token,
      practitioner(value),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`http://localhost/fhir/Practitioner/${body.id}`);
    expect(
      await prisma.practitioner.findFirst({
        where: { tenantId: seed.tenantId, identifierValue: value },
      }),
    ).toMatchObject({ id: body.id, name: `Profesional ${value}` });
    expect(await prisma.auditEvent.findFirst({ where: { resourceId: body.id } })).toMatchObject({
      action: "practitioner.written_by_hermes",
      resourceType: "practitioner",
    });
  });

  it("2. actualiza el mismo identifier con 200 y conserva una sola fila", async () => {
    const value = "P-IDEM";
    const path = `Practitioner?${query(HERMES_SYSTEM.practitioner, value)}`;
    const first = await fhirPut(path, token, practitioner(value));
    const second = await fhirPut(
      path,
      token,
      practitioner(value, { name: [{ text: "Nombre actualizado" }] }),
    );

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(
      await prisma.practitioner.count({
        where: { tenantId: seed.tenantId, identifierValue: value },
      }),
    ).toBe(1);
    expect(
      (await prisma.practitioner.findUniqueOrThrow({ where: { id: first.body.id } })).name,
    ).toBe("Nombre actualizado");
  });

  it("3. confirma el pre-registro por documento conservando id y quitando el tag", async () => {
    const id = `${seed.tenantId}-pre`;
    await prisma.medicalRecord.create({
      data: {
        id,
        tenantId: seed.tenantId,
        identifierSystem: "urn:ingenius:pre-registration",
        identifierValue: id,
        documentType: "CC",
        documentNumber: "778899",
        givenNames: "Pre",
        familyNames: "Registro",
        birthDate: new Date("1990-01-15"),
        status: "pre_registered",
      },
    });

    const { response, body } = await fhirPut(
      `Patient?${query(HERMES_SYSTEM.patient, "MR-CONFIRMADO")}`,
      token,
      patient("MR-CONFIRMADO", "778899"),
    );

    expect(response.status).toBe(200);
    expect(body.id).toBe(id);
    expect(body.active).toBe(true);
    expect(body.meta).toBeUndefined();
    expect(await prisma.medicalRecord.findUniqueOrThrow({ where: { id } })).toMatchObject({
      identifierSystem: HERMES_SYSTEM.patient,
      identifierValue: "MR-CONFIRMADO",
      status: "active",
    });
  });

  it("4. rechaza con 409 un documento perteneciente a otro Patient activo", async () => {
    const before = await prisma.medicalRecord.count();
    const { response, body } = await fhirPut(
      `Patient?${query(HERMES_SYSTEM.patient, "MR-OTRO")}`,
      token,
      patient("MR-OTRO", seed.documentNumber),
    );

    expect(response.status).toBe(409);
    expect(body.issue[0].code).toBe("conflict");
    expect(await prisma.medicalRecord.count()).toBe(before);
  });

  it("5. protege un hold frente a free y lo rechaza atomicamente frente a busy", async () => {
    await prisma.slot.update({
      where: { id: seed.freeSlotId },
      data: { status: "busy_tentative" },
    });
    const hold = await prisma.appointmentRequest.create({
      data: {
        id: `${seed.tenantId}-hold`,
        tenantId: seed.tenantId,
        kind: "book",
        status: "pending",
        medicalRecordId: seed.medicalRecordId,
        slotId: seed.freeSlotId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdAt: new Date(),
      },
    });
    const path = `Slot?${query(HERMES_SYSTEM.slot, "SL-FREE-a")}`;

    const release = await fhirPut(path, token, slot("SL-FREE-a", seed.scheduleId, "free"));
    expect(release.response.status).toBe(409);
    expect(await prisma.slot.findUniqueOrThrow({ where: { id: seed.freeSlotId } })).toMatchObject({
      status: "busy_tentative",
    });
    expect(
      await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: hold.id } }),
    ).toMatchObject({ status: "pending", resolutionReason: null });

    const occupy = await fhirPut(path, token, slot("SL-FREE-a", seed.scheduleId, "busy"));
    expect(occupy.response.status).toBe(200);
    expect(await prisma.slot.findUniqueOrThrow({ where: { id: seed.freeSlotId } })).toMatchObject({
      status: "busy",
    });
    expect(
      await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: hold.id } }),
    ).toMatchObject({ status: "rejected", resolutionReason: "slot_unavailable" });
    expect(
      (await prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } })).map(
        (event) => event.action,
      ),
    ).toEqual(["slot.written_by_hermes", "appointment_request.rejected"]);
  });

  it("6. Schedule con Practitioner inexistente responde 422 processing", async () => {
    const { response, body } = await fhirPut(
      `Schedule?${query(HERMES_SYSTEM.schedule, "SCH-INVALIDA")}`,
      token,
      schedule("SCH-INVALIDA", "no-existe", seed.serviceId),
    );

    expect(response.status).toBe(422);
    expect(body.issue[0].code).toBe("processing");
    expect(await prisma.schedule.count({ where: { identifierValue: "SCH-INVALIDA" } })).toBe(0);
  });

  it("7. Appointment condicional responde 405 antes de exigir Idempotency-Key", async () => {
    const { response, body } = await fhirPut(
      `Appointment?${query(HERMES_SYSTEM.appointment, "AP-X")}`,
      token,
      { resourceType: "Appointment" },
      { "Idempotency-Key": "" },
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(body.issue[0].code).toBe("not-supported");
  });

  it("8. PUT por id es 405 y tipo desconocido es 404, ambos sin clave", async () => {
    const byId = await fhirPut("Patient/cualquiera", token, {}, { "Idempotency-Key": "" });
    expect(byId.response.status).toBe(405);
    expect(byId.response.headers.get("Allow")).toBe("GET");

    const unknown = await fhirPut("Desconocido", token, {}, { "Idempotency-Key": "" });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body.issue[0].code).toBe("not-found");
  });

  it("9. rechaza campos significativos y tolera elementos narrativos e ignorados", async () => {
    const invalid = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-GENDER")}`,
      token,
      practitioner("P-GENDER", { gender: "female" }),
    );
    expect(invalid.response.status).toBe(422);
    expect(invalid.body.issue[0].code).toBe("structure");

    const accepted = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-TOLERANTE")}`,
      token,
      practitioner("P-TOLERANTE", {
        meta: { profile: ["urn:test"] },
        text: { status: "generated", div: "<div>Profesional</div>" },
        extension: [{ url: "urn:test", valueString: "ignorado" }],
        identifier: [
          {
            ...identifier(HERMES_SYSTEM.practitioner, "P-TOLERANTE"),
            use: "official",
            extension: [{ url: "urn:test", valueString: "ignorado" }],
          },
        ],
      }),
    );
    expect(accepted.response.status).toBe(201);
  });

  it("13. valida id del cuerpo sin escribir ni auditar en los rechazos", async () => {
    const equal = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-a")}`,
      token,
      practitioner("P-a", { id: seed.practitionerId }),
    );
    expect(equal.response.status).toBe(200);

    const audits = await prisma.auditEvent.count();
    const mismatch = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-a")}`,
      token,
      practitioner("P-a", { id: "otro-id", name: [{ text: "No persistir" }] }),
    );
    expect(mismatch.response.status).toBe(400);
    expect(
      (await prisma.practitioner.findUniqueOrThrow({ where: { id: seed.practitionerId } })).name,
    ).not.toBe("No persistir");
    expect(await prisma.auditEvent.count()).toBe(audits);

    const createWithId = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-ALTA-ID")}`,
      token,
      practitioner("P-ALTA-ID", { id: "id-cliente" }),
    );
    expect(createWithId.response.status).toBe(400);
    expect(await prisma.practitioner.count({ where: { identifierValue: "P-ALTA-ID" } })).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(audits);
  });

  it("14. acepta application/json y rechaza text/plain con 415", async () => {
    const json = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-JSON")}`,
      token,
      practitioner("P-JSON"),
      { "Content-Type": "application/json" },
    );
    expect(json.response.status).toBe(201);

    const plain = await fhirPut(
      `Practitioner?${query(HERMES_SYSTEM.practitioner, "P-PLAIN")}`,
      token,
      practitioner("P-PLAIN"),
      { "Content-Type": "text/plain" },
    );
    expect(plain.response.status).toBe(415);
    expect(plain.body.issue[0].code).toBe("not-supported");
  });
});
