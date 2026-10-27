import type { PlatformActor } from "@/modules/auth/domain/actor";
import type { MachineCredentialStore } from "@/modules/auth/domain/ports/machine-credentials";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantProvisioning } from "../domain/ports/provisioning";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import { parseTenantDraft, type TenantSummary } from "../domain/tenant-registration";

export type RegisterTenant = (input: {
  raw: unknown;
  actor: PlatformActor;
  requestId: string;
}) => Promise<{ tenant: TenantSummary; widgetKey: string; widgetClientId: string | null }>;

type Deps = {
  readonly registry: TenantRegistry;
  readonly provisioning: TenantProvisioning;
  readonly credentials: MachineCredentialStore;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/**
 * Alta en una transaccion: tenant, bot-config, clave, KB de ejemplo y, si viene, la credencial
 * del widget (sellada). Cualquier fallo
 * (slug repetido, origen invalido) revierte todo, incluida la reserva de la Idempotency-Key.
 */
export function createRegisterTenant(deps: Deps): RegisterTenant {
  return async ({ raw, actor, requestId }) => {
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
    const occurredAt = deps.clock.now();
    if (draft.widgetClient) {
      await deps.credentials.put(tenantId, "widget", draft.widgetClient, occurredAt);
    }
    await deps.audit.record({
      tenantId,
      actorSubject: actor.subject,
      actorRole: actor.role,
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: tenant.id,
      requestId,
      occurredAt,
    });
    return { tenant, widgetKey, widgetClientId: draft.widgetClient?.clientId ?? null };
  };
}
