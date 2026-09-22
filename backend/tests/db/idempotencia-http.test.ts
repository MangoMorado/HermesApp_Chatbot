import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postSimPractitioner } from "@/app/api/sim/v1/practitioners/route";
import { PATCH as patchTenantSettings } from "@/app/api/v1/tenant-settings/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/token";
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
});
