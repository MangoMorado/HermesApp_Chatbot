import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decodeJwt } from "jose";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getBotConfig } from "@/app/api/v1/bot-config/route";
import { GET as listEntries } from "@/app/api/v1/knowledge-entries/route";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { GET as getConversation } from "@/app/api/v1/widget/conversation/route";
import { POST as refreshSession } from "@/app/api/v1/widget/sessions/refresh/route";
import { POST as openSession } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, authorized, resetFakeIdp, setFakeIdpDown } from "../helpers/idp";
import { getChat, sendChat, type WidgetChat } from "./chat-support";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ORIGIN = "https://clinica-a.test";
const SESSIONS_URL = "http://localhost/api/v1/widget/sessions";
const REFRESH_URL = "http://localhost/api/v1/widget/sessions/refresh";

type Opened = {
  access_token: string;
  expires_at: string;
  conversation_secret: string;
  session_expires_at: string;
};

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

async function opened(widgetKey: string): Promise<Opened> {
  const response = await open(widgetKey);
  expect(response.status).toBe(201);
  return response.json();
}

function refresh(
  seed: ChatbotTenantSeed,
  secret: string | null,
  headers: Record<string, string> = {},
  widgetKey: string = seed.widgetKey,
) {
  const all: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    "Idempotency-Key": randomUUID(),
    ...headers,
  };
  if (secret !== null) {
    all["X-Conversation-Secret"] = secret;
  }
  return refreshSession(
    new Request(REFRESH_URL, {
      method: "POST",
      headers: all,
      body: JSON.stringify({ widget_key: widgetKey }),
    }),
  );
}

function chatOf(body: Opened): WidgetChat {
  return { token: body.access_token, secret: body.conversation_secret };
}

function sessionOf(secret: string) {
  return prisma.widgetSession.findFirstOrThrow({ where: { secretHash: sha256hex(secret) } });
}

let seed: ChatbotTenantSeed;

beforeEach(async () => {
  await truncateAll(prisma);
  resetContainer();
  resetFakeIdp();
  seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
});

afterEach(() => {
  resetFakeIdp();
});

afterAll(async () => {
  delete process.env.TRUST_PROXY;
  resetContainer();
  await prisma.$disconnect();
});

describe("sesion-widget: apertura", () => {
  it("apertura devuelve token del proveedor y conversation_secret; en base solo el hash", async () => {
    const before = Date.now();
    const body = await opened(seed.widgetKey);

    expect(decodeJwt(body.access_token)).toMatchObject({
      roles: ["widget"],
      tenant_id: seed.tenantId,
    });
    expect(Buffer.from(body.conversation_secret, "base64url").byteLength).toBe(32);
    expect(new Date(body.session_expires_at).getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60_000,
    );
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(before);
    const row = await prisma.widgetSession.findFirstOrThrow();
    expect(row).toMatchObject({ tenantId: seed.tenantId, origin: ORIGIN });
    expect(row.secretHash).toBe(sha256hex(body.conversation_secret));
    expect(JSON.stringify(row)).not.toContain(body.conversation_secret);
  });

  it("clinica sin credenciales responde 409 widget_not_configured y sin sesion creada", async () => {
    const bare = await insertChatbotTenant(prisma, "b", {
      allowedOrigins: [ORIGIN],
      widgetClient: false,
    });
    const response = await open(bare.widgetKey);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("widget_not_configured");
    expect(await prisma.widgetSession.count()).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("proveedor caido responde 503 identity_unavailable y sin sesion creada", async () => {
    setFakeIdpDown(true);
    const response = await open(seed.widgetKey);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("identity_unavailable");
    expect(await prisma.widgetSession.count()).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("replay de la apertura devuelve el mismo conversation_secret y un token valido", async () => {
    const key = randomUUID();
    const first = await (await open(seed.widgetKey, { "Idempotency-Key": key })).json();
    const again = await open(seed.widgetKey, { "Idempotency-Key": key });
    const againBody = await again.json();

    expect(again.status).toBe(201);
    expect(againBody.conversation_secret).toBe(first.conversation_secret);
    expect((await getIdentity(authorized(againBody.access_token))).status).toBe(200);
    expect(await prisma.widgetSession.count()).toBe(1);
  });

  it("la respuesta idempotente guardada no contiene el secreto en claro", async () => {
    const body = await opened(seed.widgetKey);
    const stored = await prisma.idempotencyKey.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.responseBody).toEqual({
      session_id: (await sessionOf(body.conversation_secret)).id,
      sealed_secret: expect.any(String),
    });
    const text = JSON.stringify(stored);
    expect(text).not.toContain(body.conversation_secret);
    expect(text).not.toContain(body.access_token);
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

  it("una Idempotency-Key de menos de 32 caracteres responde 422", async () => {
    const response = await open(seed.widgetKey, { "Idempotency-Key": "corta" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toMatchObject({ min_length: 32 });
  });
});

describe("sesion-widget: conversacion", () => {
  it("conversacion sin X-Conversation-Secret responde 404", async () => {
    const body = await opened(seed.widgetKey);
    const bare = authedRequest("http://localhost/api/v1/widget/conversation", body.access_token);
    expect((await getConversation(bare)).status).toBe(404);
    expect((await sendChat({ ...chatOf(body), secret: "" }, { text: "hola" })).status).toBe(404);
    expect((await getChat(chatOf(body))).status).toBe(200);
  });

  it("secreto de la clinica A con token de la clinica B responde 404", async () => {
    const b = await insertChatbotTenant(prisma, "b", { allowedOrigins: [ORIGIN] });
    const chatA = chatOf(await opened(seed.widgetKey));
    const chatB = chatOf(await opened(b.widgetKey));
    const crossed = { token: chatB.token, secret: chatA.secret };
    expect((await getChat(crossed)).status).toBe(404);
    expect((await sendChat(crossed, { text: "hola" })).status).toBe(404);
    expect(await prisma.conversation.count()).toBe(0);
  });

  it("token de widget sin secreto no alcanza la conversacion de otro paciente de la misma clinica", async () => {
    const mine = chatOf(await opened(seed.widgetKey));
    const theirs = chatOf(await opened(seed.widgetKey));
    expect((await getChat(theirs)).status).toBe(200);
    const guessed = { token: mine.token, secret: randomUUID() };
    expect((await getChat(guessed)).status).toBe(404);
    expect((await sendChat(guessed, { text: "hola" })).status).toBe(404);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it("claves de idempotencia del chat usan widget:<sessionId>", async () => {
    const body = await opened(seed.widgetKey);
    const chat = chatOf(body);
    const history = await (await getChat(chat)).json();
    const optionId = history.options[0]?.id ?? "?";
    expect((await sendChat(chat, { option_id: optionId })).status).toBe(200);
    const session = await sessionOf(body.conversation_secret);
    const stored = await prisma.idempotencyKey.findFirstOrThrow({
      where: { path: "/api/v1/widget/conversation/messages" },
    });
    expect(stored.actorSubject).toBe(`widget:${session.id}`);
  });

  it("el token del widget no alcanza config ni KB", async () => {
    const { access_token: token } = await opened(seed.widgetKey);
    expect(
      (await getBotConfig(authedRequest("http://localhost/api/v1/bot-config", token))).status,
    ).toBe(403);
    expect(
      (await listEntries(authedRequest("http://localhost/api/v1/knowledge-entries", token))).status,
    ).toBe(403);
  });
});

describe("sesion-widget: renovacion", () => {
  it("refresh sin bearer con secreto + clave + origen extiende la sesion y da token nuevo", async () => {
    const body = await opened(seed.widgetKey);
    const session = await sessionOf(body.conversation_secret);
    const shortened = new Date(session.createdAt.getTime() + 60_000);
    await prisma.widgetSession.update({
      where: { id: session.id },
      data: { expiresAt: shortened },
    });
    const response = await refresh(seed, body.conversation_secret);
    const refreshed = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(refreshed).sort()).toEqual([
      "access_token",
      "expires_at",
      "session_expires_at",
    ]);
    expect((await getIdentity(authorized(refreshed.access_token))).status).toBe(200);
    const after = await prisma.widgetSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.expiresAt.getTime()).toBeGreaterThan(shortened.getTime());
    expect(new Date(refreshed.session_expires_at).getTime()).toBe(after.expiresAt.getTime());
    const stored = await prisma.idempotencyKey.findFirstOrThrow({
      where: { path: "/api/v1/widget/sessions/refresh" },
    });
    expect(stored.actorSubject).toBe(`widget:${session.id}`);
    expect(stored.responseBody).toEqual({ session_id: session.id });
  });

  it("refresh con Origin distinto responde 403", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { allowedOrigins: [ORIGIN, "https://clinica-a2.test"] },
    });
    const body = await opened(seed.widgetKey);
    const response = await refresh(seed, body.conversation_secret, {
      Origin: "https://clinica-a2.test",
    });
    expect(response.status).toBe(403);
  });

  it("refresh con secreto vencido, desconocido o ausente responde 404", async () => {
    const body = await opened(seed.widgetKey);
    expect((await refresh(seed, randomUUID())).status).toBe(404);
    expect((await refresh(seed, null)).status).toBe(404);
    const session = await sessionOf(body.conversation_secret);
    await prisma.widgetSession.update({
      where: { id: session.id },
      data: { createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh(seed, body.conversation_secret)).status).toBe(404);
    expect((await getChat(chatOf(body))).status).toBe(404);
  });

  it("refresh respeta el rate limit de la apertura y responde 429", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { params: { widget_sessions_per_ip_per_minute: 2 } },
    });
    const body = await opened(seed.widgetKey);
    expect((await refresh(seed, body.conversation_secret)).status).toBe(200);
    expect((await refresh(seed, body.conversation_secret)).status).toBe(429);
  });

  it("refresh con clave de widget invalida responde 401", async () => {
    const body = await opened(seed.widgetKey);
    const response = await refresh(seed, body.conversation_secret, {}, `wk_${"z".repeat(43)}`);
    expect(response.status).toBe(401);
  });

  it("la Idempotency-Key de otra sesion no entrega su token", async () => {
    const key = randomUUID();
    const first = await opened(seed.widgetKey);
    const own = await refresh(seed, first.conversation_secret, { "Idempotency-Key": key });
    expect(own.status).toBe(200);
    const other = await opened(seed.widgetKey);
    const response = await refresh(seed, other.conversation_secret, { "Idempotency-Key": key });
    expect(response.status).toBe(409);
  });

  it("proveedor caido en la renovacion responde 503 sin extender la sesion", async () => {
    const body = await opened(seed.widgetKey);
    const before = await sessionOf(body.conversation_secret);
    resetContainer();
    setFakeIdpDown(true);
    expect((await refresh(seed, body.conversation_secret)).status).toBe(503);
    const after = await sessionOf(body.conversation_secret);
    expect(after.expiresAt).toEqual(before.expiresAt);
  });
});
