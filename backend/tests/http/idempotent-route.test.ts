import { beforeEach, describe, expect, it, vi } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const authenticate = vi.fn();
const withWriteTransaction = vi.fn();
const idempotencyStore = {
  find: vi.fn(async () => null),
  save: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
};
const NOW = new Date("2026-06-15T08:00:00.000Z");

vi.mock("@/composition-root", () => ({
  getContainer: () => ({
    authenticate,
    withWriteTransaction,
    idempotencyStore,
    config: { credentialsEncryptionKey: new Uint8Array(32).fill(7) },
  }),
}));

import { idempotentRoute } from "@/http/idempotent-route";

const TENANT = toTenantId("t1");
const ACTOR = {
  tenantId: TENANT,
  subject: "admin-1",
  role: "admin" as const,
};

describe("http: idempotentRoute", () => {
  beforeEach(() => {
    authenticate.mockReset().mockResolvedValue(ACTOR);
    withWriteTransaction
      .mockReset()
      .mockImplementation(async (fn: (ports: unknown) => unknown) =>
        fn({ idempotencyStore, clock: { now: () => NOW } }),
      );
    idempotencyStore.find.mockReset().mockResolvedValue(null);
    idempotencyStore.save.mockReset();
    idempotencyStore.complete.mockReset();
  });

  it("ejecuta el handler y responde JSON con X-Request-Id", async () => {
    const handler = vi.fn(async () => ({
      status: 201,
      body: { ok: true },
      stored: { ok: true },
    }));
    const route = idempotentRoute(["admin"], handler);
    const response = await route(
      new Request("http://localhost/api/v1/x", {
        method: "POST",
        headers: {
          Authorization: "Bearer t",
          "Idempotency-Key": "idem-key-1",
          "X-Request-Id": "req-9",
        },
        body: '{"a":1}',
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-Id")).toBe("req-9");
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(idempotencyStore.save).toHaveBeenCalledOnce();
    expect(idempotencyStore.complete).toHaveBeenCalledOnce();
  });

  it("aplica guard, sensitiveBody y rebuild; errores van a errorResponse", async () => {
    const guard = vi.fn(async () => undefined);
    const rebuild = vi.fn(async () => ({ status: 200, body: { rebuilt: true } }));
    const route = idempotentRoute(["admin"], async () => ({ status: 200, body: { ok: true } }), {
      guard,
      sensitiveBody: true,
      rebuild,
    });

    authenticate.mockRejectedValueOnce(new ValidationError("sin token"));
    const denied = await route(
      new Request("http://localhost/api/v1/x", {
        method: "POST",
        headers: { "Idempotency-Key": "idem-key-2" },
        body: "{}",
      }),
    );
    expect(denied.status).toBeGreaterThanOrEqual(400);

    authenticate.mockResolvedValue(ACTOR);
    const ok = await route(
      new Request("http://localhost/api/v1/x", {
        method: "POST",
        headers: {
          Authorization: "Bearer t",
          "Idempotency-Key": "idem-key-3",
        },
        body: "{}",
      }),
    );
    expect(guard).toHaveBeenCalledOnce();
    expect(ok.status).toBe(200);
  });
});
