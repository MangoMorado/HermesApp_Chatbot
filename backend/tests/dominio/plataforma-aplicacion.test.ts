import { describe, expect, it, vi } from "vitest";
import { createListTenants } from "@/modules/platform/application/list-tenants";
import type { TenantRegistry } from "@/modules/platform/domain/ports/tenant-registry";

const NOW = new Date("2026-06-15T08:00:00.000Z");

function registry(overrides: Partial<TenantRegistry> = {}): TenantRegistry {
  return {
    exists: vi.fn(async () => true),
    list: vi.fn(async () => ({
      data: [{ id: "t1", slug: "norte", name: "Norte", createdAt: NOW }],
      nextCursor: null,
    })),
    create: vi.fn(async () => ({
      id: "t1",
      slug: "norte",
      name: "Norte",
      createdAt: NOW,
    })),
    ...overrides,
  };
}

describe("alta-chatbot: listar tenants", () => {
  it("lista tenants con cursor y limite", async () => {
    const ports = registry();
    const list = createListTenants(ports);
    await list({ limitRaw: "5" });
    expect(ports.list).toHaveBeenCalledWith({ cursor: undefined, limit: 5 });
  });
});
