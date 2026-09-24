import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { OriginPolicy } from "../domain/allowed-origins";
import {
  applyPatch,
  type BotConfigOverrides,
  type BotConfigPatch,
  type EffectiveBotConfig,
  effectiveConfig,
} from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import { splitKeys, type WidgetKey } from "../domain/widget-key";

export type BotConfigView = {
  readonly config: EffectiveBotConfig;
  readonly currentKey: WidgetKey | null;
  readonly graceKey: WidgetKey | null;
};

type ReadDeps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly clock: Clock;
};

export async function loadOverrides(configs: BotConfigRepository, tenantId: TenantId) {
  const overrides = await configs.get(tenantId);
  if (!overrides) {
    throw new NotFoundError();
  }
  return overrides;
}

export async function viewOf(
  deps: ReadDeps,
  tenantId: TenantId,
  overrides: BotConfigOverrides,
): Promise<BotConfigView> {
  const { current, grace } = splitKeys(await deps.keys.listAccepted(tenantId, deps.clock.now()));
  return { config: effectiveConfig(overrides), currentKey: current, graceKey: grace };
}

export type GetBotConfig = (tenantId: TenantId) => Promise<BotConfigView>;

export function createGetBotConfig(deps: ReadDeps): GetBotConfig {
  return async (tenantId) => viewOf(deps, tenantId, await loadOverrides(deps.configs, tenantId));
}

export type UpdateBotConfigInput = AuditActor & {
  readonly tenantId: TenantId;
  readonly patch: BotConfigPatch;
};

export type UpdateBotConfig = (input: UpdateBotConfigInput) => Promise<BotConfigView>;

export function createUpdateBotConfig(
  deps: ReadDeps & { readonly audit: AuditLog; readonly originPolicy: OriginPolicy },
): UpdateBotConfig {
  return async (input) => {
    const current = await loadOverrides(deps.configs, input.tenantId);
    const next = applyPatch(current, input.patch, deps.originPolicy);
    await deps.configs.update(input.tenantId, next);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "bot_config.updated",
      resourceType: "bot_config",
      resourceId: input.tenantId,
      requestId: input.requestId,
      occurredAt: deps.clock.now(),
    });
    return viewOf(deps, input.tenantId, next);
  };
}
