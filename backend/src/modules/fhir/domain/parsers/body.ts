import { fhirInvalid, fhirUnprocessable } from "../fhir-error";
import type { FhirIdentifier } from "../resources/types";

export function assertObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw fhirInvalid("El cuerpo debe ser un recurso JSON");
  }
  return body as Record<string, unknown>;
}

export function pickKnown(
  row: Record<string, unknown>,
  known: readonly string[],
  ignored: readonly string[],
): Record<string, unknown> {
  assertNoModifierExtension(row);
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (ignored.includes(key)) {
      continue;
    }
    if (!known.includes(key)) {
      throw fhirUnprocessable("structure", `Campo no soportado: ${key}`);
    }
    picked[key] = value;
  }
  return picked;
}

function assertNoModifierExtension(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (!Array.isArray(value) && Object.hasOwn(value, "modifierExtension")) {
    throw fhirUnprocessable("structure", "modifierExtension no esta soportado");
  }
  for (const child of Object.values(value)) {
    assertNoModifierExtension(child);
  }
}

export function requireResourceType(body: Record<string, unknown>, type: string): void {
  if (body.resourceType !== type) {
    throw fhirInvalid(`resourceType debe ser ${type}`);
  }
}

export function requireQueryIdentifier(
  identifiers: readonly FhirIdentifier[],
  query: FhirIdentifier,
): void {
  const found = identifiers.some(
    (item) => item.system === query.system && item.value === query.value,
  );
  if (!found) {
    throw fhirInvalid("El identifier de la query debe aparecer en el cuerpo");
  }
}

export function readIdentifierArray(value: unknown): FhirIdentifier[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw fhirUnprocessable("processing", "identifier es obligatorio");
  }
  return value.map((item, index) => readIdentifier(item, index));
}

function readIdentifier(item: unknown, index: number): FhirIdentifier {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw fhirUnprocessable("processing", `identifier[${index}] invalido`);
  }
  const row = pickKnown(
    item as Record<string, unknown>,
    ["system", "value"],
    ["use", "type", "period", "extension"],
  );
  if (
    typeof row.system !== "string" ||
    typeof row.value !== "string" ||
    !row.system ||
    !row.value
  ) {
    throw fhirUnprocessable("processing", `identifier[${index}] debe tener system y value`);
  }
  return { system: row.system, value: row.value };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw fhirUnprocessable("processing", `${field} es obligatorio`);
  }
  return value;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw fhirUnprocessable("processing", `${field} debe ser boolean`);
  }
  return value;
}

export function readSingleIdentifier(value: unknown, query: FhirIdentifier): FhirIdentifier {
  const identifiers = readIdentifierArray(value);
  if (identifiers.length !== 1) {
    throw fhirUnprocessable("processing", "identifier debe tener una sola entrada");
  }
  requireQueryIdentifier(identifiers, query);
  return identifiers[0] as FhirIdentifier;
}

export function readReference(value: unknown, type: string, field: string): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw fhirUnprocessable("processing", `${field} debe ser una referencia`);
  }
  const row = pickKnown(
    value as Record<string, unknown>,
    ["reference"],
    ["display", "type", "extension"],
  );
  const reference = requireString(row.reference, `${field}.reference`);
  const prefix = `${type}/`;
  if (!reference.startsWith(prefix) || reference.length === prefix.length) {
    throw fhirUnprocessable("processing", `${field}.reference debe ser ${type}/{id}`);
  }
  const id = reference.slice(prefix.length);
  if (id.includes("/")) {
    throw fhirUnprocessable("processing", `${field}.reference debe ser ${type}/{id}`);
  }
  return id;
}

export function readBodyId(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return requireString(value, "id");
}
