import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { OriginPolicy } from "../domain/allowed-origins";
import { applyPatch, EMPTY_OVERRIDES } from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import type { WidgetKeyGenerator } from "../domain/ports/widget-key-generator";

export type ProvisionBotConfig = (input: {
  tenantId: TenantId;
  allowedOrigins: unknown;
}) => Promise<{ widgetKey: string }>;

type Deps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly generator: WidgetKeyGenerator;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly originPolicy: OriginPolicy;
};

/** Config con predeterminados (solo los origenes del alta) y la primera clave vigente. */
export function createProvisionBotConfig(deps: Deps): ProvisionBotConfig {
  return async ({ tenantId, allowedOrigins }) => {
    const overrides = applyPatch(EMPTY_OVERRIDES, { allowedOrigins }, deps.originPolicy);
    await deps.configs.create(tenantId, overrides);
    const widgetKey = deps.generator.next();
    await deps.keys.insert({
      id: deps.ids.next(),
      tenantId,
      key: widgetKey,
      createdAt: deps.clock.now(),
      retiredAt: null,
      graceUntil: null,
    });
    return { widgetKey };
  };
}
