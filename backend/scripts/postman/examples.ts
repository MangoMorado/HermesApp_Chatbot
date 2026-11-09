/**
 * Cuerpo de ejemplo a partir de un esquema JSON del OpenAPI: el primer valor de `enum`, el
 * `example` si lo hay o un valor minimo por tipo. Los textos libres llevan el prefijo `newman-`
 * para reconocer lo que se crea al explorar a mano.
 */
type Schema = Record<string, unknown>;
type Components = { schemas?: Record<string, unknown> };

const MAX_DEPTH = 6;

function resolve(schema: Schema, components: Components): Schema {
  const ref = schema.$ref;
  if (typeof ref !== "string") {
    return schema;
  }
  const name = ref.replace("#/components/schemas/", "");
  return (components.schemas?.[name] ?? {}) as Schema;
}

function primaryType(schema: Schema): string | undefined {
  const type = schema.type;
  if (Array.isArray(type)) {
    return type.find((t) => t !== "null") as string | undefined;
  }
  return type as string | undefined;
}

function stringExample(schema: Schema): string {
  if (schema.format === "date-time") {
    return "2026-01-01T13:00:00.000Z";
  }
  if (schema.format === "date") {
    return "2026-01-01";
  }
  return "newman-ejemplo";
}

function objectExample(schema: Schema, components: Components, depth: number): unknown {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = (schema.required ?? []) as string[];
  const names = required.length > 0 ? required : Object.keys(properties);
  return Object.fromEntries(
    names.map((name) => [name, example(properties[name] ?? {}, components, depth + 1)]),
  );
}

function example(raw: Schema, components: Components, depth: number): unknown {
  const schema = resolve(raw, components);
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  const alternatives = (schema.oneOf ?? schema.anyOf) as Schema[] | undefined;
  if (alternatives?.[0]) {
    return example(alternatives[0], components, depth);
  }
  if (depth > MAX_DEPTH) {
    return null;
  }
  switch (primaryType(schema)) {
    case "object":
      return objectExample(schema, components, depth);
    case "array":
      return [example((schema.items ?? {}) as Schema, components, depth + 1)];
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 1;
    case "boolean":
      return true;
    case "string":
      return stringExample(schema);
    default:
      return schema.properties ? objectExample(schema, components, depth) : {};
  }
}

export function exampleFromSchema(schema: unknown, components: unknown): unknown {
  return example((schema ?? {}) as Schema, (components ?? {}) as Components, 0);
}
