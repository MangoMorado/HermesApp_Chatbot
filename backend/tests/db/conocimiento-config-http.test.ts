import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getBotConfig, PATCH as patchBotConfig } from "@/app/api/v1/bot-config/route";
import { POST as rotateKey } from "@/app/api/v1/bot-config/widget-keys/rotate/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/token";
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

    const widget = await signToken({ role: "widget", tenantId: seed.tenantId, sessionId: "s-1" });
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
