import type { TenantId } from "@/modules/shared/domain/tenant-id";

/**
 * Clave publica del widget. Esta en el HTML de la clinica: solo identifica al tenant y
 * abre sesiones. Se guarda en claro porque un hash no protege una clave publica.
 */
export type WidgetKey = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly key: string;
  readonly createdAt: Date;
  readonly retiredAt: Date | null;
  readonly graceUntil: Date | null;
};

export const WIDGET_KEY_PATTERN = /^wk_[A-Za-z0-9_-]{43}$/;

const HOUR_MS = 3_600_000;

export type KeyRetirement = {
  readonly id: string;
  readonly retiredAt: Date;
  readonly graceUntil: Date;
};

/** Vigente, o retirada con la gracia aun sin vencer (`now` estrictamente anterior). */
export function isKeyAccepted(key: WidgetKey, now: Date): boolean {
  if (key.retiredAt === null) {
    return true;
  }
  return key.graceUntil !== null && now.getTime() < key.graceUntil.getTime();
}

/**
 * Rotar: la vigente pasa a gracia y la que ya estaba en gracia muere ahora. Asi nunca hay
 * mas de dos claves aceptadas.
 */
export function planRotation(
  accepted: readonly WidgetKey[],
  now: Date,
  graceHours: number,
): KeyRetirement[] {
  return accepted.map((key) =>
    key.retiredAt === null
      ? { id: key.id, retiredAt: now, graceUntil: new Date(now.getTime() + graceHours * HOUR_MS) }
      : { id: key.id, retiredAt: key.retiredAt, graceUntil: now },
  );
}

export function splitKeys(accepted: readonly WidgetKey[]): {
  current: WidgetKey | null;
  grace: WidgetKey | null;
} {
  return {
    current: accepted.find((key) => key.retiredAt === null) ?? null,
    grace: accepted.find((key) => key.retiredAt !== null) ?? null,
  };
}
