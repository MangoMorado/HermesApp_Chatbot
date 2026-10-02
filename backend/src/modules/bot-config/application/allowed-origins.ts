import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { addOrigin, type OriginPolicy, removeOrigin } from "../domain/allowed-origins";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import { type BotConfigView, loadOverrides, viewOf } from "./bot-config";

export type OriginChangeInput = AuditActor & {
  readonly tenantId: TenantId;
  readonly origin: unknown;
};
export type ChangeAllowedOrigin = (input: OriginChangeInput) => Promise<BotConfigView>;

type Deps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly clock: Clock;
  readonly audit: AuditLog;
  readonly originPolicy: OriginPolicy;
};

type Change = (current: readonly string[], raw: unknown, policy: OriginPolicy) => string[];

/**
 * Cambia un solo origen con la fila bloqueada: dos administradores que agregan a la vez no se
 * pisan (a diferencia del PATCH, que reemplaza la lista entera).
 */
function createChangeAllowedOrigin(
  deps: Deps,
  change: Change,
  action: string,
): ChangeAllowedOrigin {
  return async (input) => {
    if (!(await deps.configs.lock(input.tenantId))) {
      throw new NotFoundError();
    }
    const current = await loadOverrides(deps.configs, input.tenantId);
    const allowedOrigins = change(current.allowedOrigins, input.origin, deps.originPolicy);
    const next = { ...current, allowedOrigins };
    await deps.configs.update(input.tenantId, next);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action,
      resourceType: "bot_config",
      resourceId: input.tenantId,
      requestId: input.requestId,
      occurredAt: deps.clock.now(),
    });
    return viewOf(deps, input.tenantId, next);
  };
}

export function createAddAllowedOrigin(deps: Deps): ChangeAllowedOrigin {
  return createChangeAllowedOrigin(deps, addOrigin, "bot_config.origin_added");
}

export function createRemoveAllowedOrigin(deps: Deps): ChangeAllowedOrigin {
  return createChangeAllowedOrigin(
    deps,
    (current, raw) => removeOrigin(current, raw),
    "bot_config.origin_removed",
  );
}
