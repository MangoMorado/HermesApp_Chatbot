import type { Fragment } from "../items";
import { expectStatus, PREFIX, step } from "./request";

/**
 * Plataforma (spec 5.3 §4.4.1): la clinica `newman-clinica` se da de alta una sola vez; las
 * ejecuciones siguientes reciben `409 conflict`. Queda una clinica de rastro, nunca una por vuelta.
 */
export const PLATFORM = "plataforma — clinica newman";
export const NEWMAN_SLUG = `${PREFIX}clinica`;

const CLIENT = { client: "platform" } as const;

export const platformFragment: Fragment = {
  name: PLATFORM,
  item: [
    step({
      folder: PLATFORM,
      name: "identidad de plataforma",
      method: "GET",
      path: "/api/platform/v1/me",
      auth: CLIENT,
      test: [
        ...expectStatus(200),
        'pm.test("rol platform", function () { pm.expect(pm.response.json().role).to.equal("platform"); });',
      ],
    }),
    step({
      folder: PLATFORM,
      name: "alta de newman-clinica (201 la primera vez, 409 despues)",
      method: "POST",
      path: "/api/platform/v1/tenants",
      auth: CLIENT,
      body: { slug: NEWMAN_SLUG, name: `${PREFIX}Clinica` },
      test: [
        ...expectStatus(201, 409),
        "if (pm.response.code === 409) {",
        '  pm.test("409 es conflict", function () {',
        '    pm.expect(pm.response.json().error.code).to.equal("conflict");',
        "  });",
        "}",
      ],
    }),
    step({
      folder: PLATFORM,
      name: "la lista de clinicas la incluye",
      method: "GET",
      path: "/api/platform/v1/tenants?limit=200",
      auth: CLIENT,
      test: [
        ...expectStatus(200),
        `pm.test("${NEWMAN_SLUG} existe", function () {`,
        "  var slugs = pm.response.json().data.map(function (t) { return t.slug; });",
        `  pm.expect(slugs).to.include(${JSON.stringify(NEWMAN_SLUG)});`,
        "});",
      ],
    }),
  ],
};
