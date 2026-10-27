import {
  DOCUMENT_SYSTEM_PREFIX,
  isDocumentSystem,
  PRE_REGISTRATION_SYSTEM,
  REPLACES_EXTENSION,
} from "../domain/fhir-contract";
import type { InboxIdentifier, InboxRef, InboxRequest } from "../domain/inbox";
import {
  asRecord,
  type FhirId,
  firstReferenceId,
  readIdentifiers,
  referenceId,
  requiredString,
} from "./fhir-json";

type Party = InboxRequest["patient"];

function instants(record: Record<string, unknown>): Pick<InboxRef, "startAt" | "endAt"> {
  const startAt = new Date(requiredString(record, "start"));
  const endAt = new Date(requiredString(record, "end"));
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new TypeError("start o end invalidos");
  }
  return { startAt, endAt };
}

function firstIdentifier(record: Record<string, unknown>, label: string): FhirId {
  const identifier = readIdentifiers(record.identifier)[0];
  if (!identifier) {
    throw new Error(`${label} sin identifier`);
  }
  return identifier;
}

function patientIdentifier(identifiers: readonly FhirId[]): FhirId {
  const business = identifiers.find(
    (item) => !isDocumentSystem(item.system) && item.system !== PRE_REGISTRATION_SYSTEM,
  );
  const preRegistered = identifiers.find((item) => item.system === PRE_REGISTRATION_SYSTEM);
  const identifier = business ?? preRegistered;
  if (!identifier) {
    throw new Error("Patient sin identificador");
  }
  return identifier;
}

function documentOf(identifiers: readonly FhirId[]): { type: string; number: string } {
  const document = identifiers.find((item) => isDocumentSystem(item.system));
  if (!document) {
    throw new Error("Patient sin documento");
  }
  return { type: document.system.slice(DOCUMENT_SYSTEM_PREFIX.length), number: document.value };
}

function nameOf(value: unknown): { givenNames: string; familyNames: string } {
  if (!Array.isArray(value) || value[0] === undefined) {
    throw new Error("Patient.name es obligatorio");
  }
  const name = asRecord(value[0], "name");
  const given = name.given;
  if (
    !Array.isArray(given) ||
    given.some((part) => typeof part !== "string") ||
    given.length === 0
  ) {
    throw new Error("name.given es obligatorio");
  }
  return {
    givenNames: given.join(" "),
    familyNames: requiredString(name, "family"),
  };
}

function patientOf(record: Record<string, unknown>): Party {
  const identifiers = readIdentifiers(record.identifier);
  const document = documentOf(identifiers);
  return {
    identifier: patientIdentifier(identifiers),
    documentType: document.type,
    documentNumber: document.number,
    ...nameOf(record.name),
  };
}

function whenOf(record: Record<string, unknown>, label: string): InboxRef {
  return { identifier: firstIdentifier(record, label), ...instants(record) };
}

function participantId(value: unknown, type: string): string {
  if (!Array.isArray(value)) {
    throw new TypeError("participant es obligatorio");
  }
  for (const item of value) {
    const reference = requiredString(
      asRecord(asRecord(item, "participant").actor, "actor"),
      "reference",
    );
    const prefix = `${type}/`;
    if (reference.startsWith(prefix)) {
      return reference.slice(prefix.length);
    }
  }
  throw new Error(`falta el participante ${type}`);
}

function replacesId(record: Record<string, unknown>): string | null {
  if (record.extension === undefined) {
    return null;
  }
  if (!Array.isArray(record.extension)) {
    throw new Error("extension invalida");
  }
  for (const item of record.extension) {
    const row = asRecord(item, "extension");
    if (row.url === REPLACES_EXTENSION) {
      return referenceId(row.valueReference, "Appointment");
    }
  }
  return null;
}

function inboxStatus(status: string): InboxRequest["status"] {
  if (status === "proposed" || status === "requested") {
    return "pending";
  }
  if (status === "booked" || status === "completed") {
    return "approved";
  }
  if (status === "rejected") {
    return "rejected";
  }
  return "expired";
}

type Loader = (path: string) => Promise<Record<string, unknown>>;

function assemble(
  record: Record<string, unknown>,
  kind: InboxRequest["kind"],
  patient: Party,
  slot: InboxRef | null,
  appointment: InboxRef | null,
  when: Pick<InboxRef, "startAt" | "endAt">,
): InboxRequest {
  const status = requiredString(record, "status");
  const resulting =
    status === "booked" || status === "completed" ? appointmentOrSelf(record, appointment) : null;
  return {
    id: requiredString(record, "id"),
    kind,
    status: inboxStatus(status),
    createdAt: when.startAt,
    expiresAt: when.startAt,
    resolutionReason: null,
    patient,
    slot,
    appointment,
    resultingAppointment: resulting ? { identifier: resulting } : null,
  };
}

function appointmentOrSelf(
  record: Record<string, unknown>,
  appointment: InboxRef | null,
): InboxIdentifier {
  if (requiredString(record, "resourceType") === "Task") {
    if (!appointment) {
      throw new Error("Task sin cita");
    }
    return appointment.identifier;
  }
  return firstIdentifier(record, "Appointment");
}

/** `Appointment` proposed o ya resuelto, con el paciente, el cupo y la cita que reemplaza. */
export async function fromAppointment(
  load: Loader,
  record: Record<string, unknown>,
): Promise<InboxRequest> {
  const replaced = replacesId(record);
  const patient = patientOf(await load(`Patient/${participantId(record.participant, "Patient")}`));
  const slot = whenOf(await load(`Slot/${firstReferenceId(record.slot, "Slot")}`), "Slot");
  const appointment = replaced
    ? whenOf(await load(`Appointment/${replaced}`), "Appointment")
    : null;
  return assemble(
    record,
    replaced ? "reschedule" : "book",
    patient,
    slot,
    appointment,
    instants(record),
  );
}

/** `Task` de cancelacion. La cita es `focus`. */
export async function fromTask(
  load: Loader,
  record: Record<string, unknown>,
): Promise<InboxRequest> {
  const appointment = whenOf(
    await load(`Appointment/${referenceId(record.focus, "Appointment")}`),
    "Appointment",
  );
  const patient = patientOf(await load(`Patient/${referenceId(record.for, "Patient")}`));
  return assemble(record, "cancel", patient, null, appointment, appointment);
}
