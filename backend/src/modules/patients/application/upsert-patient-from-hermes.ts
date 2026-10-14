import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { DocumentType, MedicalRecord } from "../domain/entities";
import type { MedicalRecordRepository } from "../domain/ports/repositories";

type Identifier = MedicalRecord["identifier"];

export type UpsertPatientFromHermes = (input: {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly queryIdentifier: Identifier;
  readonly businessIdentifier: Identifier;
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
}) => Promise<{ readonly outcome: "created" | "updated"; readonly record: MedicalRecord }>;

type Dependencies = {
  readonly repo: MedicalRecordRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
};

function sameIdentifier(left: Identifier, right: Identifier): boolean {
  return left.system === right.system && left.value === right.value;
}

function patientData(
  input: Parameters<UpsertPatientFromHermes>[0],
): Omit<MedicalRecord, "id" | "tenantId"> {
  return {
    identifier: input.businessIdentifier,
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    givenNames: input.givenNames,
    familyNames: input.familyNames,
    birthDate: input.birthDate,
    phone: input.phone,
    email: input.email,
    status: "active",
  };
}

async function auditWrite(
  deps: Dependencies,
  input: Parameters<UpsertPatientFromHermes>[0],
  record: MedicalRecord,
): Promise<void> {
  await deps.audit.record({
    tenantId: input.tenantId,
    ...input.actor,
    action: "patient.written_by_hermes",
    resourceType: "medical_record",
    resourceId: record.id,
    occurredAt: deps.clock.now(),
  });
}

async function findMatches(
  repo: MedicalRecordRepository,
  input: Parameters<UpsertPatientFromHermes>[0],
): Promise<readonly [MedicalRecord | null, MedicalRecord | null]> {
  const queryIsBusiness = sameIdentifier(input.queryIdentifier, input.businessIdentifier);
  const byQuery = queryIsBusiness
    ? await repo.findByIdentifier(input.tenantId, input.queryIdentifier)
    : await repo.findByDocument(input.tenantId, input.documentType, input.documentNumber);
  const byDocument = queryIsBusiness
    ? await repo.findByDocument(input.tenantId, input.documentType, input.documentNumber)
    : byQuery;
  return [byQuery, byDocument];
}

async function persist(
  repo: MedicalRecordRepository,
  existing: MedicalRecord | null,
  record: MedicalRecord,
): Promise<MedicalRecord> {
  if (existing) {
    return repo.updateFromHermes(record);
  }
  await repo.insertActive(record);
  return record;
}

export function createUpsertPatientFromHermes(deps: Dependencies): UpsertPatientFromHermes {
  return async (input) => {
    const [byQuery, byDocument] = await findMatches(deps.repo, input);

    if (byQuery && byDocument && byQuery.id !== byDocument.id) {
      throw new ConflictError("El documento pertenece a otro paciente");
    }
    if (!byQuery && byDocument?.status === "active") {
      throw new ConflictError("El documento ya pertenece a un paciente activo");
    }

    const existing = byQuery ?? byDocument;
    const record: MedicalRecord = {
      id: existing?.id ?? deps.ids.next(),
      tenantId: input.tenantId,
      ...patientData(input),
    };
    const outcome = existing ? "updated" : "created";
    const persisted = await persist(deps.repo, existing, record);
    await auditWrite(deps, input, persisted);
    return { outcome, record: persisted };
  };
}
