import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { fhirInvalid, fhirMultipleMatches, fhirNotSupported } from "../domain/fhir-error";
import { parseHealthcareServiceBody } from "../domain/parsers/healthcare-service";
import { parsePatientBody } from "../domain/parsers/patient";
import { parsePractitionerBody } from "../domain/parsers/practitioner";
import { parseScheduleBody } from "../domain/parsers/schedule";
import { parseSlotBody } from "../domain/parsers/slot";
import type { FhirWriter, FhirWriters, WriteResult } from "../domain/ports/writers";
import { DEFINITIONS } from "../domain/registry";
import type { FhirIdentifier, FhirResource } from "../domain/resources/types";
import { collectParams, parseToken, single } from "../domain/search";

export type ConditionalPutInput = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly type: string;
  readonly entries: readonly (readonly [string, string])[];
  readonly body: unknown;
};

export type ConditionalPut = (
  input: ConditionalPutInput,
) => Promise<{ readonly status: 200 | 201; readonly resource: FhirResource }>;

function queryIdentifierOf(entries: readonly (readonly [string, string])[]): FhirIdentifier {
  const params = collectParams(entries);
  for (const name of params.keys()) {
    if (name !== "identifier") {
      throw fhirNotSupported(`Parametro no soportado en PUT condicional: ${name}`);
    }
  }
  const raw = single(params, "identifier");
  if (raw === null) {
    throw fhirInvalid("identifier es obligatorio");
  }
  return parseToken("identifier", raw);
}

function assertBodyId<R extends { readonly id: string }>(
  bodyId: string | null,
  result: Exclude<WriteResult<R>, { readonly outcome: "ambiguous" }>,
): void {
  if (bodyId === null) {
    return;
  }
  if (result.outcome === "created" || bodyId !== result.record.id) {
    throw fhirInvalid("El id del cuerpo no coincide con el recurso");
  }
}

async function execute<C, R extends { readonly id: string }>(
  writer: FhirWriter<C, R>,
  command: C,
  bodyId: string | null,
  toResource: (record: R) => FhirResource,
): Promise<{ readonly status: 200 | 201; readonly resource: FhirResource }> {
  const result = await writer(command);
  if (result.outcome === "ambiguous") {
    throw fhirMultipleMatches("Mas de un recurso coincide con identifier");
  }
  assertBodyId(bodyId, result);
  return {
    status: result.outcome === "created" ? 201 : 200,
    resource: toResource(result.record),
  };
}

function putPatient(writers: FhirWriters, input: ConditionalPutInput, identifier: FhirIdentifier) {
  const { bodyId, ...payload } = parsePatientBody(input.body, identifier);
  return execute(
    writers.Patient,
    { tenantId: input.tenantId, actor: input.actor, ...payload },
    bodyId,
    DEFINITIONS.Patient.toResource,
  );
}

function putPractitioner(
  writers: FhirWriters,
  input: ConditionalPutInput,
  identifier: FhirIdentifier,
) {
  const { bodyId, ...payload } = parsePractitionerBody(input.body, identifier);
  return execute(
    writers.Practitioner,
    { tenantId: input.tenantId, actor: input.actor, ...payload },
    bodyId,
    DEFINITIONS.Practitioner.toResource,
  );
}

function putHealthcareService(
  writers: FhirWriters,
  input: ConditionalPutInput,
  identifier: FhirIdentifier,
) {
  const { bodyId, ...payload } = parseHealthcareServiceBody(input.body, identifier);
  return execute(
    writers.HealthcareService,
    { tenantId: input.tenantId, actor: input.actor, ...payload },
    bodyId,
    DEFINITIONS.HealthcareService.toResource,
  );
}

function putSchedule(writers: FhirWriters, input: ConditionalPutInput, identifier: FhirIdentifier) {
  const { bodyId, ...payload } = parseScheduleBody(input.body, identifier);
  return execute(
    writers.Schedule,
    { tenantId: input.tenantId, actor: input.actor, ...payload },
    bodyId,
    DEFINITIONS.Schedule.toResource,
  );
}

function putSlot(writers: FhirWriters, input: ConditionalPutInput, identifier: FhirIdentifier) {
  const { bodyId, ...payload } = parseSlotBody(input.body, identifier);
  return execute(
    writers.Slot,
    { tenantId: input.tenantId, actor: input.actor, ...payload },
    bodyId,
    DEFINITIONS.Slot.toResource,
  );
}

export function createConditionalPut(writers: FhirWriters): ConditionalPut {
  return (input) => {
    const identifier = queryIdentifierOf(input.entries);
    switch (input.type) {
      case "Patient":
        return putPatient(writers, input, identifier);
      case "Practitioner":
        return putPractitioner(writers, input, identifier);
      case "HealthcareService":
        return putHealthcareService(writers, input, identifier);
      case "Schedule":
        return putSchedule(writers, input, identifier);
      case "Slot":
        return putSlot(writers, input, identifier);
      default:
        throw fhirNotSupported("El recurso no admite PUT condicional");
    }
  };
}
