import type { Challenge } from "@/modules/verification/domain/challenge";
import type { VerifiableRecord } from "@/modules/verification/domain/questions";
import type { DocumentType } from "./document";

/** Lo que los pasos pueden leer. Solo lectura: las escrituras son efectos declarados. */
export type NamedRef = { readonly id: string; readonly name: string };

export type AvailableSlot = {
  readonly id: string;
  readonly startAt: Date;
  readonly serviceName: string;
  readonly practitionerName: string;
};

export type UpcomingAppointment = {
  readonly id: string;
  readonly startAt: Date;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly practitionerName: string;
};

export type KnowledgeHit = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly detail: string | null;
};

export type SlotFilter = {
  readonly serviceId: string;
  readonly practitionerId: string | null;
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
};

export type ConversationReads = {
  findPatient(
    tenantId: string,
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<VerifiableRecord | null>;
  getPatient(tenantId: string, id: string): Promise<VerifiableRecord | null>;
  /** Ya efectivo: un bloqueo vencido llega con el contador en cero. */
  challenge(tenantId: string, medicalRecordId: string): Promise<Challenge | null>;
  searchKnowledge(tenantId: string, query: string, max: number): Promise<KnowledgeHit[]>;
  getKnowledge(tenantId: string, id: string): Promise<KnowledgeHit | null>;
  listServices(tenantId: string): Promise<NamedRef[]>;
  listPractitioners(tenantId: string, serviceId: string): Promise<NamedRef[]>;
  /** Cupos `free` de agendas activas, ordenados por inicio; vence solicitudes antes de leer. */
  listAvailableSlots(tenantId: string, filter: SlotFilter): Promise<AvailableSlot[]>;
  listUpcomingAppointments(
    tenantId: string,
    medicalRecordId: string,
    now: Date,
  ): Promise<UpcomingAppointment[]>;
};
