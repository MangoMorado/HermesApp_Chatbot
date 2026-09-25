import type {
  InboxIdentifier,
  InboxRef,
  InboxRequest,
} from "@/modules/hermes-simulator/domain/inbox";

function identifierJson(identifier: InboxIdentifier) {
  return { system: identifier.system, value: identifier.value };
}

function refJson(ref: InboxRef | null) {
  return (
    ref && {
      identifier: identifierJson(ref.identifier),
      start_at: ref.startAt.toISOString(),
      end_at: ref.endAt.toISOString(),
    }
  );
}

/** Datos de identificacion para la bandeja; ningun dato clinico. */
export function inboxRequestJson(row: InboxRequest) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    resolution_reason: row.resolutionReason,
    patient: {
      identifier: identifierJson(row.patient.identifier),
      document_type: row.patient.documentType,
      document_number: row.patient.documentNumber,
      given_names: row.patient.givenNames,
      family_names: row.patient.familyNames,
    },
    slot: refJson(row.slot),
    appointment: refJson(row.appointment),
    resulting_appointment: row.resultingAppointment && {
      identifier: identifierJson(row.resultingAppointment.identifier),
    },
  };
}
