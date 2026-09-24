import { ValidationError } from "./validation-error";

/** Ayudas para desempaquetar entradas sin tipo (cuerpos HTTP ya parseados). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${field} debe ser un objeto`, { field });
  }
  return value;
}

/** Texto obligatorio, recortado, de 1 a `max` caracteres. */
export function requiredText(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || text.length > max) {
    throw new ValidationError(`${field} debe tener entre 1 y ${max} caracteres`, { field, max });
  }
  return text;
}
