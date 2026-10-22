import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import {
  createAddAllowedOrigin,
  createRemoveAllowedOrigin,
} from "../modules/bot-config/application/allowed-origins";
import {
  createGetBotConfig,
  createUpdateBotConfig,
} from "../modules/bot-config/application/bot-config";
import { createRotateWidgetKey } from "../modules/bot-config/application/widget-keys";
import type { OriginPolicy } from "../modules/bot-config/domain/allowed-origins";
import { cryptoWidgetKeyGenerator } from "../modules/bot-config/infrastructure/crypto-widget-key-generator";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import { createPrismaWidgetKeyRepository } from "../modules/bot-config/infrastructure/prisma-widget-key-repository";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";

/**
 * Cableado de la configuracion del bot. Aparte para no empujar `composition-root.ts`
 * por encima del limite de lineas por archivo de logica.
 */

/** Localhost solo fuera de produccion. La usan el panel y el alta de tenants. */
export function originPolicyOf(config: AppConfig): OriginPolicy {
  return { allowLocalhost: config.nodeEnv !== "production" };
}

/** Config y claves sobre el mismo executor: lectura del contenedor o transaccion de escritura. */
export function botConfigStores(db: PrismaExecutor) {
  return {
    configs: createPrismaBotConfigRepository(db),
    keys: createPrismaWidgetKeyRepository(db),
  };
}

export function botConfigWritePorts(db: PrismaExecutor, config: AppConfig, auditLog: AuditLog) {
  const { configs, keys } = botConfigStores(db);
  const originDeps = {
    configs,
    keys,
    clock: systemClock,
    audit: auditLog,
    originPolicy: originPolicyOf(config),
  };
  return {
    botConfigs: configs,
    widgetKeys: keys,
    updateBotConfig: createUpdateBotConfig(originDeps),
    addAllowedOrigin: createAddAllowedOrigin(originDeps),
    removeAllowedOrigin: createRemoveAllowedOrigin(originDeps),
    rotateWidgetKey: createRotateWidgetKey({
      configs,
      keys,
      clock: systemClock,
      generator: cryptoWidgetKeyGenerator,
      ids: uuidV7Generator,
      audit: auditLog,
    }),
  };
}

export function botConfigReads(prisma: PrismaClient) {
  const { configs, keys } = botConfigStores(prisma);
  return {
    getBotConfig: createGetBotConfig({ configs, keys, clock: systemClock }),
  };
}
