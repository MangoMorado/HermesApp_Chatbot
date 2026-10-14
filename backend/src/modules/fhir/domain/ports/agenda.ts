import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { ResolutionReasonCode } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import type { AppointmentRecord, TaskRecord } from "./sources";

export type AgendaResolution =
  | { readonly outcome: "approved"; readonly appointmentIdentifier: FhirIdentifier }
  | { readonly outcome: "rejected"; readonly reason: ResolutionReasonCode };

export type AgendaResolveInput = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly kind: "agenda" | "cancel";
  readonly resolution: AgendaResolution;
};

/** Lectura y resolución de la pre-agenda dentro de la transacción de escritura. */
export type AgendaResolver = {
  expire(tenantId: TenantId): Promise<void>;
  readAppointment(tenantId: TenantId, id: string): Promise<AppointmentRecord | null>;
  readTask(tenantId: TenantId, id: string): Promise<TaskRecord | null>;
  resolve(input: AgendaResolveInput): Promise<void>;
};
