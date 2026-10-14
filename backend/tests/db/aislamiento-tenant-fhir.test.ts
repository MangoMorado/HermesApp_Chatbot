import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { fhirGet, fhirPut, serviceToken } from "../helpers/fhir";
import {
  HERMES_SYSTEM,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();

function idsByType(seed: TenantDomainSeed): Record<string, string[]> {
  return {
    Patient: [seed.medicalRecordId],
    Practitioner: [seed.practitionerId],
    HealthcareService: [seed.serviceId],
    Schedule: [seed.scheduleId],
    Slot: [seed.freeSlotId, seed.busySlotId],
    Appointment: [seed.appointmentId],
  };
}

describe("aislamiento-tenant: /fhir no filtra datos ajenos", () => {
  let a: TenantDomainSeed;
  let b: TenantDomainSeed;
  let tokenA: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    a = await seedTenantDomain(prisma, "a");
    b = await seedTenantDomain(prisma, "b");
    tokenA = await serviceToken(a.tenantId);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("leer por id un recurso de otro tenant responde 404 not-found", async () => {
    for (const [type, ids] of Object.entries(idsByType(b))) {
      for (const id of ids) {
        const { response, body } = await fhirGet(`${type}/${id}`, tokenA);
        expect([type, response.status]).toEqual([type, 404]);
        expect(body.issue[0].code).toBe("not-found");
      }
    }
  });

  it("el 404 de un recurso ajeno es identico al de uno inexistente", async () => {
    const foreign = await fhirGet(`Patient/${b.medicalRecordId}`, tokenA);
    const missing = await fhirGet("Patient/no-existe", tokenA);
    expect(foreign.body).toEqual(missing.body);
  });

  it("cada busqueda devuelve solo los recursos del tenant del token", async () => {
    for (const [type, ids] of Object.entries(idsByType(a))) {
      const { body } = await fhirGet(type, tokenA);
      const found: string[] = (body.entry ?? []).map(
        (entry: { resource: { id: string } }) => entry.resource.id,
      );
      expect([type, found.sort()]).toEqual([type, [...ids].sort()]);
      expect(body.total).toBe(ids.length);
    }
  });

  it("buscar por el identificador Hermes de otro tenant no encuentra nada", async () => {
    const searches: Array<[string, string, string]> = [
      ["Patient", HERMES_SYSTEM.patient, "MR-b"],
      ["Practitioner", HERMES_SYSTEM.practitioner, "P-b"],
      ["HealthcareService", HERMES_SYSTEM.service, "S-b"],
      ["Schedule", HERMES_SYSTEM.schedule, "SCH-b"],
      ["Slot", HERMES_SYSTEM.slot, "SL-FREE-b"],
      ["Appointment", HERMES_SYSTEM.appointment, "AP-b"],
    ];
    for (const [type, system, value] of searches) {
      const { response, body } = await fhirGet(
        `${type}?identifier=${encodeURIComponent(`${system}|${value}`)}`,
        tokenA,
      );
      expect(response.status).toBe(200);
      expect([type, body.total]).toEqual([type, 0]);
      expect(body).not.toHaveProperty("entry");
    }
  });

  it("buscar por el documento de un paciente ajeno no encuentra nada", async () => {
    const { body } = await fhirGet(
      `Patient?identifier=${encodeURIComponent(`urn:ingenius:document:CC|${b.documentNumber}`)}`,
      tokenA,
    );
    expect(body.total).toBe(0);
  });

  it("filtrar por la referencia a un recurso ajeno devuelve vacio", async () => {
    const searches = [
      `Slot?schedule=Schedule/${b.scheduleId}`,
      `Schedule?actor=Practitioner/${b.practitionerId}`,
      `Schedule?actor=HealthcareService/${b.serviceId}`,
      `Appointment?patient=Patient/${b.medicalRecordId}`,
      `Appointment?slot=Slot/${b.busySlotId}`,
    ];
    for (const path of searches) {
      const { response, body } = await fhirGet(path, tokenA);
      expect([path, response.status, body.total]).toEqual([path, 200, 0]);
    }
  });

  it("el tenant no se puede inyectar por query ni por header", async () => {
    const byQuery = await fhirGet(`Slot?tenant_id=${b.tenantId}`, tokenA);
    expect(byQuery.response.status).toBe(400);

    const { GET } = await import("@/app/fhir/[[...path]]/route");
    const response = await GET(
      new Request("http://localhost/fhir/Practitioner", {
        headers: { Authorization: `Bearer ${tokenA}`, "X-Tenant-Id": b.tenantId },
      }),
      { params: Promise.resolve({ path: ["Practitioner"] }) },
    );
    const body = await response.json();
    expect(
      (body.entry ?? []).map((entry: { resource: { id: string } }) => entry.resource.id),
    ).toEqual([a.practitionerId]);
  });

  it("11. tenant B no modifica el identifier de A y crea su propio recurso", async () => {
    const tokenB = await serviceToken(b.tenantId);
    const value = "P-a";
    const { response, body } = await fhirPut(
      `Practitioner?identifier=${encodeURIComponent(`${HERMES_SYSTEM.practitioner}|${value}`)}`,
      tokenB,
      {
        resourceType: "Practitioner",
        identifier: [{ system: HERMES_SYSTEM.practitioner, value }],
        active: true,
        name: [{ text: "Profesional de B" }],
      },
    );

    expect(response.status).toBe(201);
    expect(body.id).not.toBe(a.practitionerId);
    expect(
      await prisma.practitioner.findUniqueOrThrow({ where: { id: a.practitionerId } }),
    ).toMatchObject({ tenantId: a.tenantId, name: "Prof a" });
    expect(
      await prisma.practitioner.findFirstOrThrow({
        where: {
          tenantId: b.tenantId,
          identifierSystem: HERMES_SYSTEM.practitioner,
          identifierValue: value,
        },
      }),
    ).toMatchObject({ id: body.id, name: "Profesional de B" });
  });

  it("una pre-agenda de otro tenant no se lee ni se resuelve", async () => {
    const id = `${b.tenantId}-book`;
    await prisma.appointmentRequest.create({
      data: {
        id,
        tenantId: b.tenantId,
        kind: "book",
        medicalRecordId: b.medicalRecordId,
        slotId: b.freeSlotId,
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    const read = await fhirGet(`Appointment/${id}`, tokenA);
    expect(read.response.status).toBe(404);
    const write = await fhirPut(`Appointment/${id}`, tokenA, {
      resourceType: "Appointment",
      status: "booked",
      identifier: [{ system: HERMES_SYSTEM.appointment, value: "AP-ajena" }],
    });
    expect(write.response.status).toBe(404);
    expect((await prisma.appointmentRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
      "pending",
    );
  });
});
