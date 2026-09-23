import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { type BotParams, effectiveConfig } from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import { isKeyAccepted, WIDGET_KEY_PATTERN } from "../domain/widget-key";

export type WidgetKeyAccess = {
  readonly tenantId: TenantId;
  readonly allowedOrigins: readonly string[];
  readonly params: BotParams;
};

/** Resuelve una clave publica a su tenant; `null` si no existe, esta retirada o vencio su gracia. */
export function createResolveWidgetKey(deps: {
  configs: BotConfigRepository;
  keys: WidgetKeyRepository;
}) {
  return async (key: string, now: Date): Promise<WidgetKeyAccess | null> => {
    if (!WIDGET_KEY_PATTERN.test(key)) {
      return null;
    }
    const found = await deps.keys.findByKey(key);
    if (!found || !isKeyAccepted(found, now)) {
      return null;
    }
    const overrides = await deps.configs.get(found.tenantId);
    if (!overrides) {
      return null;
    }
    const config = effectiveConfig(overrides);
    return { tenantId: found.tenantId, allowedOrigins: config.allowedOrigins, params: config.params };
  };
}

export function createReadBotParams(configs: BotConfigRepository) {
  return async (tenantId: TenantId): Promise<BotParams> => {
    const overrides = await configs.get(tenantId);
    if (!overrides) {
      throw new NotFoundError();
    }
    return effectiveConfig(overrides).params;
  };
}
