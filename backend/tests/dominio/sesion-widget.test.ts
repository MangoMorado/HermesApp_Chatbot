import { describe, expect, it } from "vitest";
import { clientIp } from "@/http/client-ip";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createAdmitWidget } from "@/modules/widget/application/admit-widget";
import type { WidgetAccess } from "@/modules/widget/domain/ports/ports";
import { isSessionActive, originAllowed, sessionExpiry } from "@/modules/widget/domain/widget-session";
import { createInMemoryRateLimiter } from "@/modules/widget/infrastructure/in-memory-rate-limiter";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const ACCESS: WidgetAccess = {
  tenantId: toTenantId("tenant-a"),
  allowedOrigins: ["https://clinica-a.test"],
  sessionTtlMinutes: 30,
  sessionsPerIpPerMinute: 2,
};

describe("sesion-widget: limitador de ventana fija", () => {
  it("admite hasta el limite y luego pide esperar lo que falta de la ventana", () => {
    const limiter = createInMemoryRateLimiter();
    expect(limiter.hit("b", 2, NOW)).toEqual({ allowed: true });
    expect(limiter.hit("b", 2, new Date(NOW.getTime() + 1000))).toEqual({ allowed: true });
    expect(limiter.hit("b", 2, new Date(NOW.getTime() + 20_000))).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
  });

  it("una ventana nueva reinicia la cuenta y los cubos son independientes", () => {
    const limiter = createInMemoryRateLimiter();
    limiter.hit("b", 1, NOW);
    expect(limiter.hit("otro", 1, NOW)).toEqual({ allowed: true });
    expect(limiter.hit("b", 1, new Date(NOW.getTime() + 60_000))).toEqual({ allowed: true });
  });
});

describe("sesion-widget: IP del cliente", () => {
  const request = (xff?: string) =>
    new Request("http://localhost/x", { headers: xff ? { "X-Forwarded-For": xff } : {} });

  it("sin TRUST_PROXY ignora X-Forwarded-For", () => {
    expect(clientIp(request("1.1.1.1"), false)).toBeNull();
  });

  it("con TRUST_PROXY toma la primera entrada", () => {
    expect(clientIp(request(" 1.1.1.1 , 10.0.0.1"), true)).toBe("1.1.1.1");
    expect(clientIp(request(), true)).toBeNull();
  });
});

describe("sesion-widget: reglas de sesion", () => {
  it("origen exacto sin distinguir mayusculas; nulo o lista vacia niegan", () => {
    expect(originAllowed("https://Clinica-A.test", ["https://clinica-a.test"])).toBe(true);
    expect(originAllowed("https://otra.test", ["https://clinica-a.test"])).toBe(false);
    expect(originAllowed(null, ["https://clinica-a.test"])).toBe(false);
    expect(originAllowed("https://clinica-a.test", [])).toBe(false);
  });

  it("la sesion vence en el instante de expires_at", () => {
    const session = { expiresAt: sessionExpiry(NOW, 30) };
    expect(session.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(isSessionActive(session, new Date(session.expiresAt.getTime() - 1))).toBe(true);
    expect(isSessionActive(session, session.expiresAt)).toBe(false);
  });
});

describe("sesion-widget: admision", () => {
  const admit = createAdmitWidget({
    resolveKey: async (key) => (key === "wk_ok" ? ACCESS : null),
    rateLimiter: createInMemoryRateLimiter(),
    clock: { now: () => NOW },
  });
  const input = { widgetKey: "wk_ok", origin: "https://clinica-a.test", clientIp: "1.1.1.1" };

  it("clave desconocida o ausente → unauthorized", async () => {
    await expect(admit({ ...input, widgetKey: "wk_no" })).rejects.toMatchObject({ reason: "unauthorized" });
    await expect(admit({ ...input, widgetKey: 42 })).rejects.toBeInstanceOf(AuthError);
  });

  it("origen no permitido → forbidden", async () => {
    await expect(admit({ ...input, origin: "https://otra.test" })).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("supera el limite por IP → RateLimitedError", async () => {
    const ip = { ...input, clientIp: "9.9.9.9" };
    await admit(ip);
    await admit(ip);
    await expect(admit(ip)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
