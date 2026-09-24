import { forbidden, unauthorized } from "@/modules/auth/domain/auth-error";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
import type { RateLimiter, WidgetAccess, WidgetKeyResolver } from "../domain/ports/ports";
import { originAllowed } from "../domain/widget-session";

export type AdmitWidget = (input: {
  widgetKey: unknown;
  origin: string | null;
  clientIp: string | null;
}) => Promise<WidgetAccess>;

type Deps = {
  readonly resolveKey: WidgetKeyResolver;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
};

/**
 * Decide si se abre una sesion: el tenant sale de la clave (nunca del cliente), el Origin
 * debe estar permitido y la IP no puede superar el limite por minuto del tenant.
 */
export function createAdmitWidget(deps: Deps): AdmitWidget {
  return async ({ widgetKey, origin, clientIp }) => {
    const now = deps.clock.now();
    const access = typeof widgetKey === "string" ? await deps.resolveKey(widgetKey, now) : null;
    if (!access) {
      throw unauthorized("Clave de widget invalida");
    }
    if (!originAllowed(origin, access.allowedOrigins)) {
      throw forbidden("Origen no permitido para este widget");
    }
    const bucket = `${access.tenantId}|${clientIp ?? "unknown"}`;
    const decision = deps.rateLimiter.hit(bucket, access.sessionsPerIpPerMinute, now);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterSeconds);
    }
    return access;
  };
}
