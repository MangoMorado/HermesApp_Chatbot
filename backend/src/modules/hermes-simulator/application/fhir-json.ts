export type FhirId = { readonly system: string; readonly value: string };

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} no es un objeto`);
  }
  return value as Record<string, unknown>;
}

export function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} es obligatorio`);
  }
  return value;
}

export function readIdentifiers(value: unknown): FhirId[] {
  if (!Array.isArray(value)) {
    throw new TypeError("identifier debe ser una lista");
  }
  return value.map((item) => {
    const row = asRecord(item, "identifier");
    return { system: requiredString(row, "system"), value: requiredString(row, "value") };
  });
}

export function referenceId(value: unknown, type: string): string {
  const reference = requiredString(asRecord(value, type), "reference");
  const prefix = `${type}/`;
  const id = reference.startsWith(prefix) ? reference.slice(prefix.length) : "";
  if (id.length === 0 || id.includes("/")) {
    throw new Error(`referencia ${type} invalida`);
  }
  return id;
}

export function firstReferenceId(value: unknown, type: string): string {
  if (!Array.isArray(value) || value[0] === undefined) {
    throw new Error(`${type} es obligatorio`);
  }
  return referenceId(value[0], type);
}

export function bundleEntries(body: unknown): unknown[] {
  const entry = asRecord(body, "Bundle").entry;
  if (entry === undefined) {
    return [];
  }
  if (!Array.isArray(entry)) {
    throw new TypeError("Bundle.entry invalido");
  }
  return entry.map((item) => asRecord(item, "entry").resource);
}

export function bundleTotal(body: unknown): number {
  const total = asRecord(body, "Bundle").total;
  if (typeof total !== "number") {
    throw new TypeError("Bundle.total es obligatorio");
  }
  return total;
}

export function resourceId(body: unknown, label: string): string {
  return requiredString(asRecord(body, label), "id");
}
