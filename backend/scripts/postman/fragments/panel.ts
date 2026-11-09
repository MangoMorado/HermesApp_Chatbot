import type { Fragment, PostmanItem } from "../items";
import { expectStatus, PREFIX, type StepSpec, step } from "./request";
import { seedPatient } from "./seed-patients";

/**
 * Panel de la clinica A (spec 5.3 §4.4): conocimiento, configuracion del bot y origenes (todo se
 * deshace en la misma carpeta), ajustes, agenda y busqueda de expediente. `operator` lee; una
 * escritura suya da `403`.
 */
export const PANEL = "panel — clinica A";

const ADMIN = { user: "admin_a" } as const;
const OPERATOR = { user: "operator_a" } as const;
const ORIGIN = "https://newman.invalid";
const TEXT_KEY = "menu_prompt";

const panelStep = (spec: Omit<StepSpec, "folder">): PostmanItem => step({ folder: PANEL, ...spec });

const RANGE = [
  "var today = new Date();",
  'pm.variables.set("range_from", today.toISOString().slice(0, 10));',
  'pm.variables.set("range_to", new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10));',
];

const knowledge: PostmanItem[] = [
  panelStep({
    name: "conocimiento: crear",
    method: "POST",
    path: "/api/v1/knowledge-entries",
    auth: ADMIN,
    body: {
      category: `${PREFIX}Contrato`,
      question: `${PREFIX}¿Hay parqueadero?`,
      answer: `${PREFIX}Sí, gratuito.`,
    },
    test: [
      ...expectStatus(201),
      'pm.collectionVariables.set("knowledge_id", pm.response.json().id);',
    ],
  }),
  panelStep({
    name: "conocimiento: operator lee",
    method: "GET",
    path: "/api/v1/knowledge-entries/{{knowledge_id}}",
    auth: OPERATOR,
    test: expectStatus(200),
  }),
  panelStep({
    name: "conocimiento: operator no escribe (403)",
    method: "PATCH",
    path: "/api/v1/knowledge-entries/{{knowledge_id}}",
    auth: OPERATOR,
    body: { answer: `${PREFIX}No deberia escribirse.` },
    test: expectStatus(403),
  }),
  panelStep({
    name: "conocimiento: editar",
    method: "PATCH",
    path: "/api/v1/knowledge-entries/{{knowledge_id}}",
    auth: ADMIN,
    body: { answer: `${PREFIX}Sí, gratuito y cubierto.` },
    test: expectStatus(200),
  }),
  panelStep({
    name: "conocimiento: borrar",
    method: "DELETE",
    path: "/api/v1/knowledge-entries/{{knowledge_id}}",
    auth: ADMIN,
    test: expectStatus(200),
  }),
];

const botConfig: PostmanItem[] = [
  panelStep({
    name: "bot-config: leer antes de cambiar",
    method: "GET",
    path: "/api/v1/bot-config",
    auth: ADMIN,
    test: [
      ...expectStatus(200),
      `var text = pm.response.json().texts[${JSON.stringify(TEXT_KEY)}];`,
      `pm.collectionVariables.set("bot_config_a_before", JSON.stringify({ texts: { ${TEXT_KEY}: text.overridden ? text.value : null } }));`,
    ],
  }),
  panelStep({
    name: "bot-config: cambiar un texto",
    method: "PATCH",
    path: "/api/v1/bot-config",
    auth: ADMIN,
    body: { texts: { [TEXT_KEY]: `${PREFIX}Elige una opción.` } },
    test: expectStatus(200),
  }),
  panelStep({
    name: "bot-config: restaurar el texto",
    method: "PATCH",
    path: "/api/v1/bot-config",
    auth: ADMIN,
    body: "{{bot_config_a_before}}",
    test: expectStatus(200),
  }),
  panelStep({
    name: "origenes: anadir",
    method: "POST",
    path: "/api/v1/bot-config/allowed-origins",
    auth: ADMIN,
    body: { origin: ORIGIN },
    test: expectStatus(200),
  }),
  panelStep({
    name: "origenes: quitar",
    method: "DELETE",
    path: `/api/v1/bot-config/allowed-origins/${encodeURIComponent(ORIGIN)}`,
    auth: ADMIN,
    test: expectStatus(200),
  }),
];

const read = (name: string, path: string, extra: Partial<StepSpec> = {}): PostmanItem =>
  panelStep({ name, method: "GET", path, auth: OPERATOR, test: expectStatus(200), ...extra });

const agenda: PostmanItem[] = [
  read("ajustes de la clinica", "/api/v1/tenant-settings"),
  read("profesionales", "/api/v1/practitioners"),
  read("servicios", "/api/v1/healthcare-services"),
  read("agendas", "/api/v1/schedules", {
    test: [
      ...expectStatus(200),
      'pm.collectionVariables.set("panel_schedule_id", pm.response.json().data[0].id);',
    ],
  }),
  read(
    "cupos de una agenda",
    "/api/v1/schedules/{{panel_schedule_id}}/slots?from={{range_from}}&to={{range_to}}",
    { prerequest: RANGE },
  ),
  read("disponibilidad", "/api/v1/availability?from={{range_from}}&to={{range_to}}", {
    prerequest: RANGE,
  }),
  read(
    "citas de una agenda",
    "/api/v1/appointments?schedule_id={{panel_schedule_id}}&from={{range_from}}&to={{range_to}}",
    { prerequest: RANGE },
  ),
  panelStep({
    name: "expediente por documento",
    method: "POST",
    path: "/api/v1/medical-records/search",
    auth: OPERATOR,
    idempotent: false,
    body: { document_type: "CC", document_number: seedPatient("a").documentNumber },
    test: expectStatus(200),
  }),
];

export const panelFragment: Fragment = {
  name: PANEL,
  item: [...knowledge, ...botConfig, ...agenda],
};
