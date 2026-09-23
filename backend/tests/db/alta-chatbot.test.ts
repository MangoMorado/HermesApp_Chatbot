import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createTenant, GET as listTenants } from "@/app/api/platform/v1/tenants/route";
import { POST as issueToken } from "@/app/api/platform/v1/tokens/route";
import { GET as getBotConfig } from "@/app/api/v1/bot-config/route";
import { POST as openWidgetSession } from "@/app/api/v1/widget/sessions/route";
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

const TENANTS_URL = "http://localhost/api/platform/v1/tenants";
const NEW_TENANT = {
  slug: "clinica-nueva",
  name: "Clínica Nueva",
  allowed_origins: ["https://Nueva.test"],
};

async function counts() {
  return {
    tenants: await prisma.tenant.count(),
    configs: await prisma.botConfig.count(),
    keys: await prisma.widgetKey.count(),
    entries: await prisma.knowledgeEntry.count(),
  };
}

describe("alta-chatbot: POST /tenants", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("crea tenant, config, KB de ejemplo y una clave vigente", async () => {
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-1"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.tenant).toMatchObject({ slug: "clinica-nueva", name: "Clínica Nueva" });
    expect(body.widget_key).toMatch(/^wk_[A-Za-z0-9_-]{43}$/);

    const tenantId = body.tenant.id;
    expect(await prisma.botConfig.findUniqueOrThrow({ where: { tenantId } })).toMatchObject({
      allowedOrigins: ["https://nueva.test"],
    });
    expect(await prisma.knowledgeEntry.count({ where: { tenantId } })).toBe(3);
    expect(
      await prisma.widgetKey.findFirstOrThrow({ where: { tenantId, retiredAt: null } }),
    ).toMatchObject({
      key: body.widget_key,
    });
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual(["tenant.created"]);
  });

  it("idempotencia: repetir con la misma clave devuelve lo mismo sin duplicar", async () => {
    const first = await (
      await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-2"))
    ).json();
    const again = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-2"));
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(first);
    expect(await counts()).toEqual({ tenants: 1, configs: 1, keys: 1, entries: 3 });
  });

  it("slug repetido con otra clave responde 409 sin filas nuevas", async () => {
    await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-3"));
    const before = await counts();
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-4"));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details.field).toBe("slug");
    expect(await counts()).toEqual(before);
  });

  it("origen invalido responde 422, no deja filas y no consume la clave", async () => {
    const invalid = { ...NEW_TENANT, allowed_origins: ["http://nueva.test"] };
    const response = await createTenant(platformPost(TENANTS_URL, invalid, "alta-5"));
    expect(response.status).toBe(422);
    expect(await counts()).toEqual({ tenants: 0, configs: 0, keys: 0, entries: 0 });
    expect(await prisma.platformIdempotencyKey.count()).toBe(0);

    const retried = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-5"));
    expect(retried.status).toBe(201);
  });

  it("sin Idempotency-Key responde 422", async () => {
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT));
    expect(response.status).toBe(422);
  });

  it("un token emitido para el tenant nuevo lee su configuracion", async () => {
    const { tenant } = await (
      await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-6"))
    ).json();
    const { token } = await (
      await issueToken(
        platformPost(TOKENS_URL, { tenant_id: tenant.id, role: "operator", subject: "op" }),
      )
    ).json();
    const config = await (
      await getBotConfig(authedRequest("http://localhost/api/v1/bot-config", token))
    ).json();
    expect(config.allowed_origins).toEqual(["https://nueva.test"]);
  });
});

describe("alta-chatbot: la primera clave abre sesion", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("la clave devuelta por el alta abre una sesion desde un origen permitido", async () => {
    const { widget_key } = await (await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-w"))).json();
    const response = await openWidgetSession(
      new Request("http://localhost/api/v1/widget/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://nueva.test",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ widget_key }),
      }),
    );
    expect(response.status).toBe(201);
  });
});
