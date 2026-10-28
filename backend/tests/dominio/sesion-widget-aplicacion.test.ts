import { describe, expect, it, vi } from "vitest";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  createGetActiveWidgetSession,
  createIssueSessionToken,
  createRefreshWidgetSession,
  createStartWidgetSession,
} from "@/modules/widget/application/widget-sessions";
import type { WidgetSessionRepository } from "@/modules/widget/domain/ports/ports";
import type { WidgetSession } from "@/modules/widget/domain/widget-session";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");

const session = (overrides: Partial<WidgetSession> = {}): WidgetSession => ({
  id: "sess-1",
  tenantId: TENANT,
  origin: "https://clinica.test",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 30 * 60_000),
  lastSeenAt: NOW,
  ...overrides,
});

function sessions(overrides: Partial<WidgetSessionRepository> = {}): WidgetSessionRepository {
  return {
    create: vi.fn(async () => undefined),
    get: vi.fn(async () => session()),
    extend: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("sesion-widget: casos de uso", () => {
  it("start crea sesion con origen en minusculas y TTL", async () => {
    const ports = sessions();
    const start = createStartWidgetSession({
      sessions: ports,
      ids: { next: () => "sess-new" },
      clock: { now: () => NOW },
    });
    const created = await start({
      access: {
        tenantId: TENANT,
        allowedOrigins: ["https://clinica.test"],
        sessionTtlMinutes: 30,
        sessionsPerIpPerMinute: 10,
      },
      origin: "HTTPS://Clinica.TEST",
    });
    expect(created).toMatchObject({
      id: "sess-new",
      origin: "https://clinica.test",
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });
    expect(ports.create).toHaveBeenCalledWith(created);
  });

  it("getActive rechaza ausente o vencida", async () => {
    const get = createGetActiveWidgetSession({
      sessions: sessions({ get: vi.fn(async () => null) }),
      clock: { now: () => NOW },
    });
    await expect(get(TENANT, "x")).rejects.toBeInstanceOf(AuthError);

    const expired = createGetActiveWidgetSession({
      sessions: sessions({
        get: vi.fn(async () => session({ expiresAt: NOW })),
      }),
      clock: { now: () => NOW },
    });
    await expect(expired(TENANT, "sess-1")).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("refresh extiende con el TTL vigente del tenant", async () => {
    const ports = sessions();
    const refresh = createRefreshWidgetSession({
      sessions: ports,
      settings: async () => ({ sessionTtlMinutes: 60 }),
      clock: { now: () => NOW },
    });
    const next = await refresh({ tenantId: TENANT, sessionId: "sess-1" });
    expect(next.expiresAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
    expect(ports.extend).toHaveBeenCalledWith(next);
  });

  it("issueSessionToken firma con rol widget y session_id", async () => {
    const issuer = {
      issue: vi.fn(async () => "jwt-token"),
    };
    const issue = createIssueSessionToken({
      issuer,
      clock: { now: () => NOW },
    });
    const result = await issue(session());
    expect(result).toEqual({ token: "jwt-token", expiresAt: session().expiresAt });
    expect(issuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "widget",
        sessionId: "sess-1",
        tenantId: TENANT,
        subject: "widget:sess-1",
      }),
    );
  });
});
