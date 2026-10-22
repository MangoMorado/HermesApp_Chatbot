import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createJoseTokenIssuer } from "../modules/auth/infrastructure/jose-token-issuer";
import {
  createReadBotParams,
  createResolveWidgetKey,
} from "../modules/bot-config/application/widget-access";
import type {
  BotConfigRepository,
  WidgetKeyRepository,
} from "../modules/bot-config/domain/ports/repositories";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";
import { createAdmitWidget } from "../modules/widget/application/admit-widget";
import {
  createGetActiveWidgetSession,
  createIssueSessionToken,
  createRefreshWidgetSession,
  createStartWidgetSession,
} from "../modules/widget/application/widget-sessions";
import type { WidgetKeyResolver, WidgetSettingsReader } from "../modules/widget/domain/ports/ports";
import { createInMemoryRateLimiter } from "../modules/widget/infrastructure/in-memory-rate-limiter";
import { createPrismaWidgetSessionRepository } from "../modules/widget/infrastructure/prisma-widget-session-repository";
import { botConfigStores } from "./bot-config-wiring";

/**
 * Cableado del widget para el composition root. Vive aparte para no empujar
 * `composition-root.ts` por encima del limite de lineas por archivo de logica.
 */

export function widgetKeyResolver(
  configs: BotConfigRepository,
  keys: WidgetKeyRepository,
): WidgetKeyResolver {
  const resolve = createResolveWidgetKey({ configs, keys });
  return async (key, now) => {
    const access = await resolve(key, now);
    return (
      access && {
        tenantId: access.tenantId,
        allowedOrigins: access.allowedOrigins,
        sessionTtlMinutes: access.params.widget_session_ttl_minutes,
        sessionsPerIpPerMinute: access.params.widget_sessions_per_ip_per_minute,
      }
    );
  };
}

export function widgetSettingsReader(configs: BotConfigRepository): WidgetSettingsReader {
  const readParams = createReadBotParams(configs);
  return async (tenantId) => ({
    sessionTtlMinutes: (await readParams(tenantId)).widget_session_ttl_minutes,
  });
}

export function widgetWritePorts(db: PrismaExecutor) {
  const sessions = createPrismaWidgetSessionRepository(db);
  return {
    startWidgetSession: createStartWidgetSession({
      sessions,
      ids: uuidV7Generator,
      clock: systemClock,
    }),
    refreshWidgetSession: createRefreshWidgetSession({
      sessions,
      settings: widgetSettingsReader(createPrismaBotConfigRepository(db)),
      clock: systemClock,
    }),
  };
}

export function widgetReads(prisma: PrismaClient, config: AppConfig) {
  const { configs, keys } = botConfigStores(prisma);
  return {
    admitWidget: createAdmitWidget({
      resolveKey: widgetKeyResolver(configs, keys),
      rateLimiter: createInMemoryRateLimiter(),
      clock: systemClock,
    }),
    issueSessionToken: createIssueSessionToken({
      issuer: createJoseTokenIssuer(config.jwt),
      clock: systemClock,
    }),
    isWidgetOriginRegistered: (origin: string) => configs.isOriginRegistered(origin),
    getActiveWidgetSession: createGetActiveWidgetSession({
      sessions: createPrismaWidgetSessionRepository(prisma),
      clock: systemClock,
    }),
  };
}
