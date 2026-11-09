import { call } from "./invoke";
import { casesFor, type OpSpec, tenantPrimerWith } from "./spec";
import type { ContractCase } from "./types";
import type { ContractWorld } from "./world";

/** Operaciones del panel (`operator`/`admin`) de /api/v1. */

const RANGE = "from=2026-06-15&to=2026-06-16";
const admin = (w: ContractWorld) => w.tokens.adminA;
const operator = (w: ContractWorld) => w.tokens.operatorA;
const widget = (w: ContractWorld) => w.widgetA.token;

function read(template: string, rest: Partial<OpSpec>): OpSpec {
  return {
    surface: "chatbot",
    method: "get",
    template,
    token: operator,
    forbiddenToken: widget,
    ok: () => ({ path: template }),
    ...rest,
  };
}

function adminWrite(method: OpSpec["method"], template: string, rest: Partial<OpSpec>): OpSpec {
  return {
    surface: "chatbot",
    method,
    template,
    token: admin,
    forbiddenToken: operator,
    write: true,
    ok: () => ({ path: template }),
    ...rest,
  };
}

async function botConfigPrimer(w: ContractWorld, key: string): Promise<void> {
  const response = await call({
    surface: "chatbot",
    method: "patch",
    template: "/bot-config",
    path: "/bot-config",
    token: w.tokens.adminA,
    headers: { "Idempotency-Key": key },
    body: { params: { widget_sessions_per_ip_per_minute: 100 } },
  });
  if (response.status !== 200) {
    throw new Error(`primer bot-config: ${response.status}`);
  }
}

const AGENDA: OpSpec[] = [
  read("/practitioners", { invalid: () => ({ path: "/practitioners", query: "limit=0" }) }),
  read("/healthcare-services", {
    invalid: () => ({ path: "/healthcare-services", query: "limit=0" }),
  }),
  read("/schedules", { invalid: () => ({ path: "/schedules", query: "limit=0" }) }),
  read("/availability", {
    ok: () => ({ path: "/availability", query: RANGE }),
    invalid: () => ({ path: "/availability" }),
  }),
  read("/schedules/{id}/slots", {
    ok: (w) => ({ path: `/schedules/${w.tenantA.scheduleId}/slots`, query: RANGE }),
    notFound: (w) => ({ path: `/schedules/${w.tenantB.scheduleId}/slots`, query: RANGE }),
    invalid: (w) => ({ path: `/schedules/${w.tenantA.scheduleId}/slots` }),
  }),
  read("/appointments", {
    ok: (w) => ({ path: "/appointments", query: `schedule_id=${w.tenantA.scheduleId}&${RANGE}` }),
    notFound: (w) => ({
      path: "/appointments",
      query: `schedule_id=${w.tenantB.scheduleId}&${RANGE}`,
    }),
    invalid: () => ({ path: "/appointments", query: RANGE }),
  }),
];

const RECORDS: OpSpec[] = [
  read("/medical-records/search", {
    method: "post",
    ok: (w) => ({
      path: "/medical-records/search",
      body: { document_type: "CC", document_number: w.tenantA.documentNumber },
    }),
    notFound: (w) => ({
      path: "/medical-records/search",
      body: { document_type: "CC", document_number: w.tenantB.documentNumber },
    }),
    invalid: () => ({ path: "/medical-records/search", body: { document_type: "XX" } }),
  }),
  read("/medical-records/{id}", {
    ok: (w) => ({ path: `/medical-records/${w.tenantA.medicalRecordId}` }),
    notFound: (w) => ({ path: `/medical-records/${w.tenantB.medicalRecordId}` }),
  }),
  read("/medical-records/{id}/appointments", {
    ok: (w) => ({ path: `/medical-records/${w.tenantA.medicalRecordId}/appointments` }),
    notFound: (w) => ({ path: `/medical-records/${w.tenantB.medicalRecordId}/appointments` }),
    invalid: (w) => ({
      path: `/medical-records/${w.tenantA.medicalRecordId}/appointments`,
      query: "limit=0",
    }),
  }),
];

const SETTINGS: OpSpec[] = [
  read("/tenant-settings", {}),
  adminWrite("patch", "/tenant-settings", {
    ok: () => ({ path: "/tenant-settings", body: { max_query_range_days: 31 } }),
    invalid: () => ({ path: "/tenant-settings", body: { max_query_range_days: 0 } }),
    // El primer comun es esta misma peticion (se repetiria): aqui la clave la usa bot-config.
    primer: botConfigPrimer,
  }),
  read("/bot-config", {}),
  adminWrite("patch", "/bot-config", {
    ok: () => ({
      path: "/bot-config",
      body: { params: { widget_sessions_per_ip_per_minute: 100 } },
    }),
    invalid: () => ({ path: "/bot-config", body: { nada: 1 } }),
  }),
  adminWrite("post", "/bot-config/widget-keys/rotate", {
    // En la clinica B: rotar la de A romperia las sesiones del widget del mundo.
    token: (w) => w.tokens.adminB,
    forbiddenToken: (w) => w.tokens.operatorA,
    primer: tenantPrimerWith((w) => w.tokens.adminB),
  }),
  adminWrite("post", "/bot-config/allowed-origins", {
    ok: () => ({ path: "/bot-config/allowed-origins", body: { origin: "https://nuevo.test" } }),
    invalid: () => ({ path: "/bot-config/allowed-origins", body: { origin: "ftp://x" } }),
  }),
  adminWrite("delete", "/bot-config/allowed-origins/{origin}", {
    ok: async (w) => {
      const origin = `https://borrar-${Date.now()}.test`;
      await w.prisma.botConfig.update({
        where: { tenantId: w.tenantA.tenantId },
        data: { allowedOrigins: { push: origin } },
      });
      return { path: `/bot-config/allowed-origins/${encodeURIComponent(origin)}` };
    },
    notFound: () => ({
      path: `/bot-config/allowed-origins/${encodeURIComponent("https://ausente.test")}`,
    }),
  }),
];

async function freshEntry(w: ContractWorld): Promise<string> {
  const id = `${w.tenantA.tenantId}-kb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await w.prisma.knowledgeEntry.create({
    data: { id, tenantId: w.tenantA.tenantId, category: "C", question: "Q", answer: "A" },
  });
  return id;
}

const ENTRY_INPUT = { category: "General", question: "¿Parqueadero?", answer: "Sí." };

const KNOWLEDGE: OpSpec[] = [
  read("/knowledge-entries", {
    invalid: () => ({ path: "/knowledge-entries", query: "limit=0" }),
  }),
  adminWrite("post", "/knowledge-entries", {
    okStatus: 201,
    ok: () => ({ path: "/knowledge-entries", body: ENTRY_INPUT }),
    invalid: () => ({ path: "/knowledge-entries", body: { category: "" } }),
  }),
  read("/knowledge-entries/{id}", {
    ok: (w) => ({ path: `/knowledge-entries/${w.tenantA.knowledgeEntryId}` }),
    notFound: (w) => ({ path: `/knowledge-entries/${w.tenantB.knowledgeEntryId}` }),
  }),
  adminWrite("patch", "/knowledge-entries/{id}", {
    ok: (w) => ({
      path: `/knowledge-entries/${w.tenantA.knowledgeEntryId}`,
      body: { answer: "De 7 a 19." },
    }),
    notFound: (w) => ({
      path: `/knowledge-entries/${w.tenantB.knowledgeEntryId}`,
      body: { answer: "x" },
    }),
    invalid: (w) => ({
      path: `/knowledge-entries/${w.tenantA.knowledgeEntryId}`,
      body: { answer: "" },
    }),
  }),
  adminWrite("delete", "/knowledge-entries/{id}", {
    ok: async (w) => ({ path: `/knowledge-entries/${await freshEntry(w)}` }),
    notFound: (w) => ({ path: `/knowledge-entries/${w.tenantB.knowledgeEntryId}` }),
  }),
];

export const CHATBOT_PANEL_CASES: readonly ContractCase[] = [
  ...AGENDA,
  ...RECORDS,
  ...SETTINGS,
  ...KNOWLEDGE,
].flatMap(casesFor);
