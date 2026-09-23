import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { PLATFORM_AUDIT_ACTOR } from "../domain/platform-actor";
import type { TenantProvisioning } from "../domain/ports/provisioning";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import { parseTenantDraft, type TenantSummary } from "../domain/tenant-registration";

export type RegisterTenant = (input: {
  raw: unknown;
  requestId: string;
}) => Promise<{ tenant: TenantSummary; widgetKey: string }>;

type Deps = {
  readonly registry: TenantRegistry;
  readonly provisioning: TenantProvisioning;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/**
 * Alta en una transaccion: tenant, bot-config, clave y KB de ejemplo. Cualquier fallo
 * (slug repetido, origen invalido) revierte todo, incluida la reserva de la Idempotency-Key.
 */
export function createRegisterTenant(deps: Deps): RegisterTenant {
  return async ({ raw, requestId }) => {
    const draft = parseTenantDraft(raw);
    const tenant = await deps.registry.create({
      id: deps.ids.next(),
      slug: draft.slug,
      name: draft.name,
    });
    const tenantId = toTenantId(tenant.id);
    const { widgetKey } = await deps.provisioning.provisionBotConfig({
      tenantId,
      allowedOrigins: draft.allowedOrigins,
    });
    await deps.provisioning.seedKnowledge(tenantId);
    await deps.audit.record({
      tenantId,
      ...PLATFORM_AUDIT_ACTOR,
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: tenant.id,
      requestId,
      occurredAt: deps.clock.now(),
    });
    return { tenant, widgetKey };
  };
}
