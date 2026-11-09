import { randomUUID } from "node:crypto";
import { TEST_CLIENT_SECRET } from "../../helpers/idp";
import { call } from "./invoke";
import { casesFor, type OpSpec } from "./spec";
import type { ContractCase } from "./types";
import type { ContractWorld } from "./world";

/** Operaciones de /api/platform/v1: rol `platform`, sin tenant y con idempotencia propia. */

const platform = (w: ContractWorld) => w.tokens.platform;
const clinicAdmin = (w: ContractWorld) => w.tokens.adminA;

const uniqueSlug = () => `cr-${randomUUID().slice(0, 8)}`;

/** Reserva la clave en el ambito de plataforma con un alta valida. */
async function platformPrimer(world: ContractWorld, key: string): Promise<void> {
  const response = await call({
    surface: "platform",
    method: "post",
    template: "/tenants",
    path: "/tenants",
    token: world.tokens.platform,
    headers: { "Idempotency-Key": key },
    body: { slug: uniqueSlug(), name: "Primer" },
  });
  if (response.status !== 201) {
    throw new Error(`primer de plataforma: ${response.status} ${await response.text()}`);
  }
}

function op(method: OpSpec["method"], template: string, rest: Partial<OpSpec>): OpSpec {
  return {
    surface: "platform",
    method,
    template,
    token: platform,
    forbiddenToken: clinicAdmin,
    ok: () => ({ path: template }),
    ...rest,
  };
}

const SPECS: OpSpec[] = [
  op("get", "/me", {}),
  op("get", "/tenants", { invalid: () => ({ path: "/tenants", query: "limit=0" }) }),
  op("post", "/tenants", {
    write: true,
    okStatus: 201,
    primer: platformPrimer,
    ok: () => ({ path: "/tenants", body: { slug: uniqueSlug(), name: "Clinica contrato" } }),
    invalid: () => ({ path: "/tenants", body: { slug: "No Valido", name: "x" } }),
  }),
  op("put", "/tenants/{id}/widget-client", {
    write: true,
    primer: platformPrimer,
    // Reescribe la misma credencial del proveedor falso: el widget de A sigue funcionando.
    ok: (w) => ({
      path: `/tenants/${w.tenantA.tenantId}/widget-client`,
      body: { client_id: `widget-${w.tenantA.tenantId}`, client_secret: TEST_CLIENT_SECRET },
    }),
    notFound: () => ({
      path: "/tenants/tenant-inexistente/widget-client",
      body: { client_id: "widget-x", client_secret: "s" },
    }),
    invalid: (w) => ({
      path: `/tenants/${w.tenantA.tenantId}/widget-client`,
      body: { client_id: "" },
    }),
  }),
];

export const PLATFORM_CASES: readonly ContractCase[] = SPECS.flatMap(casesFor);
