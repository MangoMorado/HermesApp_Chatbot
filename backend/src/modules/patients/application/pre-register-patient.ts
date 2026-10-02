import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { MedicalRecord } from "../domain/entities";
import type { MedicalRecordRepository } from "../domain/ports/repositories";
import {
  PRE_REGISTRATION_SYSTEM,
  type PreRegistrationData,
  validatePreRegistration,
} from "../domain/pre-registration";

export type PreRegisterPatient = (
  input: AuditActor & { readonly tenantId: TenantId; readonly data: PreRegistrationData },
) => Promise<MedicalRecord>;

/** El chat solo origina pre-registros; Hermes los confirma (GOBERNANZA §1.2). */
export function createPreRegisterPatient(deps: {
  repo: MedicalRecordRepository;
  ids: IdGenerator;
  clock: Clock;
  audit: AuditLog;
}): PreRegisterPatient {
  return async (input) => {
    const now = deps.clock.now();
    const data = validatePreRegistration(input.data, now.toISOString().slice(0, 10));
    const id = deps.ids.next();
    const record: MedicalRecord = {
      id,
      tenantId: input.tenantId,
      identifier: { system: PRE_REGISTRATION_SYSTEM, value: id },
      ...data,
      status: "pre_registered",
    };
    await deps.repo.insertPreRegistered(record);
    await deps.audit.record({
      tenantId: input.tenantId,
      actorSubject: input.actorSubject,
      actorRole: input.actorRole,
      action: "patient.pre_registered",
      resourceType: "medical_record",
      resourceId: id,
      requestId: input.requestId,
      occurredAt: now,
    });
    return record;
  };
}
