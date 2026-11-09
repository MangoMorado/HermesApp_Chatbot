import { describe, expect, it, vi } from "vitest";
import type { Identity } from "@/api/models/identity";
import { ApiClientError } from "@/lib/api-fetcher";
import { resolveIdentity } from "@/lib/identity";
import type { PlatformIdentity } from "@/platform/models/platformIdentity";

const tenantMe: Identity = { subject: "u-1", tenant_id: "t-1", role: "admin" };
const platformMe: PlatformIdentity = { subject: "p-1", role: "platform" };
const forbidden = () => new ApiClientError(403, null, "HTTP 403");

describe("identidad de la sesión", () => {
  it("un token de clínica resuelve kind tenant", async () => {
    const result = await resolveIdentity(
      async () => tenantMe,
      async () => {
        throw forbidden();
      },
    );
    expect(result).toEqual({ kind: "tenant", subject: "u-1", role: "admin", tenantId: "t-1" });
  });

  it("un token platform resuelve kind platform aunque /api/v1/me dé 403", async () => {
    const result = await resolveIdentity(
      async () => {
        throw forbidden();
      },
      async () => platformMe,
    );
    expect(result).toEqual({ kind: "platform", subject: "p-1", role: "platform" });
  });

  it("si ninguna responde, relanza el error de /api/v1/me", async () => {
    const unauthorized = new ApiClientError(401, null, "HTTP 401");
    await expect(
      resolveIdentity(
        async () => {
          throw unauthorized;
        },
        async () => {
          throw forbidden();
        },
      ),
    ).rejects.toBe(unauthorized);
  });

  it("las dos peticiones salen a la vez", async () => {
    let releaseTenant: (value: Identity) => void = () => undefined;
    const loadTenant = vi.fn(
      () =>
        new Promise<Identity>((resolve) => {
          releaseTenant = resolve;
        }),
    );
    const loadPlatform = vi.fn(async () => {
      throw forbidden();
    });
    const pending = resolveIdentity(loadTenant, loadPlatform);
    expect(loadTenant).toHaveBeenCalledTimes(1);
    expect(loadPlatform).toHaveBeenCalledTimes(1);
    releaseTenant(tenantMe);
    expect((await pending).kind).toBe("tenant");
  });
});
