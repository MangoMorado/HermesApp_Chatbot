import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getAppointments } from "@/app/api/v1/appointments/route";
import { GET as getAvailability } from "@/app/api/v1/availability/route";
import { GET as getHealthcareServices } from "@/app/api/v1/healthcare-services/route";
import { GET as getMedicalRecordAppointments } from "@/app/api/v1/medical-records/[id]/appointments/route";
import { GET as getMedicalRecord } from "@/app/api/v1/medical-records/[id]/route";
import { POST as findMedicalRecord } from "@/app/api/v1/medical-records/search/route";
import { GET as getPractitioners } from "@/app/api/v1/practitioners/route";
import { GET as getScheduleSlots } from "@/app/api/v1/schedules/[id]/slots/route";
import { GET as getSchedules } from "@/app/api/v1/schedules/route";
import { GET as getTenantSettings } from "@/app/api/v1/tenant-settings/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/token";
import {
  insertTenant,
  seedTenantDomain,
  type TenantDomainSeed,
  testPrisma,
  truncateAll,
} from "./support";

const prisma: PrismaClient = testPrisma();
const SYSTEM = "urn:test";

async function practitioner(tenantId: string, value: string): Promise<string> {
  const row = await prisma.practitioner.create({
    data: {
      id: `${tenantId}-${value}`,
      tenantId,
      identifierSystem: SYSTEM,
      identifierValue: value,
      name: value,
    },
  });
  return row.id;
}

async function service(tenantId: string, value: string): Promise<string> {
  const row = await prisma.healthcareService.create({
    data: {
      id: `${tenantId}-${value}`,
      tenantId,
      identifierSystem: SYSTEM,
      identifierValue: value,
      name: value,
    },
  });
  return row.id;
}

type PageBody = { data: Array<{ id: string }> };

async function operatorToken(tenantId: string): Promise<string> {
  return signToken({ role: "operator", tenantId, subject: `op-${tenantId}` });
}

async function jsonGet(handler: (req: Request) => Promise<Response>, url: string, token: string) {
  const response = await handler(authedRequest(url, token));
  const body = await response.json();
  return { response, body };
}

async function jsonGetWithParams(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  url: string,
  token: string,
  id: string,
) {
  const response = await handler(authedRequest(url, token), {
    params: Promise.resolve({ id }),
  });
  const body = await response.json();
  return { response, body };
}

async function jsonPost(
  handler: (req: Request) => Promise<Response>,
  url: string,
  token: string,
  payload: unknown,
) {
  const response = await handler(
    authedRequest(url, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  const body = await response.json();
  return { response, body };
}

function idsOf(body: PageBody): string[] {
  return body.data.map((row) => row.id);
}

describe("aislamiento-tenant: la base impide referencias entre tenants", () => {
  let tenantA: string;
  let tenantB: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    tenantA = await insertTenant(prisma, "a");
    tenantB = await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una agenda no puede apuntar al profesional de otro tenant", async () => {
    const foreignPractitioner = await practitioner(tenantB, "P-1");
    const ownService = await service(tenantA, "S-1");

    await expect(
      prisma.schedule.create({
        data: {
          id: "sched-cross",
          tenantId: tenantA,
          identifierSystem: SYSTEM,
          identifierValue: "SCH-1",
          practitionerId: foreignPractitioner,
          healthcareServiceId: ownService,
        },
      }),
    ).rejects.toThrow();
  });

  it("el mismo identificador Hermes puede existir en dos tenants", async () => {
    await practitioner(tenantA, "P-1");
    await practitioner(tenantB, "P-1");

    expect(await prisma.practitioner.count()).toBe(2);
  });

  it("el tope de rango del tenant queda entre 1 y 366", async () => {
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { maxQueryRangeDays: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { maxQueryRangeDays: 367 } }),
    ).rejects.toThrow();
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantA } })).maxQueryRangeDays,
    ).toBe(31);
  });

  it("un cupo no puede terminar antes de empezar", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        id: "sched-a",
        tenantId: tenantA,
        identifierSystem: SYSTEM,
        identifierValue: "SCH-A",
        practitionerId: await practitioner(tenantA, "P-2"),
        healthcareServiceId: await service(tenantA, "S-2"),
      },
    });

    await expect(
      prisma.slot.create({
        data: {
          id: "slot-bad",
          tenantId: tenantA,
          identifierSystem: SYSTEM,
          identifierValue: "SL-1",
          scheduleId: schedule.id,
          startAt: new Date("2026-03-02T14:00:00Z"),
          endAt: new Date("2026-03-02T13:30:00Z"),
        },
      }),
    ).rejects.toThrow();
  });
});

describe("aislamiento-tenant: rutas /api/v1 no filtran datos ajenos", () => {
  let seedA: TenantDomainSeed;
  let seedB: TenantDomainSeed;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seedA = await seedTenantDomain(prisma, "a");
    seedB = await seedTenantDomain(prisma, "b");
    tokenA = await operatorToken(seedA.tenantId);
    tokenB = await operatorToken(seedB.tenantId);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("GET /practitioners solo lista los del tenant del token", async () => {
    const { response, body } = await jsonGet(
      getPractitioners,
      "http://localhost/api/v1/practitioners",
      tokenA,
    );
    expect(response.status).toBe(200);
    expect(idsOf(body)).toEqual([seedA.practitionerId]);
  });

  it("GET /healthcare-services solo lista los del tenant del token", async () => {
    const { response, body } = await jsonGet(
      getHealthcareServices,
      "http://localhost/api/v1/healthcare-services",
      tokenA,
    );
    expect(response.status).toBe(200);
    expect(idsOf(body)).toEqual([seedA.serviceId]);
  });

  it("GET /schedules solo lista los del tenant del token", async () => {
    const { response, body } = await jsonGet(
      getSchedules,
      "http://localhost/api/v1/schedules",
      tokenA,
    );
    expect(response.status).toBe(200);
    expect(idsOf(body)).toEqual([seedA.scheduleId]);
  });

  it("GET /availability no filtra cupos de otro tenant", async () => {
    const url =
      `http://localhost/api/v1/availability?from=${seedA.from}&to=${seedA.to}` +
      `&schedule_id=${seedA.scheduleId}`;
    const { response, body } = await jsonGet(getAvailability, url, tokenA);
    expect(response.status).toBe(200);
    expect(idsOf(body)).toEqual([seedA.freeSlotId]);

    const leak = await jsonGet(
      getAvailability,
      `http://localhost/api/v1/availability?from=${seedB.from}&to=${seedB.to}` +
        `&schedule_id=${seedB.scheduleId}`,
      tokenA,
    );
    expect(leak.response.status).toBe(200);
    expect(idsOf(leak.body)).toEqual([]);
  });

  it("GET /schedules/{id}/slots con agenda ajena responde 404", async () => {
    const { response, body } = await jsonGetWithParams(
      getScheduleSlots,
      `http://localhost/api/v1/schedules/${seedB.scheduleId}/slots?from=${seedA.from}&to=${seedA.to}`,
      tokenA,
      seedB.scheduleId,
    );
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("GET /schedules/{id}/slots solo ve cupos propios", async () => {
    const { response, body } = await jsonGetWithParams(
      getScheduleSlots,
      `http://localhost/api/v1/schedules/${seedA.scheduleId}/slots?from=${seedA.from}&to=${seedA.to}`,
      tokenA,
      seedA.scheduleId,
    );
    expect(response.status).toBe(200);
    expect(idsOf(body).sort()).toEqual([seedA.busySlotId, seedA.freeSlotId].sort());
  });

  it("GET /appointments con schedule ajeno responde 404", async () => {
    const { response, body } = await jsonGet(
      getAppointments,
      `http://localhost/api/v1/appointments?schedule_id=${seedB.scheduleId}` +
        `&from=${seedA.from}&to=${seedA.to}`,
      tokenA,
    );
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("GET /appointments solo lista citas del tenant", async () => {
    const { response, body } = await jsonGet(
      getAppointments,
      `http://localhost/api/v1/appointments?schedule_id=${seedA.scheduleId}` +
        `&from=${seedA.from}&to=${seedA.to}`,
      tokenA,
    );
    expect(response.status).toBe(200);
    expect(idsOf(body)).toEqual([seedA.appointmentId]);
  });

  it("POST /medical-records/search por documento ajeno responde 404", async () => {
    const { response, body } = await jsonPost(
      findMedicalRecord,
      "http://localhost/api/v1/medical-records/search",
      tokenA,
      { document_type: "CC", document_number: seedB.documentNumber },
    );
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("POST /medical-records/search encuentra el del propio tenant", async () => {
    const { response, body } = await jsonPost(
      findMedicalRecord,
      "http://localhost/api/v1/medical-records/search",
      tokenA,
      { document_type: "CC", document_number: seedA.documentNumber },
    );
    expect(response.status).toBe(200);
    expect(body.id).toBe(seedA.medicalRecordId);
  });

  it("GET /medical-records/{id} ajeno responde 404", async () => {
    const { response, body } = await jsonGetWithParams(
      getMedicalRecord,
      `http://localhost/api/v1/medical-records/${seedB.medicalRecordId}`,
      tokenA,
      seedB.medicalRecordId,
    );
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("GET /medical-records/{id}/appointments ajeno responde 404", async () => {
    const { response, body } = await jsonGetWithParams(
      getMedicalRecordAppointments,
      `http://localhost/api/v1/medical-records/${seedB.medicalRecordId}/appointments`,
      tokenA,
      seedB.medicalRecordId,
    );
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("GET /tenant-settings lee solo el tope del tenant del token", async () => {
    await prisma.tenant.update({
      where: { id: seedB.tenantId },
      data: { maxQueryRangeDays: 90 },
    });
    const { response, body } = await jsonGet(
      getTenantSettings,
      "http://localhost/api/v1/tenant-settings",
      tokenA,
    );
    expect(response.status).toBe(200);
    expect(body.max_query_range_days).toBe(31);

    const other = await jsonGet(
      getTenantSettings,
      "http://localhost/api/v1/tenant-settings",
      tokenB,
    );
    expect(other.body.max_query_range_days).toBe(90);
  });
});
