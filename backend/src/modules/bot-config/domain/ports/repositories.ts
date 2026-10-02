import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { BotConfigOverrides } from "../bot-config";
import type { KeyRetirement, WidgetKey } from "../widget-key";

/** `null` / `false` significan que el tenant no tiene bot-config (no existe). */
export type BotConfigRepository = {
  get(tenantId: TenantId): Promise<BotConfigOverrides | null>;
  create(tenantId: TenantId, overrides: BotConfigOverrides): Promise<void>;
  update(tenantId: TenantId, overrides: BotConfigOverrides): Promise<boolean>;
  /** `SELECT ... FOR UPDATE` de la fila del tenant; `false` si no existe. Solo en transaccion. */
  lock(tenantId: TenantId): Promise<boolean>;
  /** Algun tenant tiene este origen entre sus permitidos (CORS de la peticion previa). */
  isOriginRegistered(origin: string): Promise<boolean>;
};

export type WidgetKeyRepository = {
  /** Vigente y en gracia a `now`, la mas reciente primero. */
  listAccepted(tenantId: TenantId, now: Date): Promise<WidgetKey[]>;
  findByKey(key: string): Promise<WidgetKey | null>;
  /** Lanza `ConflictError` si el tenant ya tiene una clave vigente. */
  insert(key: WidgetKey): Promise<void>;
  retire(tenantId: TenantId, retirement: KeyRetirement): Promise<void>;
};
