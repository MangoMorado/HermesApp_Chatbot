import { ValidationError } from "./validation-error";

/**
 * Tenant de una operacion. Solo se construye a partir del claim del token; el tipo
 * marcado impide pasar por error un string cualquiera donde se espera un tenant.
 */
export type TenantId = string & { readonly __brand: "TenantId" };

export function toTenantId(value: string): TenantId {
  if (value.trim() === "") {
    throw new ValidationError("tenant_id vacio");
  }
  return value as TenantId;
}
