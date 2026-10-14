import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveInbox } from "@/app/api/sim/v1/inbox/[id]/approve/route";
import { POST as rejectInbox } from "@/app/api/sim/v1/inbox/[id]/reject/route";
import { GET as listSimInbox } from "@/app/api/sim/v1/inbox/route";
import { POST as postSimPractitioner } from "@/app/api/sim/v1/practitioners/route";
import { PATCH as patchTenantSettings } from "@/app/api/v1/tenant-settings/route";
import { resetContainer } from "@/composition-root";
import { fhirPut } from "../helpers/fhir";
import { authedRequest, signToken } from "../helpers/token";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  inboxPost,
  seedWorld,
  slotAt,
} from "./pre-agenda-support";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

async function adminToken(tenantId: string): Promise<string> {
  return signToken({ role: "admin", tenantId, subject: `admin-${tenantId}` });
}

function writeRequest(
  url: string,
  token: string,
  key: string,
  body: unknown,
  method: "PATCH" | "POST" = "PATCH",
): Request {
  return authedRequest(url, token, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

describe("idempotencia: escrituras HTTP", () => {
  let tenantId: string;
  let token: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    tenantId = await insertTenant(prisma, "a");
    token = await adminToken(tenantId);
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("PATCH /tenant-settings: misma clave y cuerpo repite la respuesta sin duplicar auditoria", async () => {
    const key = "idem-settings-1";
    const body = { max_query_range_days: 45 };
    const url = "http://localhost/api/v1/tenant-settings";

    const first = await patchTenantSettings(writeRequest(url, token, key, body));
    const firstJson = await first.json();
    expect(first.status).toBe(200);
    expect(firstJson.max_query_range_days).toBe(45);

    const second = await patchTenantSettings(writeRequest(url, token, key, body));
    const secondJson = await second.json();
    expect(second.status).toBe(200);
    expect(secondJson).toEqual(firstJson);

    expect(await prisma.auditEvent.count()).toBe(1);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).maxQueryRangeDays,
    ).toBe(45);
  });

  it("PATCH /tenant-settings: misma clave con cuerpo distinto responde 409", async () => {
    const key = "idem-settings-conflict";
    const url = "http://localhost/api/v1/tenant-settings";

    const first = await patchTenantSettings(
      writeRequest(url, token, key, { max_query_range_days: 40 }),
    );
    expect(first.status).toBe(200);

    const conflict = await patchTenantSettings(
      writeRequest(url, token, key, { max_query_range_days: 50 }),
    );
    const body = await conflict.json();
    expect(conflict.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).maxQueryRangeDays,
    ).toBe(40);
  });

  it("POST /api/sim/v1/practitioners: repeticion no duplica filas ni auditoria", async () => {
    const key = "idem-sim-prac-1";
    const payload = { name: "Dra. Idem", identifier_value: "PRAC-IDEM" };
    const url = "http://localhost/api/sim/v1/practitioners";

    const first = await postSimPractitioner(writeRequest(url, token, key, payload, "POST"));
    const firstJson = await first.json();
    expect(first.status).toBe(200);
    expect(firstJson.identifier_value).toBe("PRAC-IDEM");

    const second = await postSimPractitioner(writeRequest(url, token, key, payload, "POST"));
    const secondJson = await second.json();
    expect(second.status).toBe(200);
    expect(secondJson).toEqual(firstJson);

    expect(await prisma.simPractitioner.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it("dos envios concurrentes con la misma clave: uno escribe y el otro repite la respuesta", async () => {
    const key = "idem-concurrente";
    const payload = { name: "Dra. Carrera", identifier_value: "PRAC-RACE" };
    const url = "http://localhost/api/sim/v1/practitioners";

    const responses = await Promise.all([
      postSimPractitioner(writeRequest(url, token, key, payload, "POST")),
      postSimPractitioner(writeRequest(url, token, key, payload, "POST")),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(await prisma.simPractitioner.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it("POST /api/sim/v1/practitioners: misma clave con cuerpo distinto responde 409", async () => {
    const key = "idem-sim-prac-conflict";
    const url = "http://localhost/api/sim/v1/practitioners";

    const first = await postSimPractitioner(
      writeRequest(url, token, key, { name: "Uno", identifier_value: "A" }, "POST"),
    );
    expect(first.status).toBe(200);

    const conflict = await postSimPractitioner(
      writeRequest(url, token, key, { name: "Dos", identifier_value: "B" }, "POST"),
    );
    const body = await conflict.json();
    expect(conflict.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(await prisma.simPractitioner.count()).toBe(1);
  });

  it("12. PUT FHIR exige clave, repite 201 y detecta cambios de cuerpo o query", async () => {
    const service = await signToken({
      role: "service",
      tenantId,
      subject: `hermes-${tenantId}`,
    });
    const key = "idem-fhir-practitioner";
    const system = "urn:hermes:practitioner";
    const path = `Practitioner?identifier=${encodeURIComponent(`${system}|P-IDEM`)}`;
    const payload = {
      resourceType: "Practitioner",
      identifier: [{ system, value: "P-IDEM" }],
      active: true,
      name: [{ text: "Dra. Idempotente" }],
    };

    const missing = await fhirPut(path, service, payload, { "Idempotency-Key": "" });
    expect(missing.response.status).toBe(400);
    expect(missing.body.issue[0].diagnostics).toContain("Idempotency-Key");

    const first = await fhirPut(path, service, payload, { "Idempotency-Key": key });
    const repeated = await fhirPut(path, service, payload, { "Idempotency-Key": key });
    expect(first.response.status).toBe(201);
    expect(repeated.response.status).toBe(201);
    expect(repeated.body).toEqual(first.body);
    expect(repeated.response.headers.get("Location")).toBe(first.response.headers.get("Location"));

    const otherBody = await fhirPut(
      path,
      service,
      { ...payload, name: [{ text: "Otro nombre" }] },
      { "Idempotency-Key": key },
    );
    expect(otherBody.response.status).toBe(409);
    expect(otherBody.body.issue[0].code).toBe("conflict");

    const otherQuery = await fhirPut(
      `Practitioner?identifier=${encodeURIComponent(`${system}|P-OTRO`)}`,
      service,
      { ...payload, identifier: [{ system, value: "P-OTRO" }] },
      { "Idempotency-Key": key },
    );
    expect(otherQuery.response.status).toBe(409);
    expect(otherQuery.body.issue[0].code).toBe("conflict");
    expect(await prisma.practitioner.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(1);
  });
});

describe("idempotencia: bandeja del simulador", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  async function pendingBook() {
    const start = new Date(Date.now() + 48 * HOUR_MS);
    start.setUTCMinutes(0, 0, 0);
    const world = await seedWorld(prisma, "a", start);
    const request = await createRequest(prisma, clockAt(new Date()), {
      kind: "book",
      tenantId: world.tenantId,
      medicalRecordId: world.medicalRecordId,
      slotId: slotAt(world, 0),
      actor: ACTOR,
    });
    const token = await signToken({
      role: "admin",
      tenantId: world.tenantId,
      subject: "admin-a",
    });
    return { request, token };
  }

  it("aprobar dos veces con la misma clave: misma respuesta y una sola cita nueva", async () => {
    const { request, token } = await pendingBook();
    const ctx = () => ({ params: Promise.resolve({ id: request.id }) });
    const first = await approveInbox(inboxPost(`${request.id}/approve`, token, "k-approve"), ctx());
    const second = await approveInbox(
      inboxPost(`${request.id}/approve`, token, "k-approve"),
      ctx(),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await prisma.appointment.count()).toBe(2);
    expect(await prisma.simAppointment.count()).toBe(2);
  });

  it("la misma clave en otra ruta responde 409", async () => {
    const { request, token } = await pendingBook();
    const ctx = () => ({ params: Promise.resolve({ id: request.id }) });
    await approveInbox(inboxPost(`${request.id}/approve`, token, "k-shared"), ctx());
    const conflict = await rejectInbox(inboxPost(`${request.id}/reject`, token, "k-shared"), ctx());
    expect(conflict.status).toBe(409);
  });

  it("un cursor manipulado en la bandeja es 422, nunca 500", async () => {
    const { token } = await pendingBook();
    const response = await listSimInbox(
      authedRequest("http://localhost/api/sim/v1/inbox?cursor=no-es-un-cursor%24", token),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("validation_failed");
  });
});
