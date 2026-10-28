import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  createFindWidgetSessionBySecret,
  createGetActiveWidgetSession,
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
  secretHash: "hash:secreto",
  ...overrides,
});

function sessions(overrides: Partial<WidgetSessionRepository> = {}): WidgetSessionRepository {
  return {
    create: vi.fn(async () => undefined),
    get: vi.fn(async () => session()),
    getBySecretHash: vi.fn(async () => session()),
    extend: vi.fn(async () => undefined),
    ...overrides,
  };
}

const secrets = { generate: () => "secreto", hash: (secret: string) => `hash:${secret}` };

describe("sesion-widget: casos de uso", () => {
  it("start crea sesion con origen en minusculas, TTL y hash del secreto", async () => {
    const ports = sessions();
    const start = createStartWidgetSession({
      sessions: ports,
      secrets,
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
    expect(created.conversationSecret).toBe("secreto");
    expect(created.session).toMatchObject({
      id: "sess-new",
      origin: "https://clinica.test",
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      secretHash: "hash:secreto",
    });
    expect(ports.create).toHaveBeenCalledWith(created.session);
  });

  it("getActive rechaza ausente o vencida", async () => {
    const get = createGetActiveWidgetSession({
      sessions: sessions({ get: vi.fn(async () => null) }),
      clock: { now: () => NOW },
    });
    await expect(get(TENANT, "x")).rejects.toBeInstanceOf(NotFoundError);

    const expired = createGetActiveWidgetSession({
      sessions: sessions({
        get: vi.fn(async () => session({ expiresAt: NOW })),
      }),
      clock: { now: () => NOW },
    });
    await expect(expired(TENANT, "sess-1")).rejects.toBeInstanceOf(NotFoundError);
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

  it("findBySecret busca por hash dentro del tenant y rechaza vacio o vencido", async () => {
    const ports = sessions();
    const find = createFindWidgetSessionBySecret({
      sessions: ports,
      secrets,
      clock: { now: () => NOW },
    });
    await expect(find(TENANT, "secreto")).resolves.toMatchObject({ id: "sess-1" });
    expect(ports.getBySecretHash).toHaveBeenCalledWith(TENANT, "hash:secreto");
    await expect(find(TENANT, "")).rejects.toBeInstanceOf(NotFoundError);

    const expired = createFindWidgetSessionBySecret({
      sessions: sessions({ getBySecretHash: vi.fn(async () => session({ expiresAt: NOW })) }),
      secrets,
      clock: { now: () => NOW },
    });
    await expect(expired(TENANT, "secreto")).rejects.toBeInstanceOf(NotFoundError);
  });
});
