import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaTenantSettingsRepository } from "@/modules/tenancy/infrastructure/prisma-tenant-settings-repository";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const repository = createPrismaTenantSettingsRepository(prisma);

describe("aislamiento-tenant: ajustes del tenant", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await insertTenant(prisma, "a");
    await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lee el tope por defecto", async () => {
    expect(await repository.get(toTenantId("tenant-a"))).toEqual({ maxQueryRangeDays: 31 });
  });

  it("actualizar un tenant no toca al otro", async () => {
    const updated = await repository.update(toTenantId("tenant-a"), { maxQueryRangeDays: 90 });

    expect(updated).toEqual({ maxQueryRangeDays: 90 });
    expect(await repository.get(toTenantId("tenant-b"))).toEqual({ maxQueryRangeDays: 31 });
  });

  it("un tenant inexistente devuelve null al leer y al actualizar", async () => {
    expect(await repository.get(toTenantId("tenant-x"))).toBeNull();
    expect(await repository.update(toTenantId("tenant-x"), { maxQueryRangeDays: 10 })).toBeNull();
  });
});
