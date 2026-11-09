import type { Fragment, PostmanItem } from "../items";
import { expectStatus, PREFIX, step } from "./request";

/**
 * CRUD del simulador (spec 5.3 §4.4.1): crea profesional, servicio y agenda con el prefijo
 * `newman-`, los lee y los borra en orden inverso. `slots:generate` se ejercita con una franja
 * que no produce cupos: una agenda con cupos ya no se puede borrar (`409`).
 */
export const SIM_CRUD = "sim — CRUD";

const ADMIN = { user: "admin_a" } as const;
const BASE = "/api/sim/v1";

type Resource = { name: string; collection: string; variable: string; body: unknown };

const RESOURCES: readonly Resource[] = [
  {
    name: "profesional",
    collection: "practitioners",
    variable: "sim_practitioner_id",
    body: { identifier_value: `${PREFIX}P-{{$guid}}`, name: `${PREFIX}Profesional` },
  },
  {
    name: "servicio",
    collection: "healthcare-services",
    variable: "sim_service_id",
    body: { identifier_value: `${PREFIX}S-{{$guid}}`, name: `${PREFIX}Servicio` },
  },
  {
    name: "agenda",
    collection: "schedules",
    variable: "sim_schedule_id",
    body: {
      identifier_value: `${PREFIX}SCH-{{$guid}}`,
      practitioner_id: "{{sim_practitioner_id}}",
      healthcare_service_id: "{{sim_service_id}}",
    },
  },
];

function create(resource: Resource): PostmanItem {
  return step({
    folder: SIM_CRUD,
    name: `crear ${resource.name}`,
    method: "POST",
    path: `${BASE}/${resource.collection}`,
    auth: ADMIN,
    body: resource.body,
    test: [
      ...expectStatus(200),
      `pm.collectionVariables.set("${resource.variable}", pm.response.json().id);`,
    ],
  });
}

function readOne(resource: Resource): PostmanItem {
  return step({
    folder: SIM_CRUD,
    name: `leer ${resource.name}`,
    method: "GET",
    path: `${BASE}/${resource.collection}/{{${resource.variable}}}`,
    auth: ADMIN,
    test: expectStatus(200),
  });
}

function remove(resource: Resource): PostmanItem {
  return step({
    folder: SIM_CRUD,
    name: `borrar ${resource.name}`,
    method: "DELETE",
    path: `${BASE}/${resource.collection}/{{${resource.variable}}}`,
    auth: ADMIN,
    test: expectStatus(200),
  });
}

const generateWithoutSlots = step({
  folder: SIM_CRUD,
  name: "slots:generate sin cupos (franja de otro dia)",
  method: "POST",
  path: `${BASE}/schedules/{{sim_schedule_id}}/slots/generate`,
  auth: ADMIN,
  body: "{{generate_body}}",
  prerequest: [
    "var day = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);",
    'var weekday = new Date(day + "T12:00:00.000Z").getUTCDay();',
    'pm.variables.set("generate_body", JSON.stringify({',
    "  from: day, to: day, duration_minutes: 30,",
    '  windows: [{ weekday: (weekday + 1) % 7, start_time: "08:00", end_time: "09:00" }],',
    "}));",
  ],
  test: [
    ...expectStatus(200),
    'pm.test("no crea cupos", function () { pm.expect(pm.response.json().created).to.equal(0); });',
  ],
});

export const simCrudFragment: Fragment = {
  name: SIM_CRUD,
  item: [
    ...RESOURCES.map(create),
    generateWithoutSlots,
    ...RESOURCES.map(readOne),
    ...[...RESOURCES].reverse().map(remove),
  ],
};
