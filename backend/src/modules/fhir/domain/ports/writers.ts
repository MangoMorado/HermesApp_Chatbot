import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { DocumentCode, SlotStatusKey } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import type {
  HealthcareServiceRecord,
  PatientRecord,
  PractitionerRecord,
  ScheduleRecord,
  SlotRecord,
} from "./sources";

export type WriteOutcome = "created" | "updated";

export type MasterWriteCommand = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: FhirIdentifier;
  readonly name: string;
  readonly active: boolean;
};

export type PatientWriteCommand = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly queryIdentifier: FhirIdentifier;
  readonly businessIdentifier: FhirIdentifier;
  readonly documentType: DocumentCode;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
};

export type ScheduleWriteCommand = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: FhirIdentifier;
  readonly active: boolean;
  readonly practitionerId: string;
  readonly healthcareServiceId: string;
};

export type SlotWriteCommand = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly identifier: FhirIdentifier;
  readonly scheduleId: string;
  readonly status: SlotStatusKey;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type WriteResult<R> =
  | { readonly outcome: WriteOutcome; readonly record: R }
  | { readonly outcome: "ambiguous" };

export type FhirWriter<C, R> = (command: C) => Promise<WriteResult<R>>;

export type FhirWriters = {
  readonly Patient: FhirWriter<PatientWriteCommand, PatientRecord>;
  readonly Practitioner: FhirWriter<MasterWriteCommand, PractitionerRecord>;
  readonly HealthcareService: FhirWriter<MasterWriteCommand, HealthcareServiceRecord>;
  readonly Schedule: FhirWriter<ScheduleWriteCommand, ScheduleRecord>;
  readonly Slot: FhirWriter<SlotWriteCommand, SlotRecord>;
};
