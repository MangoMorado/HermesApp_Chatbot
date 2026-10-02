import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  OPTIONS as preflightRefresh,
  POST as refreshSession,
} from "@/app/api/v1/widget/sessions/refresh/route";
import { POST as openSession, OPTIONS as preflightOpen } from "@/app/api/v1/widget/sessions/route";
import { resetContainer } from "@/composition-root";
import { authedRequest } from "../helpers/token";
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

  it("una ruta con token rechaza un Origin distinto al de la sesion", async () => {
    const { token } = await (await open(seed)).json();
    const refresh = (headers: Record<string, string>) =>
      refreshSession(
        authedRequest(URL_REFRESH, token, {
          method: "POST",
          headers: { "Idempotency-Key": randomUUID(), ...headers },
        }),
      );
    expect((await refresh({ Origin: "https://clinica-b.test" })).status).toBe(403);
    const same = await refresh({ Origin: ORIGIN });
    expect(same.status).toBe(200);
    expect(same.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect((await refresh({})).status).toBe(200);
    const pre = await preflightRefresh(
      new Request(URL_REFRESH, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
