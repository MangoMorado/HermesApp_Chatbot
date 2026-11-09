import { randomUUID } from "node:crypto";
import { call } from "./invoke";
import type { ContractCase, HttpMethod, Surface } from "./types";
import type { ContractWorld } from "./world";

/** Partes variables de una peticion; el resto (superficie, metodo, plantilla) es de la operacion. */
export type Req = {
  readonly path: string;
  readonly query?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly rawBody?: string;
};

type Build = (world: ContractWorld) => Req | Promise<Req>;
type TokenOf = (world: ContractWorld) => string | null;

/**
 * Especificacion de una operacion para `contrato-rutas`. De ella salen los casos comunes:
 * camino feliz, `401` sin token, `403` con un rol no admitido, `404` con un recurso de la otra
 * clinica, `422` con una peticion invalida y, en escrituras idempotentes, `422` sin
 * `Idempotency-Key` y `409` con una clave ya usada por otra peticion del mismo tenant.
 */
export type OpSpec = {
  readonly surface: Surface;
  readonly method: HttpMethod;
  readonly template: string;
  readonly token: TokenOf;
  /** Operacion publica: sin casos automaticos de 401/403 (los declara en `extra`). */
  readonly public?: boolean;
  readonly ok: Build;
  readonly okStatus?: number;
  readonly forbiddenToken?: TokenOf;
  readonly notFound?: Build;
  readonly invalid?: Build;
  /** Escritura con `Idempotency-Key`: anade la clave y los casos 409/422 de idempotencia. */
  readonly write?: boolean;
  /** Primer escritura del mismo ambito con la clave dada (por defecto, ajustes de la clinica A). */
  readonly primer?: (world: ContractWorld, key: string) => Promise<void>;
  readonly extra?: readonly ContractCase[];
};

/** Reserva la clave con una escritura valida del tenant del token (PATCH /tenant-settings). */
export function tenantPrimerWith(tokenOf: TokenOf) {
  return async (world: ContractWorld, key: string): Promise<void> => {
    const response = await call({
      surface: "chatbot",
      method: "patch",
      template: "/tenant-settings",
      path: "/tenant-settings",
      token: tokenOf(world),
      headers: { "Idempotency-Key": key },
      body: { max_query_range_days: 31 },
    });
    if (response.status !== 200) {
      throw new Error(`primer de idempotencia: ${response.status} ${await response.text()}`);
    }
  };
}

export const tenantPrimer = tenantPrimerWith((w) => w.tokens.adminA);

function send(spec: OpSpec, req: Req, token: string | null, key: string | null): Promise<Response> {
  const headers = { ...req.headers };
  // Una clave fijada por la propia peticion (p. ej. una demasiado corta) se respeta.
  if (key !== null && headers["Idempotency-Key"] === undefined) {
    headers["Idempotency-Key"] = key;
  }
  return call({
    surface: spec.surface,
    method: spec.method,
    template: spec.template,
    ...req,
    headers,
    token,
  });
}

function keyFor(spec: OpSpec): string | null {
  return spec.write ? randomUUID() : null;
}

function caseOf(
  spec: OpSpec,
  status: number,
  name: string,
  run: ContractCase["run"],
): ContractCase {
  return { surface: spec.surface, method: spec.method, path: spec.template, status, name, run };
}

function authCases(spec: OpSpec): ContractCase[] {
  const cases = [
    caseOf(spec, 401, "sin token", async (w) => send(spec, await spec.ok(w), null, keyFor(spec))),
  ];
  const forbidden = spec.forbiddenToken;
  if (forbidden) {
    cases.push(
      caseOf(spec, 403, "rol no admitido", async (w) =>
        send(spec, await spec.ok(w), forbidden(w), keyFor(spec)),
      ),
    );
  }
  return cases;
}

function idempotencyCases(spec: OpSpec): ContractCase[] {
  const primer = spec.primer ?? tenantPrimer;
  return [
    caseOf(spec, 409, "Idempotency-Key reutilizada", async (w) => {
      const key = randomUUID();
      await primer(w, key);
      return send(spec, await spec.ok(w), spec.token(w), key);
    }),
  ];
}

function invalidCase(spec: OpSpec): ContractCase | null {
  const invalid = spec.invalid;
  if (invalid) {
    return caseOf(spec, 422, "peticion invalida", async (w) =>
      send(spec, await invalid(w), spec.token(w), keyFor(spec)),
    );
  }
  if (spec.write) {
    return caseOf(spec, 422, "sin Idempotency-Key", async (w) =>
      send(spec, await spec.ok(w), spec.token(w), null),
    );
  }
  return null;
}

export function casesFor(spec: OpSpec): ContractCase[] {
  const cases = [
    caseOf(spec, spec.okStatus ?? 200, "camino feliz", async (w) =>
      send(spec, await spec.ok(w), spec.token(w), keyFor(spec)),
    ),
  ];
  if (!spec.public) {
    cases.push(...authCases(spec));
  }
  const notFound = spec.notFound;
  if (notFound) {
    cases.push(
      caseOf(spec, 404, "recurso de la otra clinica", async (w) =>
        send(spec, await notFound(w), spec.token(w), keyFor(spec)),
      ),
    );
  }
  const invalid = invalidCase(spec);
  if (invalid) {
    cases.push(invalid);
  }
  if (spec.write) {
    cases.push(...idempotencyCases(spec));
  }
  return [...cases, ...(spec.extra ?? [])];
}
