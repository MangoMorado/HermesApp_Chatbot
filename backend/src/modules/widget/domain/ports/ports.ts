import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { WidgetSession } from "../widget-session";

/** Lo que el widget necesita saber de una clave aceptada; lo cumple el modulo bot-config. */
export type WidgetAccess = {
  readonly tenantId: TenantId;
  readonly allowedOrigins: readonly string[];
  readonly sessionTtlMinutes: number;
  readonly sessionsPerIpPerMinute: number;
};

export type WidgetKeyResolver = (key: string, now: Date) => Promise<WidgetAccess | null>;

export type WidgetSettingsReader = (
  tenantId: TenantId,
) => Promise<{ readonly sessionTtlMinutes: number }>;

export type WidgetSessionRepository = {
  create(session: WidgetSession): Promise<void>;
  get(tenantId: TenantId, id: string): Promise<WidgetSession | null>;
  /** Actualiza `last_seen_at` y `expires_at`. */
  extend(session: WidgetSession): Promise<void>;
};

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/** Ventana fija de 60 s por cubo. In-memory en Fase 3; store compartido en Fase 5. */
export type RateLimiter = {
  hit(bucket: string, limit: number, now: Date): RateDecision;
};
