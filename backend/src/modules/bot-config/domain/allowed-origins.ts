import { ValidationError } from "@/modules/shared/domain/validation-error";

/** Fuera de produccion se admite localhost para probar el widget en local. */
export type OriginPolicy = { readonly allowLocalhost: boolean };

export const MAX_ALLOWED_ORIGINS = 20;

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const PORT = "(?::\\d{1,5})?";
const HTTPS_ORIGIN = new RegExp(`^https://${LABEL}(?:\\.${LABEL})*${PORT}$`);
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
  const origins = raw.map((value, index) => validateOrigin(value, index, policy));
  return [...new Set(origins)];
}

function validateOrigin(value: unknown, index: number, policy: OriginPolicy): string {
  const origin = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (HTTPS_ORIGIN.test(origin) || (policy.allowLocalhost && LOCALHOST_ORIGIN.test(origin))) {
    return origin;
  }
  const field = `allowed_origins.${index}`;
  throw new ValidationError(`${field} no es un origen valido (https://host[:puerto])`, { field });
}
