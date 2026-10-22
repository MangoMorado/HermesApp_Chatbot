import type { SimPatient } from "../domain/entities";
import {
  DOCUMENT_SYSTEM_PREFIX,
  HERMES_PATIENT_SYSTEM,
  isDocumentSystem,
  PRE_REGISTERED_TAG,
} from "../domain/fhir-contract";
import { fingerprint } from "../domain/fingerprint";
import type { InboxRequest } from "../domain/inbox";
import type { SimCatalog } from "../domain/ports/catalog";
import type { FhirHttp, ServiceTokenIssuer } from "../domain/ports/fhir-http";
import type { ChatbotRequests } from "../domain/ports/inbox";
import { patientBody, practitionerBody, scheduleBody, serviceBody, slotBody } from "./fhir-bodies";
import {
  asRecord,
  bundleEntries,
  bundleTotal,
  type FhirId,
  readIdentifiers,
  requiredString,
  resourceId,
} from "./fhir-json";
import type { InboxCommand } from "./inbox";

const PAGE_CAP = 20;

export type HermesSyncReport = {
  readonly written: number;
  readonly retryLater: number;
  readonly resolved: number;
  readonly confirmed: number;
};

type Named = { readonly identifierSystem: string; readonly identifierValue: string };
type Counts = { written: number; retryLater: number };

type SyncDeps = {
  readonly catalog: SimCatalog;
  readonly http: FhirHttp;
  readonly tokens: ServiceTokenIssuer;
  readonly chatbot: ChatbotRequests;
  readonly approve: (command: InboxCommand) => Promise<InboxRequest>;
};

const HERMES_ACTOR = {
  actorSubject: "hermes-sync",
  actorRole: "service" as const,
  requestId: "hermes-sync",
};

function identifierQuery(type: string, row: Named): string {
  const identifier = encodeURIComponent(`${row.identifierSystem}|${row.identifierValue}`);
  return `${type}?identifier=${identifier}`;
}

async function searchAll(
  http: FhirHttp,
  token: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  let offset = 0;
  for (let page = 0; page < PAGE_CAP; page++) {
    const response = await http.request({
      method: "GET",
      path: `${query}&_count=200&_offset=${offset}`,
      token,
    });
    if (response.status !== 200) {
      throw new Error(`${query} respondio ${response.status}`);
    }
    const batch = bundleEntries(response.body).map((item) => asRecord(item, query));
    found.push(...batch);
    if (batch.length === 0 || found.length >= bundleTotal(response.body)) {
      return found;
    }
    offset += batch.length;
  }
  throw new Error(`La busqueda ${query} no termino`);
}

async function writeMaster(
  http: FhirHttp,
  token: string,
  type: string,
  row: Named,
  body: unknown,
  counts: Counts,
): Promise<string | null> {
  const response = await http.request({
    method: "PUT",
    path: identifierQuery(type, row),
    token,
    body,
    idempotencyKey: `sync:${type}:${row.identifierSystem}|${row.identifierValue}:${fingerprint(body)}`,
  });
  if (type === "Slot" && response.status === 409) {
    counts.retryLater += 1;
    return null;
  }
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`PUT ${type} respondio ${response.status}`);
  }
  counts.written += 1;
  return resourceId(response.body, type);
}

function remember(
  map: Map<string, string>,
  simId: string,
  publicId: string | null,
  label: string,
): void {
  if (!publicId) {
    throw new Error(`${label} ${simId} no se sincronizo`);
  }
  map.set(simId, publicId);
}

async function syncMasters(
  catalog: SimCatalog,
  http: FhirHttp,
  token: string,
  tenantId: string,
): Promise<Counts> {
  const counts: Counts = { written: 0, retryLater: 0 };
  const practitioners = new Map<string, string>();
  const services = new Map<string, string>();
  const schedules = new Map<string, string>();
  for (const row of await catalog.practitioners(tenantId)) {
    remember(
      practitioners,
      row.id,
      await writeMaster(http, token, "Practitioner", row, practitionerBody(row), counts),
      "Practitioner",
    );
  }
  for (const row of await catalog.services(tenantId)) {
    remember(
      services,
      row.id,
      await writeMaster(http, token, "HealthcareService", row, serviceBody(row), counts),
      "HealthcareService",
    );
  }
  for (const row of await catalog.patients(tenantId)) {
    if (row.status === "active") {
      await writeMaster(http, token, "Patient", row, patientBody(row), counts);
    }
  }
  for (const row of await catalog.schedules(tenantId)) {
    const body = scheduleBody(
      row,
      requiredMapped(practitioners, row.practitionerId),
      requiredMapped(services, row.healthcareServiceId),
    );
    remember(
      schedules,
      row.id,
      await writeMaster(http, token, "Schedule", row, body, counts),
      "Schedule",
    );
  }
  for (const row of await catalog.slots(tenantId)) {
    await writeMaster(
      http,
      token,
      "Slot",
      row,
      slotBody(row, requiredMapped(schedules, row.scheduleId)),
      counts,
    );
  }
  return counts;
}

function requiredMapped(map: Map<string, string>, id: string): string {
  const found = map.get(id);
  if (!found) {
    throw new Error(`Falta el id publico de ${id}`);
  }
  return found;
}

async function closePreAgenda(deps: SyncDeps, tenantId: string): Promise<number> {
  const pending: InboxRequest[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_CAP; page++) {
    const batch = await deps.chatbot.listPending({ tenantId, cursor, limit: 50 });
    pending.push(...batch.data);
    if (!batch.nextCursor) {
      break;
    }
    cursor = batch.nextCursor;
    if (page === PAGE_CAP - 1) {
      throw new Error("La bandeja no termino");
    }
  }
  for (const request of pending) {
    await deps.approve({ tenantId, requestId: request.id, actor: HERMES_ACTOR });
  }
  return pending.length;
}

function documentIdentifier(record: Record<string, unknown>): FhirId {
  const document = readIdentifiers(record.identifier).find((item) => isDocumentSystem(item.system));
  if (!document) {
    throw new Error("Pre-registro sin documento");
  }
  return document;
}

function businessFor(record: Record<string, unknown>, patients: readonly SimPatient[]): FhirId {
  const document = documentIdentifier(record);
  const code = document.system.slice(DOCUMENT_SYSTEM_PREFIX.length);
  const match = patients.find(
    (row) => row.documentType === code && row.documentNumber === document.value,
  );
  if (match) {
    return { system: match.identifierSystem, value: match.identifierValue };
  }
  return { system: HERMES_PATIENT_SYSTEM, value: `PR-${code}-${document.value}` };
}

function patientName(record: Record<string, unknown>): { family: string; given: unknown[] } {
  const names = record.name;
  if (!Array.isArray(names) || names[0] === undefined) {
    throw new Error("Patient.name es obligatorio");
  }
  const name = asRecord(names[0], "name");
  const given = name.given;
  if (!Array.isArray(given) || given.length === 0) {
    throw new Error("name.given es obligatorio");
  }
  return { family: requiredString(name, "family"), given };
}

function confirmBody(record: Record<string, unknown>, business: FhirId): unknown {
  const name = patientName(record);
  const telecom = record.telecom;
  return {
    resourceType: "Patient",
    identifier: [business, documentIdentifier(record)],
    active: true,
    name: [{ family: name.family, given: name.given }],
    birthDate: requiredString(record, "birthDate"),
    ...(Array.isArray(telecom) && telecom.length > 0 ? { telecom } : {}),
  };
}

async function confirmPatients(
  catalog: SimCatalog,
  http: FhirHttp,
  token: string,
  tenantId: string,
): Promise<number> {
  const tag = encodeURIComponent(`${PRE_REGISTERED_TAG.system}|${PRE_REGISTERED_TAG.code}`);
  const rows = await searchAll(http, token, `Patient?_tag=${tag}`);
  const patients = await catalog.patients(tenantId);
  for (const record of rows) {
    const business = businessFor(record, patients);
    const body = confirmBody(record, business);
    await writeMaster(
      http,
      token,
      "Patient",
      { identifierSystem: business.system, identifierValue: business.value },
      body,
      { written: 0, retryLater: 0 },
    );
  }
  return rows.length;
}

/** Sincroniza maestros, cierra la pre-agenda y confirma pre-registros de un tenant. */
export function createHermesSync(deps: SyncDeps) {
  return async (tenantId: string): Promise<HermesSyncReport> => {
    const token = await deps.tokens.issue(tenantId);
    const masters = await syncMasters(deps.catalog, deps.http, token, tenantId);
    const resolved = await closePreAgenda(deps, tenantId);
    const confirmed = await confirmPatients(deps.catalog, deps.http, token, tenantId);
    return { written: masters.written, retryLater: masters.retryLater, resolved, confirmed };
  };
}

/** Solo maestros. La suite lo usa para ver un `409` sin resolver la pre-agenda. */
export function createSyncMasters(deps: Pick<SyncDeps, "catalog" | "http" | "tokens">) {
  return async (tenantId: string): Promise<Counts> => {
    const token = await deps.tokens.issue(tenantId);
    return syncMasters(deps.catalog, deps.http, token, tenantId);
  };
}
