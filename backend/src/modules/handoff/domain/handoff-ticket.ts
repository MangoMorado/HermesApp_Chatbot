import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Por que el chat deriva a un asesor. La gestion del ticket llega en la Fase 6. */
export type HandoffReason = "requested" | "verification_locked" | "unverifiable";

export type HandoffTicket = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly conversationId: string;
  readonly reason: HandoffReason;
  /** Solo si el paciente verifico en la sesion (refinamiento 13). */
  readonly medicalRecordId: string | null;
  readonly createdAt: Date;
};
