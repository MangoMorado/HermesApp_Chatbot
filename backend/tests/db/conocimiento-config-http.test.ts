import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as removeOrigin } from "@/app/api/v1/bot-config/allowed-origins/[origin]/route";
import { POST as addOrigin } from "@/app/api/v1/bot-config/allowed-origins/route";
import { GET as getBotConfig, PATCH as patchBotConfig } from "@/app/api/v1/bot-config/route";
import { POST as rotateKey } from "@/app/api/v1/bot-config/widget-keys/rotate/route";
import {
  DELETE as deleteEntry,
  GET as getEntry,
  PATCH as patchEntry,
} from "@/app/api/v1/knowledge-entries/[id]/route";
import { POST as createEntry, GET as listEntries } from "@/app/api/v1/knowledge-entries/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/idp";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const CONFIG_URL = "http://localhost/api/v1/bot-config";
const ROTATE_URL = "http://localhost/api/v1/bot-config/widget-keys/rotate";
const HOUR = 3_600_000;
let keySeq = 0;

function write(
  url: string,
  token: string,
  body?: unknown,
  key = `k-${++keySeq}`,
  method = "PATCH",
) {
  return authedRequest(url, token, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("conocimiento-config: /bot-config", () => {
  let seed: ChatbotTenantSeed;
  let admin: string;
  let operator: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: ["https://clinica-a.test"] });
    admin = await signToken({ role: "admin", tenantId: seed.tenantId, subject: "admin-a" });
    operator = await signToken({ role: "operator", tenantId: seed.tenantId });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("GET devuelve predeterminados, origenes y la clave vigente", async () => {
    const response = await getBotConfig(authedRequest(CONFIG_URL, operator));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.texts.welcome.overridden).toBe(false);
    expect(body.params.widget_session_ttl_minutes).toBe(30);
    expect(body.allowed_origins).toEqual(["https://clinica-a.test"]);
    expect(body.widget_keys.current.key).toBe(seed.widgetKey);
    expect(body.widget_keys.grace).toBeNull();
  });

  it("PATCH sobrescribe texto y param y audita sin valores", async () => {
    const response = await patchBotConfig(
      write(CONFIG_URL, admin, {
        texts: { welcome: "Bienvenidos a {clinic_name}" },
        params: { widget_session_ttl_minutes: 60 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.texts.welcome).toEqual({ value: "Bienvenidos a {clinic_name}", overridden: true });
    expect(body.params.widget_session_ttl_minutes).toBe(60);

    const events = await prisma.auditEvent.findMany();
    expect(events.map((event) => event.action)).toEqual(["bot_config.updated"]);
    expect(JSON.stringify(events)).not.toContain("Bienvenidos");
  });

  it("PATCH con null devuelve el texto al predeterminado", async () => {
    await patchBotConfig(write(CONFIG_URL, admin, { texts: { welcome: "Hola" } }));
    const response = await patchBotConfig(write(CONFIG_URL, admin, { texts: { welcome: null } }));
    expect((await response.json()).texts.welcome.overridden).toBe(false);
  });

  it("PATCH normaliza los origenes a minusculas", async () => {
    const response = await patchBotConfig(
      write(CONFIG_URL, admin, { allowed_origins: ["https://Clinica-A.test"] }),
    );
    expect((await response.json()).allowed_origins).toEqual(["https://clinica-a.test"]);
  });

  it("idempotencia: PATCH repetido con la misma clave y cuerpo no duplica auditoria", async () => {
    const payload = { texts: { welcome: "Hola de nuevo" } };
    const first = await (
      await patchBotConfig(write(CONFIG_URL, admin, payload, "cfg-same"))
    ).json();
    const again = await (
      await patchBotConfig(write(CONFIG_URL, admin, payload, "cfg-same"))
    ).json();
    expect(again).toEqual(first);
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual([
      "bot_config.updated",
    ]);
  });

  it.each([
    [{ texts: { despedida: "Chao" } }, "texts.despedida"],
    [{ params: { kb_max_results: 0 } }, "params.kb_max_results"],
    [{ texts: { welcome: "Hola {paciente}" } }, "texts.welcome"],
    [{ colores: {} }, "colores"],
    [{ allowed_origins: ["http://clinica.test"] }, "allowed_origins.0"],
  ])("PATCH %j responde 422 con el campo", async (payload, field) => {
    const response = await patchBotConfig(write(CONFIG_URL, admin, payload));
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error.details.field).toBe(field);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("operator no escribe y widget no lee", async () => {
    const denied = await patchBotConfig(write(CONFIG_URL, operator, { texts: { welcome: "x" } }));
    expect(denied.status).toBe(403);

    const widget = await signToken({ role: "widget", tenantId: seed.tenantId });
    expect((await getBotConfig(authedRequest(CONFIG_URL, widget))).status).toBe(403);
  });

  it("rotar deja la nueva vigente y la anterior en gracia 24 h", async () => {
    const before = Date.now();
    const response = await rotateKey(write(ROTATE_URL, admin, undefined, "rot-1", "POST"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.widget_keys.current.key).toMatch(/^wk_[A-Za-z0-9_-]{43}$/);
    expect(body.widget_keys.current.key).not.toBe(seed.widgetKey);
    expect(body.widget_keys.grace.key).toBe(seed.widgetKey);
    const graceUntil = new Date(body.widget_keys.grace.grace_until).getTime();
    expect(graceUntil).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(graceUntil).toBeLessThanOrEqual(Date.now() + 24 * HOUR);
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual([
      "widget_key.rotated",
    ]);
  });

  it("rotar dos veces mata la que estaba en gracia", async () => {
    await rotateKey(write(ROTATE_URL, admin, undefined, "rot-1", "POST"));
    const second = await (
      await rotateKey(write(ROTATE_URL, admin, undefined, "rot-2", "POST"))
    ).json();

    expect(second.widget_keys.grace.key).not.toBe(seed.widgetKey);
    const accepted = await prisma.widgetKey.count({
      where: { OR: [{ retiredAt: null }, { graceUntil: { gt: new Date() } }] },
    });
    expect(accepted).toBe(2);
  });

  it("idempotencia: rotar con la misma Idempotency-Key no rota dos veces", async () => {
    const first = await (
      await rotateKey(write(ROTATE_URL, admin, undefined, "rot-x", "POST"))
    ).json();
    const again = await (
      await rotateKey(write(ROTATE_URL, admin, undefined, "rot-x", "POST"))
    ).json();
    expect(again).toEqual(first);
    expect(await prisma.widgetKey.count()).toBe(2);
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it("tenant con bot_config y sin claves: rotar crea la primera clave vigente", async () => {
    const tenantId = "tenant-sin-clave";
    await prisma.tenant.create({ data: { id: tenantId, slug: "sin-clave", name: "Sin Clave" } });
    await prisma.botConfig.create({ data: { tenantId, allowedOrigins: [] } });
    const token = await signToken({ role: "admin", tenantId });

    const response = await rotateKey(write(ROTATE_URL, token, undefined, "rot-first", "POST"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.widget_keys.current.key).toMatch(/^wk_[A-Za-z0-9_-]{43}$/);
    expect(body.widget_keys.grace).toBeNull();
    expect(await prisma.widgetKey.count({ where: { tenantId } })).toBe(1);
  });

  it("dos rotaciones concurrentes nunca dejan dos claves vigentes", async () => {
    const responses = await Promise.all([
      rotateKey(write(ROTATE_URL, admin, undefined, "rot-c1", "POST")),
      rotateKey(write(ROTATE_URL, admin, undefined, "rot-c2", "POST")),
    ]);
    for (const response of responses) {
      expect([200, 409]).toContain(response.status);
    }
    expect(await prisma.widgetKey.count({ where: { retiredAt: null } })).toBe(1);
  });
});

const KB_URL = "http://localhost/api/v1/knowledge-entries";
const ENTRY = {
  category: "Citas",
  question: "¿Cómo agendo?",
  answer: "Desde este chat.",
  keywords: ["Agendar", "cita médica"],
};

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("conocimiento-config: /knowledge-entries", () => {
  let seed: ChatbotTenantSeed;
  let admin: string;
  let operator: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a");
    admin = await signToken({ role: "admin", tenantId: seed.tenantId });
    operator = await signToken({ role: "operator", tenantId: seed.tenantId });
  });

  async function create(payload: unknown = ENTRY, key = `kb-${++keySeq}`) {
    const response = await createEntry(write(KB_URL, admin, payload, key, "POST"));
    return { response, body: await response.json() };
  }

  it("POST crea con keywords normalizadas, responde 201 y audita", async () => {
    const { response, body } = await create();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      category: "Citas",
      keywords: ["agendar", "cita", "medica"],
      active: true,
    });
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual([
      "knowledge_entry.created",
    ]);
  });

  it("idempotencia: POST repetido con la misma clave crea una sola entrada", async () => {
    const first = await create(ENTRY, "kb-same");
    const again = await create(ENTRY, "kb-same");
    expect(again.body).toEqual(first.body);
    expect(await prisma.knowledgeEntry.count()).toBe(1);
  });

  it("GET lista ordenado, filtra y pagina", async () => {
    await create({ ...ENTRY, category: "Ubicacion" });
    await create({ ...ENTRY, position: 2 });
    await create({ ...ENTRY, position: 1, active: false });

    const page1 = await (await listEntries(authedRequest(`${KB_URL}?limit=2`, operator))).json();
    expect(
      page1.data.map((e: { category: string; position: number }) => [e.category, e.position]),
    ).toEqual([
      ["Citas", 1],
      ["Citas", 2],
    ]);
    const page2 = await (
      await listEntries(authedRequest(`${KB_URL}?limit=2&cursor=${page1.next_cursor}`, operator))
    ).json();
    expect(page2.data.map((e: { category: string }) => e.category)).toEqual(["Ubicacion"]);

    const activas = await (
      await listEntries(authedRequest(`${KB_URL}?active=true&category=Citas`, operator))
    ).json();
    expect(activas.data).toHaveLength(1);
  });

  it("GET con cursor invalido responde 422", async () => {
    const response = await listEntries(authedRequest(`${KB_URL}?cursor=@@`, operator));
    expect(response.status).toBe(422);
  });

  it("GET con active invalido responde 422 con el campo", async () => {
    const response = await listEntries(authedRequest(`${KB_URL}?active=maybe`, operator));
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error.details.field).toBe("active");
  });

  it("PATCH cambia solo lo que trae; invalido responde 422", async () => {
    const { body: created } = await create();
    const patched = await patchEntry(
      write(`${KB_URL}/${created.id}`, admin, { active: false, detail: "Más info" }),
      withId(created.id),
    );
    expect(await patched.json()).toMatchObject({
      active: false,
      detail: "Más info",
      answer: ENTRY.answer,
    });

    const invalid = await patchEntry(
      write(`${KB_URL}/${created.id}`, admin, { question: "" }),
      withId(created.id),
    );
    expect(invalid.status).toBe(422);
  });

  it("idempotencia: PATCH repetido con la misma clave y cuerpo no duplica auditoria", async () => {
    const { body: created } = await create();
    const payload = { active: false };
    const first = await (
      await patchEntry(
        write(`${KB_URL}/${created.id}`, admin, payload, "kb-patch-same"),
        withId(created.id),
      )
    ).json();
    const again = await (
      await patchEntry(
        write(`${KB_URL}/${created.id}`, admin, payload, "kb-patch-same"),
        withId(created.id),
      )
    ).json();
    expect(again).toEqual(first);
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual([
      "knowledge_entry.created",
      "knowledge_entry.updated",
    ]);
  });

  it("idempotencia: DELETE repetido con la misma clave no duplica auditoria ni efecto", async () => {
    const { body: created } = await create();
    const first = await deleteEntry(
      write(`${KB_URL}/${created.id}`, admin, undefined, "kb-del-same", "DELETE"),
      withId(created.id),
    );
    const again = await deleteEntry(
      write(`${KB_URL}/${created.id}`, admin, undefined, "kb-del-same", "DELETE"),
      withId(created.id),
    );
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await prisma.knowledgeEntry.count()).toBe(0);
    expect((await prisma.auditEvent.findMany()).map((e) => e.action)).toEqual([
      "knowledge_entry.created",
      "knowledge_entry.deleted",
    ]);
  });

  it("DELETE borra; un segundo DELETE con otra clave responde 404", async () => {
    const { body: created } = await create();
    const first = await deleteEntry(
      write(`${KB_URL}/${created.id}`, admin, undefined, "del-1", "DELETE"),
      withId(created.id),
    );
    expect(first.status).toBe(200);
    const second = await deleteEntry(
      write(`${KB_URL}/${created.id}`, admin, undefined, "del-2", "DELETE"),
      withId(created.id),
    );
    expect(second.status).toBe(404);
    expect(
      (await getEntry(authedRequest(`${KB_URL}/${created.id}`, operator), withId(created.id)))
        .status,
    ).toBe(404);
  });

  it("con 500 entradas el alta responde 422", async () => {
    await prisma.knowledgeEntry.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        id: `bulk-${i}`,
        tenantId: seed.tenantId,
        category: "Masivo",
        question: `P${i}`,
        answer: "R",
      })),
    });
    const { response, body } = await create();
    expect(response.status).toBe(422);
    expect(body.error.details).toMatchObject({ max: 500 });
  });

  it("operator lee pero no crea; widget no alcanza la KB", async () => {
    expect((await createEntry(write(KB_URL, operator, ENTRY, "op-1", "POST"))).status).toBe(403);
    expect((await listEntries(authedRequest(KB_URL, operator))).status).toBe(200);
    const widget = await signToken({ role: "widget", tenantId: seed.tenantId });
    expect((await listEntries(authedRequest(KB_URL, widget))).status).toBe(403);
  });
});

describe("conocimiento-config: origenes por API", () => {
  it("admin agrega y quita un origen; operator no", async () => {
    await truncateAll(prisma);
    resetContainer();
    const { tenantId } = await insertChatbotTenant(prisma, "o", { allowedOrigins: [] });
    const admin = await signToken({ role: "admin", tenantId });
    const url = "http://localhost/api/v1/bot-config/allowed-origins";
    const add = (token: string, origin: string) =>
      addOrigin(write(url, token, { origin }, undefined, "POST"));
    const added = await add(admin, "https://nueva.test");
    expect(added.status).toBe(200);
    expect((await added.json()).allowed_origins).toContain("https://nueva.test");
    expect((await add(admin, "https://nueva.test")).status).toBe(200);

    const operator = await signToken({ role: "operator", tenantId });
    expect((await add(operator, "https://otra.test")).status).toBe(403);

    const encoded = encodeURIComponent("https://nueva.test");
    const removed = await removeOrigin(
      write(`${url}/${encoded}`, admin, undefined, undefined, "DELETE"),
      { params: Promise.resolve({ origin: encoded }) },
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).allowed_origins).not.toContain("https://nueva.test");
    const events = await prisma.auditEvent.findMany({
      where: { tenantId },
      select: { action: true },
    });
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["bot_config.origin_added", "bot_config.origin_removed"]),
    );
  });
});
