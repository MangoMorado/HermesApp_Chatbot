import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { createPrismaAuditLog } from "@/modules/shared/infrastructure/prisma-audit-log";
import { insertTenant, testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();
let sequence = 0;
const auditLog = createPrismaAuditLog(prisma, { next: () => `audit-${++sequence}` });

describe("auditoria: se registra el hecho, no el contenido", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await insertTenant(prisma, "a");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("guarda el evento con sus campos de hecho", async () => {
    const occurredAt = new Date("2026-03-02T15:00:00.000Z");
    await auditLog.record({
      tenantId: toTenantId("tenant-a"),
      actorSubject: "admin-1",
      actorRole: "admin",
      action: "tenant_settings.updated",
      resourceType: "tenant",
      resourceId: "tenant-a",
      requestId: "req-1",
      occurredAt,
    });

    const rows = await prisma.auditEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "tenant-a",
      action: "tenant_settings.updated",
      resourceType: "tenant",
      occurredAt,
    });
  });

  it("la tabla no tiene columnas donde quepa contenido", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_events' ORDER BY column_name`;
    expect(rows.map((row) => row.column_name)).toEqual([
      "action",
      "actor_role",
      "actor_subject",
      "id",
      "occurred_at",
      "request_id",
      "resource_id",
      "resource_type",
      "tenant_id",
    ]);
  });
});
