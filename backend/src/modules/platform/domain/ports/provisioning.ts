import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Lo que el alta necesita de los modulos dueños; el composition root lo cumple. */
export type TenantProvisioning = {
  provisionBotConfig(input: {
    tenantId: TenantId;
    allowedOrigins: unknown;
  }): Promise<{ widgetKey: string }>;
  seedKnowledge(tenantId: TenantId): Promise<void>;
};
