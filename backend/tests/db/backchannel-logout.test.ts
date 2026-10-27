import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as backchannelLogout } from "@/app/api/v1/auth/backchannel-logout/route";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { getContainer, resetContainer } from "@/composition-root";
import { authorized, signLogoutToken, signToken } from "../helpers/idp";
import { testPrisma, truncateAll } from "./support";

const prisma = testPrisma();

function logout(token?: string): Promise<Response> {
  const body = new URLSearchParams();
  if (token !== undefined) {
    body.set("logout_token", token);
  }
  return backchannelLogout(
    new Request("http://localhost/api/v1/auth/backchannel-logout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
}

async function meStatus(sid: string): Promise<number> {
  const bearer = await signToken({ role: "operator", tenantId: "t", sid });
  return (await getIdentity(authorized(bearer))).status;
}

// Back-channel logout OIDC: cierra la sesion del proveedor por sid.
describe("backchannel-logout", () => {
  beforeAll(async () => {
    await truncateAll(prisma);
    resetContainer();
  });
  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("logout valido → 200 y el bearer con ese sid pasa a 401", async () => {
    expect(await meStatus("sid-1")).toBe(200);
    const response = await logout(await signLogoutToken({ sid: "sid-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({});
    expect(await meStatus("sid-1")).toBe(401);
  });

  it("otro sid sigue vivo", async () => {
    await logout(await signLogoutToken({ sid: "sid-2" }));
    expect(await meStatus("sid-3")).toBe(200);
  });

  it("el cierre cubre maxTokenLifetime + tolerancia y luego caduca", async () => {
    await logout(await signLogoutToken({ sid: "sid-4" }));
    const { maxTokenLifetimeSeconds, clockToleranceSeconds } = getContainer().config.oidc;
    const window = maxTokenLifetimeSeconds + clockToleranceSeconds;
    const closed = getContainer().closedSessions;
    const at = (seconds: number) => new Date(Date.now() + seconds * 1000);
    expect(await closed.isClosed("sid-4", at(maxTokenLifetimeSeconds + 1))).toBe(true);
    expect(await closed.isClosed("sid-4", at(window - 5))).toBe(true);
    expect(await closed.isClosed("sid-4", at(window + 5))).toBe(false);
  });

  const invalid: Array<[string, () => Promise<string | undefined>]> = [
    ["sin logout_token", async () => undefined],
    ["audiencia chatbot-api", () => signLogoutToken({ sid: "s", audience: "chatbot-api" })],
    ["con nonce", () => signLogoutToken({ sid: "s", nonce: "n" })],
    ["firma ajena", async () => `${await signLogoutToken({ sid: "s" })}x`],
  ];
  it.each(invalid)("%s → 400 invalid_request", async (_name, build) => {
    const response = await logout(await build());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("repetir el mismo logout es inocuo → 200", async () => {
    const token = await signLogoutToken({ sid: "sid-5" });
    expect((await logout(token)).status).toBe(200);
    expect((await logout(token)).status).toBe(200);
    expect(await meStatus("sid-5")).toBe(401);
  });
});
