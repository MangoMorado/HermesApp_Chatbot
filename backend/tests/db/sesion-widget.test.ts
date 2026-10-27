import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getBotConfig } from "@/app/api/v1/bot-config/route";
import { GET as listEntries } from "@/app/api/v1/knowledge-entries/route";
import { POST as refreshSession } from "@/app/api/v1/widget/sessions/refresh/route";
import { POST as openSession } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import { createJoseTokenVerifier } from "@/modules/auth/infrastructure/jose-token-verifier";
import { authedRequest, signToken } from "../helpers/idp";
import { TEST_JWT } from "../helpers/token";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const verifier = createJoseTokenVerifier(TEST_JWT);
const ORIGIN = "https://clinica-a.test";
const SESSIONS_URL = "http://localhost/api/v1/widget/sessions";
const REFRESH_URL = "http://localhost/api/v1/widget/sessions/refresh";

function open(widgetKey: unknown, headers: Record<string, string> = {}) {
  return openSession(
    new Request(SESSIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "Idempotency-Key": randomUUID(),
        ...headers,
      },
      body: JSON.stringify({ widget_key: widgetKey }),
    }),
  );
}

function refresh(token: string, key = randomUUID()) {
  return refreshSession(
    authedRequest(REFRESH_URL, token, { method: "POST", headers: { "Idempotency-Key": key } }),
  );
}

describe("sesion-widget: apertura", () => {
  let seed: ChatbotTenantSeed;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    resetContainer();
    await prisma.$disconnect();
  });

  it("clave y origen validos abren una sesion con token de widget", async () => {
    const before = Date.now();
    const response = await open(seed.widgetKey);
    const body = await response.json();

    expect(response.status).toBe(201);
    const claims = await verifier.verify(body.token);
    expect(claims).toEqual({
      subject: `widget:${body.session_id}`,
      tenantId: seed.tenantId,
      role: "widget",
      sessionId: body.session_id,
    });
    const expiresAt = new Date(body.expires_at).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(
      await prisma.widgetSession.findUniqueOrThrow({ where: { id: body.session_id } }),
    ).toMatchObject({
      tenantId: seed.tenantId,
      origin: ORIGIN,
    });
  });

  it("clave en gracia abre; con la gracia vencida, retirada o desconocida responde 401", async () => {
    const retired = `wk_${"g".repeat(43)}`;
    await prisma.widgetKey.create({
      data: {
        id: "k-grace",
        tenantId: seed.tenantId,
        key: retired,
        createdAt: new Date(),
        retiredAt: new Date(),
        graceUntil: new Date(Date.now() + 60_000),
      },
    });
    expect((await open(retired)).status).toBe(201);

    await prisma.widgetKey.update({
      where: { id: "k-grace" },
      data: { graceUntil: new Date(Date.now() - 1) },
    });
    expect((await open(retired)).status).toBe(401);
    expect((await open(`wk_${"u".repeat(43)}`)).status).toBe(401);
    expect((await open("no-es-una-clave")).status).toBe(401);
  });

  it("origen ausente, ajeno o con lista vacia responde 403", async () => {
    expect((await open(seed.widgetKey, { Origin: "https://otra.test" })).status).toBe(403);
    const other = await insertChatbotTenant(prisma, "b");
    expect((await open(other.widgetKey)).status).toBe(403);

    const noOrigin = await openSession(
      new Request(SESSIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ widget_key: seed.widgetKey }),
      }),
    );
    expect(noOrigin.status).toBe(403);
  });

  it("supera el limite por IP y responde 429 con Retry-After", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 2 } },
    });
    expect((await open(seed.widgetKey)).status).toBe(201);
    expect((await open(seed.widgetKey)).status).toBe(201);
    const limited = await open(seed.widgetKey);
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("sin TRUST_PROXY un X-Forwarded-For falsificado no abre cubos nuevos", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 2 } },
    });
    await open(seed.widgetKey, { "X-Forwarded-For": "1.1.1.1" });
    await open(seed.widgetKey, { "X-Forwarded-For": "2.2.2.2" });
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "3.3.3.3" })).status).toBe(429);
  });

  it("con TRUST_PROXY cada IP tiene su propio cubo", async () => {
    process.env.TRUST_PROXY = "true";
    resetContainer();
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 1 } },
    });
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "1.1.1.1" })).status).toBe(201);
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "1.1.1.1" })).status).toBe(429);
    expect((await open(seed.widgetKey, { "X-Forwarded-For": "2.2.2.2" })).status).toBe(201);
    delete process.env.TRUST_PROXY;
    resetContainer();
  });

  it("idempotencia: repetir con la misma clave devuelve la misma sesion y no guarda el JWT", async () => {
    const key = randomUUID();
    const first = await (await open(seed.widgetKey, { "Idempotency-Key": key })).json();
    const again = await open(seed.widgetKey, { "Idempotency-Key": key });
    const againBody = await again.json();

    expect(again.status).toBe(201);
    expect(againBody.session_id).toBe(first.session_id);
    expect((await verifier.verify(againBody.token)).sessionId).toBe(first.session_id);
    expect(await prisma.widgetSession.count()).toBe(1);
    const stored = await prisma.idempotencyKey.findFirstOrThrow();
    expect(stored.responseBody).toEqual({ session_id: first.session_id });
  });

  it("una Idempotency-Key de menos de 32 caracteres responde 422", async () => {
    const response = await open(seed.widgetKey, { "Idempotency-Key": "corta" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toMatchObject({ min_length: 32 });
  });
});

describe("sesion-widget: renovacion y alcance", () => {
  let token: string;
  let sessionId: string;
  let seed: ChatbotTenantSeed;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
    const body = await (await open(seed.widgetKey)).json();
    token = body.token;
    sessionId = body.session_id;
  });

  it("renueva la propia sesion y alarga expires_at", async () => {
    const before = await prisma.widgetSession.findUniqueOrThrow({ where: { id: sessionId } });
    const refreshKey = randomUUID();
    const response = await refresh(token, refreshKey);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session_id).toBe(sessionId);
    const after = await prisma.widgetSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.expiresAt.getTime()).toBeGreaterThanOrEqual(before.expiresAt.getTime());
    expect((await verifier.verify(body.token)).sessionId).toBe(sessionId);

    const stored = await prisma.idempotencyKey.findFirstOrThrow({
      where: { path: "/api/v1/widget/sessions/refresh" },
    });
    expect(stored.responseBody).toEqual({ session_id: sessionId });
  });

  it("una sesion vencida no se renueva", async () => {
    await prisma.widgetSession.update({
      where: { id: sessionId },
      data: { createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh(token)).status).toBe(401);
  });

  it("la Idempotency-Key de otra sesion no entrega su token", async () => {
    const key = randomUUID();
    expect((await refresh(token, key)).status).toBe(200);
    const other = await (await open(seed.widgetKey)).json();
    const response = await refresh(other.token, key);
    expect(response.status).toBe(409);
  });

  it("operator no renueva sesiones y el widget no alcanza config ni KB", async () => {
    const operator = await signToken({ role: "operator", tenantId: seed.tenantId });
    expect((await refresh(operator)).status).toBe(403);
    expect(
      (await getBotConfig(authedRequest("http://localhost/api/v1/bot-config", token))).status,
    ).toBe(403);
    expect(
      (await listEntries(authedRequest("http://localhost/api/v1/knowledge-entries", token))).status,
    ).toBe(403);
  });
});
