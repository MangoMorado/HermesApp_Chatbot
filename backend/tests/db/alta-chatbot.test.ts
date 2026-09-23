import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listTenants } from "@/app/api/platform/v1/tenants/route";
import { POST as issueToken } from "@/app/api/platform/v1/tokens/route";
import { GET as getBotConfig } from "@/app/api/v1/bot-config/route";
import { resetContainer } from "@/composition-root";
import { authedRequest } from "../helpers/token";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const PLATFORM_SECRET = "secreto-de-plataforma-de-pruebas-con-32-o-mas";
const HOUR = 3_600_000;

function platformPost(url: string, body: unknown, key?: string): Request {
  const headers = new Headers({
    Authorization: `Bearer ${PLATFORM_SECRET}`,
    "Content-Type": "application/json",
  });
  if (key) {
    headers.set("Idempotency-Key", key);
  }
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

const TOKENS_URL = "http://localhost/api/platform/v1/tokens";

describe("alta-chatbot: tokens de plataforma", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("un token admin emitido abre /bot-config de su tenant", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    const before = Date.now();
    const response = await issueToken(
      platformPost(TOKENS_URL, { tenant_id: tenantId, role: "admin", subject: "ana@clinica" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const expiresAt = new Date(body.expires_at).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 8 * HOUR - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 8 * HOUR);

    const config = await getBotConfig(
      authedRequest("http://localhost/api/v1/bot-config", body.token),
    );
    expect(config.status).toBe(200);
  });

  it("audita el hecho sin guardar el token", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    const body = await (
      await issueToken(
        platformPost(TOKENS_URL, { tenant_id: tenantId, role: "service", subject: "hermes" }),
      )
    ).json();

    const events = await prisma.auditEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId,
      actorSubject: "platform",
      actorRole: "platform",
      action: "token.issued",
      resourceType: "token.service",
      resourceId: "hermes",
    });
    expect(JSON.stringify(events)).not.toContain(body.token);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    expect(await prisma.platformIdempotencyKey.count()).toBe(0);
  });

  it("tenant inexistente responde 404", async () => {
    const response = await issueToken(
      platformPost(TOKENS_URL, { tenant_id: "tenant-x", role: "admin", subject: "ana" }),
    );
    expect(response.status).toBe(404);
  });

  it("GET /tenants lista paginado", async () => {
    await insertChatbotTenant(prisma, "a");
    await insertChatbotTenant(prisma, "b");
    const response = await listTenants(
      new Request("http://localhost/api/platform/v1/tenants?limit=1", {
        headers: { Authorization: `Bearer ${PLATFORM_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { id: "tenant-a", slug: "a", name: "Tenant a", created_at: expect.any(String) },
    ]);
    expect(body.next_cursor).toEqual(expect.any(String));
  });
});
