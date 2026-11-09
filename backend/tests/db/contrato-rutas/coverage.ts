import { declaredOperations, operationKey } from "./documents";
import { EXEMPTIONS } from "./exemptions";
import { CHECKED_STATUSES, type ContractCase, type Surface } from "./types";

function requiredStatuses(responses: Record<string, unknown>): number[] {
  const declared = Object.keys(responses).map(Number);
  const success = declared.filter((status) => status >= 200 && status < 300);
  const checked = declared.filter((status) =>
    (CHECKED_STATUSES as readonly number[]).includes(status),
  );
  return [...success, ...checked];
}

/**
 * Pares (operacion, status) sin caso ni exencion, y casos que apuntan a algo no declarado.
 * Vacio = la superficie esta cubierta.
 */
export function coverageGaps(surface: Surface, cases: readonly ContractCase[]): string[] {
  const operations = declaredOperations(surface);
  const covered = new Set(
    cases.map((c) => `${operationKey(c.surface, c.method, c.path)} ${c.status}`),
  );
  const missing = operations.flatMap((op) =>
    requiredStatuses(op.responses)
      .filter((status) => !covered.has(`${op.key} ${status}`))
      .filter((status) => !EXEMPTIONS[op.key]?.[status])
      .map((status) => `falta ${op.key} ${status}`),
  );
  const declared = new Set(
    operations.flatMap((op) => Object.keys(op.responses).map((status) => `${op.key} ${status}`)),
  );
  const stray = cases
    .filter((c) => c.surface === surface)
    .map((c) => `${operationKey(c.surface, c.method, c.path)} ${c.status}`)
    .filter((key) => !declared.has(key))
    .map((key) => `no declarado ${key}`);
  return [...missing, ...stray];
}
