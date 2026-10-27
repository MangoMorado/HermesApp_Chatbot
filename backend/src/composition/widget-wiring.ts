import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createMachineTokenCheck } from "../modules/auth/application/machine-token-check";
import type { ClientToken } from "../modules/auth/domain/ports/client-token-source";
import type { MachineCredentialResolver } from "../modules/auth/domain/ports/machine-credentials";
import { createOidcClientCredentials } from "../modules/auth/infrastructure/oidc-client-credentials";
import { createPrismaMachineCredentialStore } from "../modules/auth/infrastructure/prisma-machine-credential-store";
import {
  createReadBotParams,
  createResolveWidgetKey,
} from "../modules/bot-config/application/widget-access";
import type {
  BotConfigRepository,
  WidgetKeyRepository,
} from "../modules/bot-config/domain/ports/repositories";
import { createPrismaBotConfigRepository } from "../modules/bot-config/infrastructure/prisma-bot-config-repository";
import type { SecretBox } from "../modules/shared/domain/ports/secret-box";
import { type TenantId, toTenantId } from "../modules/shared/domain/tenant-id";
import { createAesGcmSecretBox } from "../modules/shared/infrastructure/aes-gcm-secret-box";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";
import { createAdmitWidget } from "../modules/widget/application/admit-widget";
import {
  createFindWidgetSessionBySecret,
  createGetActiveWidgetSession,
  createRefreshWidgetSession,
  createStartWidgetSession,
} from "../modules/widget/application/widget-sessions";
import type { WidgetKeyResolver, WidgetSettingsReader } from "../modules/widget/domain/ports/ports";
import { cryptoConversationSecrets } from "../modules/widget/infrastructure/crypto-conversation-secrets";
import { createInMemoryRateLimiter } from "../modules/widget/infrastructure/in-memory-rate-limiter";
import { createPrismaWidgetSessionRepository } from "../modules/widget/infrastructure/prisma-widget-session-repository";
import type { AuthWiring } from "./auth-wiring";
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
      secrets: cryptoConversationSecrets,
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

/** Solo el cliente widget de la clinica; el cliente service lo resuelve la config del simulador. */
function widgetCredentialResolver(db: PrismaExecutor, box: SecretBox): MachineCredentialResolver {
  const store = createPrismaMachineCredentialStore(db, box);
  return async (ref) =>
    ref.kind === "widget" ? store.get(toTenantId(ref.tenantId), "widget") : null;
}

export function widgetReads(
  prisma: PrismaClient,
  config: AppConfig,
  auth: Pick<AuthWiring, "oidcDiscovery" | "tokenVerifier">,
) {
  const { configs, keys } = botConfigStores(prisma);
  const sessions = createPrismaWidgetSessionRepository(prisma);
  const box = createAesGcmSecretBox(config.credentialsEncryptionKey);
  // Una sola fuente por contenedor: su cache se indexa por client_id + huella del secreto.
  // Solo se entregan y cachean tokens que verifican como widget de la clinica pedida.
  const tokens = createOidcClientCredentials({
    discovery: auth.oidcDiscovery,
    resolve: widgetCredentialResolver(prisma, box),
    clock: systemClock,
    httpTimeoutMs: config.oidc.httpTimeoutMs,
    validate: createMachineTokenCheck(auth.tokenVerifier),
  });
  return {
    admitWidget: createAdmitWidget({
      resolveKey: widgetKeyResolver(configs, keys),
      rateLimiter: createInMemoryRateLimiter(),
      clock: systemClock,
    }),
    widgetTokenFor: (tenantId: TenantId): Promise<ClientToken> =>
      tokens.tokenFor({ kind: "widget", tenantId }),
    /** Sella el `conversation_secret` en la respuesta idempotente de la apertura. */
    conversationSecretBox: box,
    isWidgetOriginRegistered: (origin: string) => configs.isOriginRegistered(origin),
    getActiveWidgetSession: createGetActiveWidgetSession({ sessions, clock: systemClock }),
    findWidgetSessionBySecret: createFindWidgetSessionBySecret({
      sessions,
      secrets: cryptoConversationSecrets,
      clock: systemClock,
    }),
  };
}
