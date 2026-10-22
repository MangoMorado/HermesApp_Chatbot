import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/env";
import { createJoseTokenIssuer } from "../modules/auth/infrastructure/jose-token-issuer";
import { createProvisionBotConfig } from "../modules/bot-config/application/provisioning";
import { cryptoWidgetKeyGenerator } from "../modules/bot-config/infrastructure/crypto-widget-key-generator";
import { createSeedDefaultKnowledge } from "../modules/knowledge/application/knowledge-entries";
import { createPrismaKnowledgeRepository } from "../modules/knowledge/infrastructure/prisma-knowledge-repository";
import { createIssueToken } from "../modules/platform/application/issue-token";
import { createListTenants } from "../modules/platform/application/list-tenants";
import { createRegisterTenant } from "../modules/platform/application/register-tenant";
import type { TenantProvisioning } from "../modules/platform/domain/ports/provisioning";
import { createPrismaTenantRegistry } from "../modules/platform/infrastructure/prisma-tenant-registry";
import type { AuditLog } from "../modules/shared/domain/ports/audit-log";
import { createPrismaAuditLog } from "../modules/shared/infrastructure/prisma-audit-log";
import type { PrismaExecutor } from "../modules/shared/infrastructure/prisma-client";
import { systemClock } from "../modules/shared/infrastructure/system-clock";
import { uuidV7Generator } from "../modules/shared/infrastructure/uuid-v7-generator";
import { botConfigStores, originPolicyOf } from "./bot-config-wiring";

/**
 * Cableado de plataforma (alta de tenants y emision de tokens). El alta reutiliza
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
  return {
    registerTenant: createRegisterTenant({
      registry: createPrismaTenantRegistry(db),
      provisioning,
      ids: uuidV7Generator,
      audit: auditLog,
      clock: systemClock,
    }),
  };
}

export function platformReads(prisma: PrismaClient, config: AppConfig) {
  const registry = createPrismaTenantRegistry(prisma);
  return {
    issueToken: createIssueToken({
      registry,
      issuer: createJoseTokenIssuer(config.jwt),
      audit: createPrismaAuditLog(prisma, uuidV7Generator),
      clock: systemClock,
    }),
    listTenants: createListTenants(registry),
  };
}
