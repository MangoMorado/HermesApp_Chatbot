import { beforeEach, describe, expect, it, vi } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const getActiveWidgetSession = vi.fn();
const issueSessionToken = vi.fn();

vi.mock("@/composition-root", () => ({
  getContainer: () => ({ getActiveWidgetSession, issueSessionToken }),
}));

import {
  rebuildSessionResponse,
  sessionIdOf,
  sessionTokenJson,
} from "@/http/widget-session-response";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { ConflictError } from "@/modules/shared/domain/conflict-error";

const TENANT = toTenantId("t1");
const NOW = new Date("2026-06-15T08:30:00.000Z");

describe("http: respuesta de sesion widget", () => {
  beforeEach(() => {
    getActiveWidgetSession.mockReset();
    issueSessionToken.mockReset();
  });

  it("serializa session_id, token y expires_at", () => {
    expect(
      sessionTokenJson(
        {
          id: "sess-1",
          tenantId: TENANT,
          origin: "https://a.test",
          createdAt: NOW,
          expiresAt: NOW,
          lastSeenAt: NOW,
        },
        { token: "jwt", expiresAt: NOW },
      ),
    ).toEqual({
      session_id: "sess-1",
      token: "jwt",
      expires_at: NOW.toISOString(),
    });
  });

  it("rebuild vuelve a firmar si la sesion sigue vigente", async () => {
    getActiveWidgetSession.mockResolvedValue({
      id: "sess-1",
      tenantId: TENANT,
      origin: "https://a.test",
      createdAt: NOW,
      expiresAt: NOW,
      lastSeenAt: NOW,
    });
    issueSessionToken.mockResolvedValue({ token: "fresh", expiresAt: NOW });
    const rebuilt = await rebuildSessionResponse(
      { status: 201, body: { session_id: "sess-1" } },
      TENANT,
    );
    expect(rebuilt).toEqual({
      status: 201,
      body: { session_id: "sess-1", token: "fresh", expires_at: NOW.toISOString() },
    });
  });

  it("rebuild deja el stored si no hay session_id y choca si es otra sesion", async () => {
    await expect(
      rebuildSessionResponse({ status: 200, body: { token: "x" } }, TENANT),
    ).resolves.toEqual({ status: 200, body: { token: "x" } });

    await expect(
      rebuildSessionResponse({ status: 200, body: { session_id: "otra" } }, TENANT, "sess-1"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("sessionIdOf exige session_id en el actor", () => {
    expect(sessionIdOf({ subject: "w", tenantId: TENANT, role: "widget", sessionId: "s1" })).toBe(
      "s1",
    );
    expect(() => sessionIdOf({ subject: "w", tenantId: TENANT, role: "widget" })).toThrow(
      AuthError,
    );
  });
});
