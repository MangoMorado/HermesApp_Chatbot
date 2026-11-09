import type { Fragment, PostmanItem } from "../items";
import { expectFhirStatus, step } from "./request";

/**
 * `PUT` condicional de maestros sembrados con sus mismos valores (spec 5.3 §4.4.1): lee uno de
 * cada tipo, lo reescribe y comprueba que releido es igual. Ningun `Patient` (no tiene baja) y
 * ningun cambio de estado de un `Slot`.
 */
export const FHIR_MASTERS = "fhir — maestros";

type Master = { type: string; search: string; fields: readonly string[] };

const MASTERS: readonly Master[] = [
  { type: "Practitioner", search: "_count=1", fields: ["active", "name"] },
  { type: "HealthcareService", search: "_count=1", fields: ["active", "name"] },
  { type: "Schedule", search: "_count=1", fields: ["active", "actor"] },
  { type: "Slot", search: "status=free&_count=1", fields: ["schedule", "status", "start", "end"] },
];

const SERVICE = { client: "service_a" } as const;

function pickScript(master: Master): string[] {
  return [
    `var fields = ${JSON.stringify(master.fields)};`,
    "function significant(r) {",
    "  var out = { resourceType: r.resourceType };",
    '  out.identifier = (r.identifier || []).filter(function (i) { return (i.system || "").indexOf("urn:hermes:") === 0; });',
    "  fields.forEach(function (f) { if (r[f] !== undefined) { out[f] = r[f]; } });",
    "  return out;",
    "}",
  ];
}

function read(master: Master): PostmanItem {
  return step({
    folder: FHIR_MASTERS,
    name: `${master.type}: leer uno sembrado`,
    method: "GET",
    path: `/fhir/${master.type}?${master.search}`,
    auth: SERVICE,
    test: [
      ...expectFhirStatus(200),
      "var entry = (pm.response.json().entry || [])[0];",
      `pm.test("hay un ${master.type} sembrado", function () { pm.expect(entry).to.be.an("object"); });`,
      ...pickScript(master),
      "if (entry) {",
      `  pm.collectionVariables.set("master_${master.type}", JSON.stringify(significant(entry.resource)));`,
      `  pm.collectionVariables.set("master_${master.type}_id", entry.resource.id);`,
      "}",
    ],
  });
}

function rewrite(master: Master): PostmanItem {
  return step({
    folder: FHIR_MASTERS,
    name: `${master.type}: PUT condicional con los mismos valores`,
    method: "PUT",
    path: `/fhir/${master.type}?identifier={{master_query}}`,
    auth: SERVICE,
    body: "{{master_body}}",
    prerequest: [
      `var body = pm.collectionVariables.get("master_${master.type}");`,
      "var hermes = JSON.parse(body).identifier[0];",
      'pm.variables.set("master_query", encodeURIComponent(hermes.system + "|" + hermes.value));',
      'pm.variables.set("master_body", body);',
    ],
    test: expectFhirStatus(200),
  });
}

function reread(master: Master): PostmanItem {
  return step({
    folder: FHIR_MASTERS,
    name: `${master.type}: releido es igual`,
    method: "GET",
    path: `/fhir/${master.type}/{{master_${master.type}_id}}`,
    auth: SERVICE,
    test: [
      ...expectFhirStatus(200),
      ...pickScript(master),
      `var before = JSON.parse(pm.collectionVariables.get("master_${master.type}"));`,
      'pm.test("nada cambio", function () {',
      "  pm.expect(significant(pm.response.json())).to.eql(before);",
      "});",
    ],
  });
}

export const fhirMastersFragment: Fragment = {
  name: FHIR_MASTERS,
  item: MASTERS.flatMap((master) => [read(master), rewrite(master), reread(master)]),
};
