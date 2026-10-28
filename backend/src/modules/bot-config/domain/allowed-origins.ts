import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

/** Fuera de produccion se admite localhost para probar el widget en local. */
export type OriginPolicy = { readonly allowLocalhost: boolean };

export const MAX_ALLOWED_ORIGINS = 20;

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const PORT = String.raw`(?::\d{1,5})?`;
const HTTPS_ORIGIN = new RegExp(String.raw`^https://${LABEL}(?:\.${LABEL})*${PORT}$`);
const LOCALHOST_ORIGIN = new RegExp(`^http://localhost${PORT}$`);

/** Valida y normaliza (minusculas, sin duplicados) la lista de origenes del widget. */
export function validateAllowedOrigins(raw: unknown, policy: OriginPolicy): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("allowed_origins debe ser una lista", { field: "allowed_origins" });
  }
  if (raw.length > MAX_ALLOWED_ORIGINS) {
    throw new ValidationError(`allowed_origins admite como maximo ${MAX_ALLOWED_ORIGINS}`, {
      field: "allowed_origins",
      max: MAX_ALLOWED_ORIGINS,
    });
  }
  const origins = raw.map((value, index) =>
    validateOrigin(value, `allowed_origins.${index}`, policy),
  );
  return [...new Set(origins)];
}

function validateOrigin(value: unknown, field: string, policy: OriginPolicy): string {
  const origin = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (HTTPS_ORIGIN.test(origin) || (policy.allowLocalhost && LOCALHOST_ORIGIN.test(origin))) {
    return origin;
  }
  throw new ValidationError(`${field} no es un origen valido (https://host[:puerto])`, { field });
}

/** Agrega un origen a la lista; si ya esta, la lista no cambia. */
export function addOrigin(
  current: readonly string[],
  raw: unknown,
  policy: OriginPolicy,
): string[] {
  const origin = validateOrigin(raw, "origin", policy);
  if (current.includes(origin)) {
    return [...current];
  }
  return validateAllowedOrigins([...current, origin], policy);
}

/** Quita un origen; si no esta en la lista es un recurso inexistente. */
export function removeOrigin(current: readonly string[], raw: unknown): string[] {
  const origin = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!current.includes(origin)) {
    throw new NotFoundError();
  }
  return current.filter((value) => value !== origin);
}

/** Decodifica el origen de la ruta; un escape mal formado es 422, no 500. */
export function decodeOriginParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ValidationError("origin no es un origen valido", { field: "origin" });
  }
}
