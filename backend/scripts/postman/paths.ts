import { join } from "node:path";

/** Salidas versionadas del generador, relativas a `backend/` (cwd de los scripts npm). */
export const COLLECTION_PATH = join(
  process.cwd(),
  "..",
  "docs",
  "chatbot-ingenius-360.postman_collection.json",
);
export const ENVIRONMENT_TEMPLATE_PATH = join(
  process.cwd(),
  "..",
  "docs",
  "lab.postman_environment.template.json",
);

export function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
