import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as putWidgetClient } from "@/app/api/platform/v1/tenants/[id]/widget-client/route";
import { POST as createTenant, GET as listTenants } from "@/app/api/platform/v1/tenants/route";
import { POST as openWidgetSession } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import {
  authedRequest,
  fakeIdpCalls,
  platformToken,
  registerFakeClient,
  resetFakeIdp,
  signToken,
  TEST_CLIENT_SECRET,
} from "../helpers/idp";
import { insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const TENANTS_URL = "http://localhost/api/platform/v1/tenants";
let token = "";

beforeAll(async () => {
  token = await platformToken();
});

function platformPost(url: string, body: unknown, key?: string, bearer: string | null = token) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (bearer) {
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  if (key) {
    headers.set("Idempotency-Key", key);
  }
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function widgetClientPut(tenantId: string, body: unknown, key?: string) {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  if (key) {
    headers.set("Idempotency-Key", key);
  }
  return putWidgetClient(
    new Request(`${TENANTS_URL}/${tenantId}/widget-client`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tenantId }) },
  );
}

describe("alta-chatbot: autenticacion de plataforma", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("sin token responde 401; token admin de tenant responde 403", async () => {
    const none = await listTenants(new Request(TENANTS_URL));
    expect(none.status).toBe(401);

    const admin = await signToken({ role: "admin", tenantId: "tenant-a" });
    expect((await listTenants(authedRequest(TENANTS_URL, admin))).status).toBe(403);
    const write = await createTenant(platformPost(TENANTS_URL, {}, "k-1", admin));
    expect(write.status).toBe(403);
  });

  it("GET /tenants lista paginado con token platform", async () => {
    await insertChatbotTenant(prisma, "a");
    await insertChatbotTenant(prisma, "b");
    const response = await listTenants(authedRequest(`${TENANTS_URL}?limit=1`, token));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { id: "tenant-a", slug: "a", name: "Tenant a", created_at: expect.any(String) },
    ]);
    expect(body.next_cursor).toEqual(expect.any(String));
  });

  it("/api/platform/v1/tokens ya no existe", () => {
    expect(existsSync(join("src/app/api/platform/v1/tokens/route.ts"))).toBe(false);
  });
});

const NEW_TENANT = {
  slug: "clinica-nueva",
  name: "Clínica Nueva",
  allowed_origins: ["https://Nueva.test"],
};
const WIDGET_CLIENT = { client_id: "widget-x", client_secret: TEST_CLIENT_SECRET };

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

  it("alta con token platform crea tenant, config, KB de ejemplo y una clave vigente", async () => {
    const response = await createTenant(platformPost(TENANTS_URL, NEW_TENANT, "alta-1"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.tenant).toMatchObject({ slug: "clinica-nueva", name: "Clínica Nueva" });
    expect(body.widget_key).toMatch(/^wk_[A-Za-z0-9_-]{43}$/);
    expect(body.widget_client).toBeNull();

    const tenantId = body.tenant.id;
    expect(await prisma.botConfig.findUniqueOrThrow({ where: { tenantId } })).toMatchObject({
      allowedOrigins: ["https://nueva.test"],
    });
    expect(await prisma.knowledgeEntry.count({ where: { tenantId } })).toBe(3);
    expect(
      await prisma.widgetKey.findFirstOrThrow({ where: { tenantId, retiredAt: null } }),
    ).toMatchObject({ key: body.widget_key });
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual(["tenant.created"]);
  });

  it("alta con widget_client guarda la credencial sellada y responde solo client_id", async () => {
    const payload = { ...NEW_TENANT, widget_client: WIDGET_CLIENT };
    const response = await createTenant(platformPost(TENANTS_URL, payload, "alta-wc"));
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(text).widget_client).toEqual({ client_id: "widget-x" });
    expect(text).not.toContain(TEST_CLIENT_SECRET);

    const row = await prisma.machineCredential.findFirstOrThrow();
    expect(row).toMatchObject({ kind: "widget", clientId: "widget-x" });
    expect(row.secretSealed).not.toContain(TEST_CLIENT_SECRET);
    expect(JSON.stringify(await prisma.platformIdempotencyKey.findMany())).not.toContain(
      TEST_CLIENT_SECRET,
    );
  });

  it("auditoria registra el sub del token platform y no el secreto", async () => {
    const payload = { ...NEW_TENANT, widget_client: WIDGET_CLIENT };
    await createTenant(platformPost(TENANTS_URL, payload, "alta-a"));
    const events = await prisma.auditEvent.findMany();
    expect(events.map((e) => e.actorSubject)).toContain("service-account-platform-client");
    expect(events.every((e) => e.actorRole === "platform")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(TEST_CLIENT_SECRET);
  });

  it("widget_client invalido responde 422 sin filas", async () => {
    const payload = { ...NEW_TENANT, widget_client: { client_id: "w" } };
    const response = await createTenant(platformPost(TENANTS_URL, payload, "alta-bad"));
    expect(response.status).toBe(422);
    expect(await counts()).toEqual({ tenants: 0, configs: 0, keys: 0, entries: 0 });
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
});

describe("alta-chatbot: PUT widget-client", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("reemplaza la credencial y es idempotente", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    const first = await widgetClientPut(
      tenantId,
      { client_id: "widget-a", client_secret: "s1" },
      "wc-1",
    );
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toEqual({ client_id: "widget-a", updated_at: expect.any(String) });

    const replay = await widgetClientPut(
      tenantId,
      { client_id: "widget-a", client_secret: "s1" },
      "wc-1",
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    const rotated = await widgetClientPut(
      tenantId,
      { client_id: "widget-b", client_secret: "secreto-nuevo" },
      "wc-2",
    );
    expect(rotated.status).toBe(200);
    const rows = await prisma.machineCredential.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "widget", clientId: "widget-b" });

    const events = await prisma.auditEvent.findMany({
      where: { action: "widget_client.set" },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.resourceId)).toEqual(["widget-a", "widget-b"]);
    expect(JSON.stringify(events)).not.toContain("secreto-nuevo");
    expect(JSON.stringify(await prisma.platformIdempotencyKey.findMany())).not.toContain(
      "secreto-nuevo",
    );
  });

  it("misma clave con otro cuerpo responde 409", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    await widgetClientPut(tenantId, { client_id: "widget-a", client_secret: "s1" }, "wc-3");
    const other = await widgetClientPut(
      tenantId,
      { client_id: "widget-a", client_secret: "s9" },
      "wc-3",
    );
    expect(other.status).toBe(409);
  });

  it("tenant inexistente responde 404", async () => {
    const response = await widgetClientPut("tenant-x", WIDGET_CLIENT, "wc-4");
    expect(response.status).toBe(404);
  });

  it("sin Idempotency-Key responde 422", async () => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    expect((await widgetClientPut(tenantId, WIDGET_CLIENT)).status).toBe(422);
  });

  it.each([
    [{ client_id: "", client_secret: "s" }],
    [{ client_id: "w", client_secret: "" }],
    [{ client_id: "w", client_secret: "x".repeat(201) }],
    [{ client_id: 5, client_secret: "s" }],
  ])("cuerpo invalido %j responde 422", async (body) => {
    const { tenantId } = await insertChatbotTenant(prisma, "a");
    expect((await widgetClientPut(tenantId, body, "wc-5")).status).toBe(422);
  });
});

describe("alta-chatbot: la primera clave abre sesion", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
  });

  it("la clave devuelta por el alta abre una sesion desde un origen permitido", async () => {
    const payload = { ...NEW_TENANT, widget_client: WIDGET_CLIENT };
    const created = await (await createTenant(platformPost(TENANTS_URL, payload, "alta-w"))).json();
    const { widget_key } = created;
    // El cliente widget debe emitir tokens de la propia clinica para que la apertura valide.
    const own = await widgetClientPut(
      created.tenant.id,
      { client_id: `widget-${created.tenant.id}`, client_secret: TEST_CLIENT_SECRET },
      "alta-w-own",
    );
    expect(own.status).toBe(200);
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

  it("tras rotar widget-client la siguiente apertura pide token con el client_id nuevo", async () => {
    const { tenantId, widgetKey } = await insertChatbotTenant(prisma, "a", {
      allowedOrigins: ["https://nueva.test"],
    });
    const openOnce = () =>
      openWidgetSession(
        new Request("http://localhost/api/v1/widget/sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://nueva.test",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ widget_key: widgetKey }),
        }),
      );
    expect((await openOnce()).status).toBe(201);
    const rotatedId = `widget-${tenantId}-v2`;
    const rotated = await widgetClientPut(
      tenantId,
      { client_id: rotatedId, client_secret: TEST_CLIENT_SECRET },
      "wc-rot",
    );
    expect(rotated.status).toBe(200);
    resetFakeIdp();
    registerFakeClient(rotatedId, { roles: ["widget"], tenant: tenantId });
    expect((await openOnce()).status).toBe(201);
    const requested = fakeIdpCalls().flatMap((call) => (call.clientId ? [call.clientId] : []));
    expect(requested).toEqual([rotatedId]);
  });
});
