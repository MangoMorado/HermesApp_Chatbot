import type { Fragment, PostmanItem } from "../items";
import type { Letter } from "./chat";
import { CLEANUP_ENTRY, PREFIX, step } from "./request";

/**
 * Limpieza final (spec 5.3 §4.4), por si un paso fallo a medias: rechaza las solicitudes que
 * siguen propuestas, completa las cancelaciones pendientes, rechaza en la bandeja las del
 * pre-registro, borra el conocimiento `newman-`, restaura el texto del bot y el origen, y
 * compara los cupos libres con `setup`. Sus pasos nunca saltan: siempre llegan al final.
 */
export const CLEANUP = "cleanup";

const service = (letter: Letter) =>
  ({ client: letter === "a" ? "service_a" : "service_b" }) as const;
const admin = (letter: Letter) => ({ user: letter === "a" ? "admin_a" : "admin_b" }) as const;

/** Envia una escritura por cada elemento con el token de esta peticion. */
const SEND_EACH = `function sendEach(items, method, urlOf, body, contentType) {
  items.forEach(function (item) {
    pm.sendRequest({
      url: pm.variables.get("base_url") + urlOf(item),
      method: method,
      header: {
        Authorization: "Bearer " + pm.variables.get("access_token"),
        "Idempotency-Key": pm.variables.replaceIn("{{$guid}}"),
        "Content-Type": contentType,
      },
      body: body === null ? undefined : { mode: "raw", raw: JSON.stringify(body) },
    }, function (err, res) {
      pm.test(method + " " + urlOf(item), function () {
        pm.expect(err).to.equal(null);
        pm.expect(res.code).to.be.below(300);
      });
    });
  });
}`.split("\n");

function fhirSweep(letter: Letter, name: string, query: string, type: string, body: unknown) {
  return step({
    folder: CLEANUP,
    name,
    method: "GET",
    path: `/fhir/${type}?patient=Patient/{{patient_id_${letter}}}&${query}`,
    auth: service(letter),
    test: [
      ...SEND_EACH,
      "var entries = pm.response.code === 200 ? pm.response.json().entry || [] : [];",
      `sendEach(entries, "PUT", function (e) { return "/fhir/${type}/" + e.resource.id; }, ${JSON.stringify(body)}, "application/fhir+json");`,
    ],
  });
}

function inboxSweep(letter: Letter): PostmanItem {
  return step({
    folder: CLEANUP,
    name: `cleanup — bandeja ${letter.toUpperCase()}`,
    method: "GET",
    path: "/api/sim/v1/inbox?limit=200",
    auth: admin(letter),
    test: [
      ...SEND_EACH,
      "var data = pm.response.code === 200 ? pm.response.json().data : [];",
      "var ours = data.filter(function (r) {",
      '  return r.patient && r.patient.given_names === "Newman" && r.patient.family_names === "Prueba";',
      "});",
      'sendEach(ours, "POST", function (r) { return "/api/sim/v1/inbox/" + r.id + "/reject"; }, null, "application/json");',
    ],
  });
}

function freeSlotsAfter(letter: Letter): PostmanItem {
  return step({
    folder: CLEANUP,
    name: `cleanup — cupos libres ${letter.toUpperCase()} (despues)`,
    method: "GET",
    path: "/fhir/Slot?status=free&_count=1",
    auth: service(letter),
    test: [
      `var before = Number(pm.collectionVariables.get("free_slots_${letter}_before"));`,
      `pm.test("cupos libres de ${letter.toUpperCase()} iguales a setup (free_slots_${letter}_before)", function () {`,
      "  pm.expect(pm.response.json().total).to.equal(before);",
      "});",
    ],
  });
}

const knowledgeSweep = step({
  folder: CLEANUP,
  name: "cleanup — conocimiento newman- y configuracion A",
  method: "GET",
  path: "/api/v1/knowledge-entries?limit=200",
  auth: admin("a"),
  test: [
    ...SEND_EACH,
    "var data = pm.response.code === 200 ? pm.response.json().data : [];",
    `var ours = data.filter(function (e) { return e.question.indexOf(${JSON.stringify(PREFIX)}) === 0; });`,
    'sendEach(ours, "DELETE", function (e) { return "/api/v1/knowledge-entries/" + e.id; }, null, "application/json");',
  ],
});

const configSweep = step({
  folder: CLEANUP,
  name: "cleanup — texto del bot y origen A",
  method: "GET",
  path: "/api/v1/bot-config",
  auth: admin("a"),
  test: [
    ...SEND_EACH,
    "if (pm.response.code === 200) {",
    "  var json = pm.response.json();",
    `  if (json.texts.menu_prompt.value.indexOf(${JSON.stringify(PREFIX)}) === 0) {`,
    '    var before = pm.collectionVariables.get("bot_config_a_before") || \'{"texts":{"menu_prompt":null}}\';',
    '    sendEach([1], "PATCH", function () { return "/api/v1/bot-config"; }, JSON.parse(before), "application/json");',
    "  }",
    '  if (json.allowed_origins.indexOf("https://newman.invalid") >= 0) {',
    '    sendEach([1], "DELETE", function () { return "/api/v1/bot-config/allowed-origins/" + encodeURIComponent("https://newman.invalid"); }, null, "application/json");',
    "  }",
    "}",
  ],
});

function perClinic(letter: Letter): PostmanItem[] {
  const upper = letter.toUpperCase();
  return [
    fhirSweep(
      letter,
      letter === "a" ? CLEANUP_ENTRY : `cleanup — solicitudes propuestas ${upper}`,
      "status=proposed",
      "Appointment",
      { resourceType: "Appointment", status: "cancelled" },
    ),
    fhirSweep(letter, `cleanup — cancelaciones pendientes ${upper}`, "status=requested", "Task", {
      resourceType: "Task",
      status: "completed",
    }),
    inboxSweep(letter),
  ];
}

export const cleanupFragment: Fragment = {
  name: CLEANUP,
  item: [
    ...perClinic("a"),
    ...perClinic("b"),
    knowledgeSweep,
    configSweep,
    freeSlotsAfter("a"),
    freeSlotsAfter("b"),
  ],
};
