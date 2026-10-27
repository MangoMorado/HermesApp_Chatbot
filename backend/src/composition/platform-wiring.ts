import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createPrismaMachineCredentialStore } from "../modules/auth/infrastructure/prisma-machine-credential-store";
import { createProvisionBotConfig } from "../modules/bot-config/application/provisioning";
import { cryptoWidgetKeyGenerator } from "../modules/bot-config/infrastructure/crypto-widget-key-generator";
import { createSeedDefaultKnowledge } from "../modules/knowledge/application/knowledge-entries";
import { createPrismaKnowledgeRepository } from "../modules/knowledge/infrastructure/prisma-knowledge-repository";
import { createListTenants } from "../modules/platform/application/list-tenants";
import { createRegisterTenant } from "../modules/platform/application/register-tenant";
import { createSetWidgetClient } from "../modules/platform/application/set-widget-client";
import type { TenantProvisioning } from "../modules/platform/domain/ports/provisioning";
import { createPrismaTenantRegistry } from "../modules/platform/infrastructure/prisma-tenant-registry";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import { createAesGcmSecretBox } from "../modules/shared/infrastructure/aes-gcm-secret-box";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";
import { botConfigStores, originPolicyOf } from "./bot-config-wiring";

/**
 * Cableado de plataforma (alta de tenants y credenciales de widget). El alta reutiliza
 * los stores y la politica de origenes de bot-config; no reimplementa ese armado.
 */

export function platformWritePorts(db: PrismaExecutor, config: AppConfig, auditLog: AuditLog) {
  const { configs, keys } = botConfigStores(db);
  const provisioning: TenantProvisioning = {
    provisionBotConfig: createProvisionBotConfig({
      configs,
      keys,
      generator: cryptoWidgetKeyGenerator,
      ids: uuidV7Generator,
      clock: systemClock,
      originPolicy: originPolicyOf(config),
    }),
    seedKnowledge: createSeedDefaultKnowledge({
      repo: createPrismaKnowledgeRepository(db),
      ids: uuidV7Generator,
    }),
  };
  const registry = createPrismaTenantRegistry(db);
  const credentials = createPrismaMachineCredentialStore(
    db,
    createAesGcmSecretBox(config.credentialsEncryptionKey),
  );
  return {
    registerTenant: createRegisterTenant({
      registry,
      provisioning,
      credentials,
      ids: uuidV7Generator,
      audit: auditLog,
      clock: systemClock,
    }),
    setWidgetClient: createSetWidgetClient({
      registry,
      credentials,
      audit: auditLog,
      clock: systemClock,
    }),
  };
}

export function platformReads(prisma: PrismaClient) {
  return { listTenants: createListTenants(createPrismaTenantRegistry(prisma)) };
}
