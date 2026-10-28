import { beforeEach, describe, expect, it, vi } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const getActiveWidgetSession = vi.fn();
const conversationSecretBox = {
  seal: vi.fn((secret: string) => `sealed:${secret}`),
  open: vi.fn((sealed: string) => sealed.replace(/^sealed:/, "")),
};

vi.mock("@/composition-root", () => ({
  getContainer: () => ({ getActiveWidgetSession, conversationSecretBox }),
}));

import {
  CONVERSATION_SECRET_HEADER,
  conversationSecretOf,
  conversationSessionId,
  openedSessionOutcome,
  rebuildOpenedSession,
  rebuildRefreshedSession,
  refreshedSessionOutcome,
} from "@/http/widget-session-response";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";

const TENANT = toTenantId("t1");
const NOW = new Date("2026-06-15T08:30:00.000Z");
const SESSION = {
  id: "sess-1",
  tenantId: TENANT,
  origin: "https://a.test",
  secretHash: "h",
  createdAt: NOW,
  expiresAt: NOW,
  lastSeenAt: NOW,
};
const TOKEN = { accessToken: "jwt", expiresAt: NOW };

describe("http: respuesta de sesion widget", () => {
  beforeEach(() => {
    getActiveWidgetSession.mockReset();
  });

  it("la apertura devuelve token y secreto, y guarda el secreto sellado", () => {
    const outcome = openedSessionOutcome({ session: SESSION, conversationSecret: "cs" }, TOKEN);
    expect(outcome.status).toBe(201);
    expect(outcome.body).toMatchObject({
      access_token: "jwt",
      expires_at: NOW.toISOString(),
      session_expires_at: NOW.toISOString(),
      conversation_secret: "cs",
    });
    expect(outcome.stored).toEqual({ session_id: "sess-1", sealed_secret: "sealed:cs" });
  });

  it("la renovacion guarda solo session_id", () => {
    const outcome = refreshedSessionOutcome(SESSION, TOKEN);
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ access_token: "jwt" });
    expect(outcome.stored).toEqual({ session_id: "sess-1" });
  });

  it("rebuild de apertura abre el secreto sellado con el token nuevo", async () => {
    getActiveWidgetSession.mockResolvedValue(SESSION);
    const rebuilt = await rebuildOpenedSession(
      { status: 201, body: { session_id: "sess-1", sealed_secret: "sealed:cs" } },
      TENANT,
      { accessToken: "fresh", expiresAt: NOW },
    );
    expect(rebuilt.status).toBe(201);
    expect(rebuilt.body).toMatchObject({ access_token: "fresh", conversation_secret: "cs" });
  });

  it("rebuild de apertura sin secreto sellado es conflicto", async () => {
    await expect(
      rebuildOpenedSession({ status: 201, body: { session_id: "sess-1" } }, TENANT, TOKEN),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rebuild de renovacion rehace el token y choca si es otra sesion", async () => {
    getActiveWidgetSession.mockResolvedValue(SESSION);
    const same = { status: 200, body: { session_id: "sess-1" } };
    await expect(rebuildRefreshedSession(same, TENANT, "sess-1", TOKEN)).resolves.toMatchObject({
      status: 200,
      body: { access_token: "jwt" },
    });
    const other = { status: 200, body: { session_id: "otra" } };
    await expect(rebuildRefreshedSession(other, TENANT, "sess-1", TOKEN)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("conversationSecretOf exige la cabecera", () => {
    const withSecret = new Request("http://localhost/x", {
      headers: { [CONVERSATION_SECRET_HEADER]: " s3 " },
    });
    expect(conversationSecretOf(withSecret)).toBe("s3");
    expect(() => conversationSecretOf(new Request("http://localhost/x"))).toThrow(NotFoundError);
  });

  it("conversationSessionId exige un sujeto de conversacion", () => {
    expect(conversationSessionId({ subject: "widget:s1", tenantId: TENANT, role: "widget" })).toBe(
      "s1",
    );
    expect(() =>
      conversationSessionId({ subject: "svc", tenantId: TENANT, role: "widget" }),
    ).toThrow(NotFoundError);
  });
});
