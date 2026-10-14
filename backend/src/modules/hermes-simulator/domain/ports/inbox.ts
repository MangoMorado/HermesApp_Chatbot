import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { Page } from "@/modules/shared/domain/pagination";
import type { InboxIdentifier, InboxRequest, InboxResolution } from "../inbox";

/**
 * El chatbot visto desde Hermes. En la 3.2 lo cumple el composition root en proceso;
 * en la Fase 4, un cliente FHIR con token `service`.
 */
export type ChatbotRequestsGateway = {
  listPending(filter: {
    readonly tenantId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<Page<InboxRequest>>;
  /** Lanza `NotFoundError` si no existe en el tenant. */
  get(tenantId: string, id: string): Promise<InboxRequest>;
  resolve(input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly resolution: InboxResolution;
    readonly actor: AuditActor;
  }): Promise<InboxRequest>;
};

export type SimSlotStatus = "free" | "busy" | "busy_tentative" | "busy_unavailable";

export type SimSlotRef = {
  readonly id: string;
  readonly scheduleId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: SimSlotStatus;
};

export type NewSimAppointment = {
  readonly id: string;
  readonly tenantId: string;
  readonly identifier: InboxIdentifier;
  readonly patientId: string;
  readonly scheduleId: string;
  readonly slotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type SimInboxStore = {
  findPatientId(tenantId: string, identifier: InboxIdentifier): Promise<string | null>;
  /** Bloquea el cupo del simulador (`FOR UPDATE`). */
  lockSlot(tenantId: string, identifier: InboxIdentifier): Promise<SimSlotRef | null>;
  findAppointment(
    tenantId: string,
    identifier: InboxIdentifier,
  ): Promise<{ readonly id: string; readonly slotId: string } | null>;
  setSlotStatus(tenantId: string, id: string, status: SimSlotStatus): Promise<void>;
  cancelAppointment(tenantId: string, id: string): Promise<void>;
  setAppointmentStatus(tenantId: string, id: string, status: "booked" | "cancelled"): Promise<void>;
  deleteAppointment(tenantId: string, id: string): Promise<void>;
  createAppointment(row: NewSimAppointment): Promise<void>;
};

/** Transaccion de Hermes que confirma antes de hablar con el chatbot. */
export type HermesSession = {
  run<T>(fn: (store: SimInboxStore) => Promise<T>): Promise<T>;
};
