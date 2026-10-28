import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  OPTIONS as preflightRefresh,
  POST as refreshSession,
} from "@/app/api/v1/widget/sessions/refresh/route";
import { POST as openSession, OPTIONS as preflightOpen } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import { type ChatbotTenantSeed, insertChatbotTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const ORIGIN = "https://clinica-a.test";
const URL_OPEN = "http://localhost/api/v1/widget/sessions";
const URL_REFRESH = "http://localhost/api/v1/widget/sessions/refresh";

function open(seed: ChatbotTenantSeed, origin = ORIGIN) {
  return openSession(
    new Request(URL_OPEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ widget_key: seed.widgetKey }),
    }),
  );
}

function refreshWith(seed: ChatbotTenantSeed, secret: string, key: string, origin?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": key,
    "X-Conversation-Secret": secret,
  };
  if (origin) {
    headers.Origin = origin;
  }
  return refreshSession(
    new Request(URL_REFRESH, {
      method: "POST",
      headers,
      body: JSON.stringify({ widget_key: seed.widgetKey }),
    }),
  );
}

describe("cors: rutas del widget", () => {
  let seed: ChatbotTenantSeed;

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    seed = await insertChatbotTenant(prisma, "a", { allowedOrigins: [ORIGIN] });
    await insertChatbotTenant(prisma, "b", { allowedOrigins: ["https://clinica-b.test"] });
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("la peticion previa devuelve el origen exacto si esta registrado", async () => {
    const response = await preflightOpen(
      new Request(URL_OPEN, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("un origen no registrado no recibe cabeceras CORS ni comodin", async () => {
    const response = await preflightOpen(
      new Request(URL_OPEN, { method: "OPTIONS", headers: { Origin: "https://mala.test" } }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("la apertura responde con el origen y expone X-Request-Id", async () => {
    const response = await open(seed);
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
  });

  it("el origen de otro tenant abre con 403 aunque reciba CORS", async () => {
    const response = await open(seed, "https://clinica-b.test");
    expect(response.status).toBe(403);
  });

  it("la peticion previa admite la cabecera X-Conversation-Secret", async () => {
    const response = await preflightRefresh(
      new Request(URL_REFRESH, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Conversation-Secret");
  });

  it("la repeticion con la misma clave desde otro origen tambien da 403", async () => {
    const { conversation_secret: secret } = await (await open(seed)).json();
    const key = randomUUID();
    expect((await refreshWith(seed, secret, key, ORIGIN)).status).toBe(200);
    expect((await refreshWith(seed, secret, key, "https://clinica-b.test")).status).toBe(403);
  });

  it("la renovacion rechaza un Origin distinto al de la sesion o ausente", async () => {
    await prisma.botConfig.update({
      where: { tenantId: seed.tenantId },
      data: { allowedOrigins: [ORIGIN, "https://clinica-a2.test"] },
    });
    const { conversation_secret: secret } = await (await open(seed)).json();
    const refresh = (origin?: string) => refreshWith(seed, secret, randomUUID(), origin);
    expect((await refresh("https://clinica-a2.test")).status).toBe(403);
    expect((await refresh()).status).toBe(403);
    const same = await refresh(ORIGIN);
    expect(same.status).toBe(200);
    expect(same.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const pre = await preflightRefresh(
      new Request(URL_REFRESH, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
