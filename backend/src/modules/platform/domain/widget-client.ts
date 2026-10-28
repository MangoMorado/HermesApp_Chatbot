import type { MachineCredential } from "@/modules/auth/domain/ports/machine-credentials";
import { asRecord } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const MAX_LENGTH = 200;

/**
 * Recorta espacios (un copiar-pegar los arrastra y el proveedor los rechazaria) y exige un
 * valor no vacio. Ni el valor ni su longitud viajan en el error: el secreto no sale en ningun
 * mensaje.
 */
function credentialPart(value: unknown, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "" || trimmed.length > MAX_LENGTH) {
    throw new ValidationError(`${field} debe tener entre 1 y ${MAX_LENGTH} caracteres`, {
      field,
      max: MAX_LENGTH,
    });
  }
  return trimmed;
}

/** Credenciales del cliente OIDC del widget de una clinica (`client_id` + `client_secret`). */
export function parseWidgetClient(raw: unknown): MachineCredential {
  const data = asRecord(raw, "body");
  return {
    clientId: credentialPart(data.client_id, "client_id"),
    clientSecret: credentialPart(data.client_secret, "client_secret"),
  };
}
