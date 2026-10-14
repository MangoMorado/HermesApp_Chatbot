import { fhirInvalid, fhirNotSupported } from "../fhir-error";
import type { FhirIdentifier } from "../resources/types";

export function assertObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw fhirInvalid("El cuerpo debe ser un recurso JSON");
  }
  return body as Record<string, unknown>;
}

export function assertNoExtraKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw fhirNotSupported(`Campo no soportado: ${key}`);
    }
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
    throw fhirInvalid("identifier es obligatorio");
  }
  return value.map((item, index) => readIdentifier(item, index));
}

function readIdentifier(item: unknown, index: number): FhirIdentifier {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw fhirInvalid(`identifier[${index}] invalido`);
  }
  const row = item as Record<string, unknown>;
  assertNoExtraKeys(row, ["system", "value"]);
  if (
    typeof row.system !== "string" ||
    typeof row.value !== "string" ||
    !row.system ||
    !row.value
  ) {
    throw fhirInvalid(`identifier[${index}] debe tener system y value`);
  }
  return { system: row.system, value: row.value };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw fhirInvalid(`${field} es obligatorio`);
  }
  return value;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw fhirInvalid(`${field} debe ser boolean`);
  }
  return value;
}

export function readSingleIdentifier(value: unknown, query: FhirIdentifier): FhirIdentifier {
  const identifiers = readIdentifierArray(value);
  if (identifiers.length !== 1) {
    throw fhirInvalid("identifier debe tener una sola entrada");
  }
  requireQueryIdentifier(identifiers, query);
  return identifiers[0] as FhirIdentifier;
}

export function readReference(value: unknown, type: string, field: string): string {
  const row = assertObject(value);
  assertNoExtraKeys(row, ["reference"]);
  const reference = requireString(row.reference, `${field}.reference`);
  const prefix = `${type}/`;
  if (!reference.startsWith(prefix) || reference.length === prefix.length) {
    throw fhirInvalid(`${field}.reference debe ser ${type}/{id}`);
  }
  const id = reference.slice(prefix.length);
  if (id.includes("/")) {
    throw fhirInvalid(`${field}.reference debe ser ${type}/{id}`);
  }
  return id;
}
