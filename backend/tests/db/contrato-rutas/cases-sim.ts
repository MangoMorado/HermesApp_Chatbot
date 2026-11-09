import { randomUUID } from "node:crypto";
import { call } from "./invoke";
import { pendingRequest, type SimSide, simWorld } from "./sim-world";
import { casesFor, type OpSpec, type Req, tenantPrimerWith } from "./spec";
import type { ContractCase } from "./types";
import type { ContractWorld } from "./world";

/** Las 24 operaciones de /api/sim/v1: todas exigen `admin` de la clinica. */

const admin = (w: ContractWorld) => simWorld(w).simA.admin;
const operator = (w: ContractWorld) => simWorld(w).simOperatorA;
const primer = tenantPrimerWith(admin);
const a = (w: ContractWorld) => simWorld(w).simA;
const b = (w: ContractWorld) => simWorld(w).simB;
const unique = () => randomUUID().slice(0, 8);

type Resource = {
  readonly collection: string;
  readonly suffix: string;
  readonly create: (side: SimSide) => Record<string, unknown>;
  readonly patch: Record<string, unknown>;
  /** Alta que nombra un recurso de la otra clinica (404), si la operacion tiene referencias. */
  readonly foreignReference?: boolean;
};

const RESOURCES: readonly Resource[] = [
  {
    collection: "/practitioners",
    suffix: "prac",
    create: () => ({ identifier_value: `P-${unique()}`, name: "Prof contrato" }),
    patch: { name: "Prof renombrado" },
  },
  {
    collection: "/healthcare-services",
    suffix: "svc",
    create: () => ({ identifier_value: `S-${unique()}`, name: "Servicio contrato" }),
    patch: { name: "Servicio renombrado" },
  },
  {
    collection: "/schedules",
    suffix: "sched",
    create: (side) => ({
      identifier_value: `SCH-${unique()}`,
      practitioner_id: `${side.sim}-prac`,
      healthcare_service_id: `${side.sim}-svc`,
    }),
    patch: { active: true },
    foreignReference: true,
  },
  {
    collection: "/patients",
    suffix: "pat",
    create: () => ({
      identifier_value: `MR-${unique()}`,
      document_type: "CC",
      document_number: `9${randomUUID().replace(/\D/g, "")}`.slice(0, 10),
      given_names: "Paciente",
      family_names: "Contrato",
      birth_date: "1990-01-01",
    }),
    patch: { given_names: "Paciente renombrado" },
  },
];

/** Crea un recurso por la API (lo que luego se borra) y devuelve su id. */
async function created(w: ContractWorld, resource: Resource): Promise<string> {
  const response = await call({
    surface: "sim",
    method: "post",
    template: resource.collection,
    path: resource.collection,
    token: admin(w),
    headers: { "Idempotency-Key": randomUUID() },
    body: resource.create(a(w)),
  });
  const body = (await response.json()) as { id?: string };
  if (response.status !== 200 || !body.id) {
    throw new Error(`alta ${resource.collection}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.id;
}

function base(method: OpSpec["method"], template: string, rest: Partial<OpSpec>): OpSpec {
  return {
    surface: "sim",
    method,
    template,
    token: admin,
    forbiddenToken: operator,
    primer,
    ok: () => ({ path: template }),
    ...rest,
  };
}

function crud(resource: Resource): OpSpec[] {
  const { collection, suffix } = resource;
  const item = `${collection}/{id}`;
  const own = (w: ContractWorld): Req => ({ path: `${collection}/${a(w).sim}-${suffix}` });
  const foreign = (w: ContractWorld): Req => ({ path: `${collection}/${b(w).sim}-${suffix}` });
  return [
    base("get", collection, { invalid: () => ({ path: collection, query: "limit=0" }) }),
    base("post", collection, {
      write: true,
      ok: (w) => ({ path: collection, body: resource.create(a(w)) }),
      invalid: () => ({ path: collection, body: {} }),
      ...(resource.foreignReference
        ? { notFound: (w: ContractWorld) => ({ path: collection, body: resource.create(b(w)) }) }
        : {}),
    }),
    base("get", item, { ok: own, notFound: foreign }),
    base("patch", item, {
      write: true,
      ok: (w) => ({ ...own(w), body: resource.patch }),
      notFound: (w) => ({ ...foreign(w), body: resource.patch }),
      invalid: (w) => ({ ...own(w), body: [] }),
    }),
    base("delete", item, {
      write: true,
      ok: async (w) => ({ path: `${collection}/${await created(w, resource)}` }),
      notFound: foreign,
    }),
  ];
}

const GENERATE_BODY = {
  from: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  to: new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10),
  duration_minutes: 30,
  windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    start_time: "08:00",
    end_time: "09:00",
  })),
};

const GENERATE = base("post", "/schedules/{id}/slots/generate", {
  write: true,
  ok: (w) => ({ path: `/schedules/${a(w).sim}-sched/slots/generate`, body: GENERATE_BODY }),
  notFound: (w) => ({ path: `/schedules/${b(w).sim}-sched/slots/generate`, body: GENERATE_BODY }),
  invalid: (w) => ({ path: `/schedules/${a(w).sim}-sched/slots/generate`, body: {} }),
});

function decision(action: "approve" | "reject"): OpSpec {
  return base("post", `/inbox/{id}/${action}`, {
    write: true,
    ok: async (w) => ({ path: `/inbox/${await pendingRequest(w.prisma, a(w))}/${action}` }),
    notFound: async (w) => ({
      path: `/inbox/${await pendingRequest(w.prisma, b(w))}/${action}`,
    }),
  });
}

const INBOX: OpSpec[] = [
  base("get", "/inbox", { invalid: () => ({ path: "/inbox", query: "limit=0" }) }),
  decision("approve"),
  decision("reject"),
];

export const SIM_CASES: readonly ContractCase[] = [
  ...RESOURCES.flatMap(crud),
  GENERATE,
  ...INBOX,
].flatMap(casesFor);
