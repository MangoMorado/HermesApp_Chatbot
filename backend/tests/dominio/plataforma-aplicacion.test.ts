import { describe, expect, it, vi } from "vitest";
import { createIssueToken } from "@/modules/platform/application/issue-token";
import { createListTenants } from "@/modules/platform/application/list-tenants";
import type { TenantRegistry } from "@/modules/platform/domain/ports/tenant-registry";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const NOW = new Date("2026-06-15T08:00:00.000Z");

function registry(overrides: Partial<TenantRegistry> = {}): TenantRegistry {
  return {
    exists: vi.fn(async () => true),
    list: vi.fn(async () => ({
      data: [{ id: "t1", slug: "norte", name: "Norte", createdAt: NOW }],
      nextCursor: null,
    })),
    create: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("alta-chatbot: emitir token y listar tenants", () => {
  it("emite JWT y audita sin persistir el token", async () => {
    const issuer = { issue: vi.fn(async () => "signed") };
    const audit = { record: vi.fn(async () => undefined) };
    const issue = createIssueToken({
      registry: registry(),
      issuer,
      audit,
      clock: { now: () => NOW },
    });
    const result = await issue({
      raw: { tenant_id: "t1", role: "admin", subject: "ana" },
      requestId: "req-1",
    });
    expect(result.token).toBe("signed");
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 480 * 60_000));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "token.issued",
        resourceType: "token.admin",
        resourceId: "ana",
      }),
    );
  });

  it("falla si el tenant no existe o el body es invalido", async () => {
    const issue = createIssueToken({
      registry: registry({ exists: vi.fn(async () => false) }),
      issuer: { issue: vi.fn() },
      audit: { record: vi.fn() },
      clock: { now: () => NOW },
    });
    await expect(
      issue({ raw: { tenant_id: "x", role: "admin", subject: "ana" }, requestId: "r" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      issue({ raw: { tenant_id: "t", role: "widget", subject: "x" }, requestId: "r" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lista tenants con cursor y limite", async () => {
    const ports = registry();
    const list = createListTenants(ports);
    await list({ limitRaw: "5" });
    expect(ports.list).toHaveBeenCalledWith({ cursor: undefined, limit: 5 });
  });
});
