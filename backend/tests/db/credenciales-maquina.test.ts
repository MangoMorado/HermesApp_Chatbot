import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClosedSessions } from "@/modules/auth/infrastructure/prisma-closed-sessions";
import { createPrismaMachineCredentialStore } from "@/modules/auth/infrastructure/prisma-machine-credential-store";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createAesGcmSecretBox } from "@/modules/shared/infrastructure/aes-gcm-secret-box";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma = testPrisma();
const store = createPrismaMachineCredentialStore(
  prisma,
  createAesGcmSecretBox(new Uint8Array(32).fill(7)),
);
const closed = createPrismaClosedSessions(prisma);
const now = new Date("2026-10-27T10:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe("credenciales-maquina", () => {
  let t: ReturnType<typeof toTenantId>;
  let other: ReturnType<typeof toTenantId>;

  beforeEach(async () => {
    await truncateAll(prisma);
    t = toTenantId(await insertTenant(prisma, "a"));
    other = toTenantId(await insertTenant(prisma, "b"));
  });
  afterAll(() => prisma.$disconnect());

  it("put/get con secreto sellado en base", async () => {
    await store.put(t, "widget", { clientId: "widget-a", clientSecret: "abc" }, now);
    const row = await prisma.machineCredential.findFirstOrThrow();
    expect(row.secretSealed).not.toContain("abc");
    expect(await store.get(t, "widget")).toEqual({ clientId: "widget-a", clientSecret: "abc" });
  });

  it("put reemplaza", async () => {
    await store.put(t, "widget", { clientId: "widget-a", clientSecret: "abc" }, now);
    await store.put(t, "widget", { clientId: "widget-nuevo", clientSecret: "xyz" }, minutes(1));
    expect(await store.get(t, "widget")).toEqual({ clientId: "widget-nuevo", clientSecret: "xyz" });
    expect(await prisma.machineCredential.count()).toBe(1);
  });

  it("otro tenant no ve la credencial", async () => {
    await store.put(t, "widget", { clientId: "widget-a", clientSecret: "abc" }, now);
    expect(await store.get(other, "widget")).toBeNull();
  });

  it("closed sessions: cerrado hasta until, luego no", async () => {
    await closed.close("s1", minutes(5));
    expect(await closed.isClosed("s1", now)).toBe(true);
    expect(await closed.isClosed("s1", minutes(6))).toBe(false);
    expect(await closed.isClosed("otra", now)).toBe(false);
  });

  it("close nunca acorta", async () => {
    await closed.close("s1", minutes(10));
    await closed.close("s1", minutes(2));
    expect(await closed.isClosed("s1", minutes(5))).toBe(true);
  });
});
