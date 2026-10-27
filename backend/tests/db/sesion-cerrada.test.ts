import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { getContainer, resetContainer } from "@/composition-root";
import { authorized, signToken } from "../helpers/idp";
import { testPrisma, truncateAll } from "./support";

const prisma = testPrisma();
const inFiveMinutes = () => new Date(Date.now() + 5 * 60_000);

// Sesiones del proveedor cerradas por back-channel logout: el token deja de valer.
describe("sesion-cerrada", () => {
  beforeAll(async () => {
    await truncateAll(prisma);
    resetContainer();
  });
  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  it("sesión del proveedor cerrada → 401", async () => {
    await getContainer().closedSessions.close("sid-x", inFiveMinutes());
    const token = await signToken({ role: "admin", tenantId: "t", sid: "sid-x" });
    const response = await getIdentity(authorized(token));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("sesión del proveedor abierta → 200", async () => {
    const token = await signToken({ role: "admin", tenantId: "t", sid: "sid-abierta" });
    expect((await getIdentity(authorized(token))).status).toBe(200);
  });

  it("un cierre ya vencido no bloquea la sesión", async () => {
    await getContainer().closedSessions.close("sid-vencida", new Date(Date.now() - 60_000));
    const token = await signToken({ role: "admin", tenantId: "t", sid: "sid-vencida" });
    expect((await getIdentity(authorized(token))).status).toBe(200);
  });
});
