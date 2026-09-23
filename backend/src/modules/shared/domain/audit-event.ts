import type { TenantId } from "./tenant-id";

/**
 * Un hecho auditable. Por diseño no tiene campo de contenido: se registra quien hizo
 * que sobre que recurso y cuando, nunca los datos (no divulgacion, GOBERNANZA §1.5).
 */
export type AuditEvent = {
  readonly tenantId: TenantId;
  readonly actorSubject: string;
  readonly actorRole: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly occurredAt: Date;
};

/** Quien origina un cambio auditable; los casos de uso lo reciben junto a su entrada. */
export type AuditActor = {
  readonly actorSubject: string;
  readonly actorRole: string;
  readonly requestId: string;
};
