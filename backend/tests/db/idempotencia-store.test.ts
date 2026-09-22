import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  IdempotencyKeyTakenError,
  type IdempotencyRecord,
} from "@/modules/shared/domain/idempotency";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaIdempotencyStore } from "@/modules/shared/infrastructure/prisma-idempotency-store";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
const store = createPrismaIdempotencyStore(prisma);

function record(tenant: string, key: string): IdempotencyRecord {
  return {
    tenantId: toTenantId(tenant),
    key,
    actorSubject: "admin-1",
    method: "PATCH",
    path: "/api/v1/tenant-settings",
    requestHash: "hash-1",
    responseStatus: 200,
    responseBody: { max_query_range_days: 60 },
    createdAt: new Date("2026-03-02T15:00:00.000Z"),
  };
}

describe("idempotencia: almacen de claves", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await insertTenant(prisma, "a");
    await insertTenant(prisma, "b");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("guarda y recupera la respuesta", async () => {
    await store.save(record("tenant-a", "k-1"));
    expect(await store.find(toTenantId("tenant-a"), "k-1")).toEqual(record("tenant-a", "k-1"));
  });

  it("una clave desconocida devuelve null", async () => {
    expect(await store.find(toTenantId("tenant-a"), "k-x")).toBeNull();
  });

  it("la misma clave en otro tenant es independiente", async () => {
    await store.save(record("tenant-a", "k-1"));
    await store.save(record("tenant-b", "k-1"));
    expect(await store.find(toTenantId("tenant-b"), "k-1")).not.toBeNull();
  });

  it("repetir la clave en el mismo tenant lanza IdempotencyKeyTakenError", async () => {
    await store.save(record("tenant-a", "k-1"));
    await expect(store.save(record("tenant-a", "k-1"))).rejects.toBeInstanceOf(
      IdempotencyKeyTakenError,
    );
  });
});
