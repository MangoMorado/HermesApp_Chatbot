import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { effectiveConfig } from "../domain/bot-config";
import type { BotConfigRepository, WidgetKeyRepository } from "../domain/ports/repositories";
import type { WidgetKeyGenerator } from "../domain/ports/widget-key-generator";
import { planRotation } from "../domain/widget-key";
import { type BotConfigView, loadOverrides, viewOf } from "./bot-config";

export type RotateWidgetKey = (
  input: AuditActor & { tenantId: TenantId },
) => Promise<BotConfigView>;

type RotateDeps = {
  readonly configs: BotConfigRepository;
  readonly keys: WidgetKeyRepository;
  readonly generator: WidgetKeyGenerator;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/**
 * La vigente pasa a gracia (`widget_key_grace_hours`) y la que ya estaba en gracia muere.
 * Si otra rotacion gano la carrera, el indice unico parcial hace fallar el insert → 409.
 */
export function createRotateWidgetKey(deps: RotateDeps): RotateWidgetKey {
  return async (input) => {
    const overrides = await loadOverrides(deps.configs, input.tenantId);
    const now = deps.clock.now();
    const graceHours = effectiveConfig(overrides).params.widget_key_grace_hours;
    const accepted = await deps.keys.listAccepted(input.tenantId, now);
    await Promise.all(
      planRotation(accepted, now, graceHours).map((retirement) =>
        deps.keys.retire(input.tenantId, retirement),
      ),
    );
    const id = deps.ids.next();
    const key = deps.generator.next();
    await deps.keys.insert({
      id,
      tenantId: input.tenantId,
      key,
      createdAt: now,
      retiredAt: null,
      graceUntil: null,
    });
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "widget_key.rotated",
      resourceType: "widget_key",
      resourceId: id,
      requestId: input.requestId,
      occurredAt: now,
    });
    return viewOf(deps, input.tenantId, overrides);
  };
}
