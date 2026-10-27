import type { PlatformActor } from "@/modules/auth/domain/actor";
import type { MachineCredentialStore } from "@/modules/auth/domain/ports/machine-credentials";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import { parseWidgetClient } from "../domain/widget-client";

export type SetWidgetClient = (input: {
  tenantId: string;
  raw: unknown;
  actor: PlatformActor;
  requestId: string;
}) => Promise<{ clientId: string; updatedAt: Date }>;

type Deps = {
  readonly registry: TenantRegistry;
  readonly credentials: MachineCredentialStore;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/** Registra o rota las credenciales del widget de una clinica. Se audita el `client_id`, nunca el secreto. */
export function createSetWidgetClient(deps: Deps): SetWidgetClient {
  return async ({ tenantId, raw, actor, requestId }) => {
    const credential = parseWidgetClient(raw);
    if (!(await deps.registry.exists(tenantId))) {
      throw new NotFoundError("Tenant inexistente");
    }
    const updatedAt = deps.clock.now();
    await deps.credentials.put(toTenantId(tenantId), "widget", credential, updatedAt);
    await deps.audit.record({
      tenantId: toTenantId(tenantId),
      actorSubject: actor.subject,
      actorRole: actor.role,
      action: "widget_client.set",
      resourceType: "widget_client",
      resourceId: credential.clientId,
      requestId,
      occurredAt: updatedAt,
    });
    return { clientId: credential.clientId, updatedAt };
  };
}
