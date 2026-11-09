import type { Fragment, PostmanItem } from "../items";
import type { Letter } from "./chat";
import { expectFhirStatus, expectStatus, step } from "./request";
import { seedPatient } from "./seed-patients";

/**
 * Lee lo que el resto de recorridos necesita de cada clinica: clave y origen del widget, textos
 * del bot (rotulos y preguntas), el paciente sembrado y los cupos libres antes de empezar.
 */
export const SETUP = "setup";

function botConfig(letter: Letter): PostmanItem {
  return step({
    folder: SETUP,
    name: `bot-config ${letter.toUpperCase()}`,
    method: "GET",
    path: "/api/v1/bot-config",
    auth: { user: letter === "a" ? "admin_a" : "admin_b" },
    test: [
      ...expectStatus(200),
      "var json = pm.response.json();",
      "var texts = {};",
      "Object.keys(json.texts).forEach(function (k) { texts[k] = json.texts[k].value; });",
      `pm.collectionVariables.set("bot_texts_${letter}", JSON.stringify(texts));`,
      `pm.collectionVariables.set("widget_key_${letter}", json.widget_keys.current.key);`,
      `pm.collectionVariables.set("widget_origin_${letter}", json.allowed_origins[0]);`,
      'pm.test("la clinica tiene un origen permitido para el widget", function () {',
      "  pm.expect(json.allowed_origins.length).to.be.above(0);",
      "});",
    ],
  });
}

function freeSlots(letter: Letter): PostmanItem {
  return step({
    folder: SETUP,
    name: `cupos libres ${letter.toUpperCase()} (antes)`,
    method: "GET",
    path: "/fhir/Slot?status=free&_count=1",
    auth: { client: letter === "a" ? "service_a" : "service_b" },
    test: [
      ...expectFhirStatus(200),
      `pm.collectionVariables.set("free_slots_${letter}_before", String(pm.response.json().total));`,
    ],
  });
}

function patient(letter: Letter): PostmanItem {
  const { identifier } = seedPatient(letter);
  return step({
    folder: SETUP,
    name: `paciente sembrado ${letter.toUpperCase()}`,
    method: "GET",
    path: `/fhir/Patient?identifier=${encodeURIComponent(identifier)}`,
    auth: { client: letter === "a" ? "service_a" : "service_b" },
    test: [
      ...expectFhirStatus(200),
      "var entry = (pm.response.json().entry || [])[0];",
      'pm.test("el paciente sembrado existe (db:seed)", function () {',
      '  pm.expect(entry).to.be.an("object");',
      "});",
      `if (entry) { pm.collectionVariables.set("patient_id_${letter}", entry.resource.id); }`,
    ],
  });
}

export const setupFragment: Fragment = {
  name: SETUP,
  item: (["a", "b"] as const).flatMap((letter) => [
    botConfig(letter),
    freeSlots(letter),
    patient(letter),
  ]),
};
